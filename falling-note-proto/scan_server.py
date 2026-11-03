"""Local server for the prototype: serves this folder and turns sheet-music images/PDFs into MusicXML.

POST /scan   body = raw file bytes, header X-Filename = original name
             -> 200 MusicXML text, or 4xx/5xx with a plain-text reason

Needs Audiveris (https://github.com/Audiveris/audiveris). Set AUDIVERIS to its executable if it is not auto-detected.
Runs only on 127.0.0.1.
"""
import glob
import json
import http.server
import io
import ipaddress
import os
import queue
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import urllib.parse
import zipfile

try:
    from PIL import Image, ImageFilter   # optional: lets small or tilted sheet-music images be fixed before scanning (pip install pillow numpy)
except ImportError:
    Image = None
try:
    import numpy as np
except ImportError:
    np = None
try:
    import pypdfium2 as pdfium         # optional (BSD-3/Apache): draws PDF pages so they can be read like pictures (pip install pypdfium2)
except ImportError:
    pdfium = None

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", "8765"))
MAX_BYTES = 40 * 1024 * 1024
TIMEOUT_S = 300
ALLOWED = {".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".gif"}


def find_audiveris():
    env = os.environ.get("AUDIVERIS")
    if env and os.path.exists(env):
        return env
    for name in ("audiveris", "Audiveris"):
        p = shutil.which(name)
        if p:
            return p
    roots = [os.environ.get("ProgramFiles", r"C:\Program Files"), os.environ.get("LOCALAPPDATA", ""), "/opt", "/usr/bin"]
    for root in roots:
        for pat in ("Audiveris/Audiveris.exe", "Audiveris/bin/Audiveris.bat", "Audiveris/bin/Audiveris", "audiveris/bin/Audiveris"):
            for hit in glob.glob(os.path.join(root, pat)):
                return hit
    return None


TARGET_INTERLINE = 22     # px between staff lines Audiveris reads well (it gives up below ~12 and is best around 20-30)


def staff_spacing(im):
    """Typical gap in pixels between neighbouring staff lines, from how dark each row of the page is. None if it can't tell."""
    col = im.resize((1, im.height), Image.BOX)
    dark = [255 - col.getpixel((0, y)) for y in range(im.height)]
    top = max(dark)
    if top < 20:
        return None
    rows = [y for y, a in enumerate(dark) if a > 0.45 * top]
    centers, run = [], []
    for y in rows:                                        # a line 2 px thick is one line
        if run and y - run[-1] > 1:
            centers.append(sum(run) / len(run)); run = []
        run.append(y)
    if run:
        centers.append(sum(run) / len(run))
    gaps = sorted(b - a for a, b in zip(centers, centers[1:]) if 3 <= b - a <= 30)
    return gaps[len(gaps) // 2] if len(gaps) >= 8 else None


def flatten(im):
    """Even out shadows and a grey desk (a phone photo): divide by a blurred copy with the dark ink taken out. Skipped for an evenly lit page."""
    w, h = im.size
    small = im.resize((max(1, w // 8), max(1, h // 8)), Image.BOX).filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(3))
    bg = np.asarray(small.resize((w, h), Image.BILINEAR), dtype=np.float32)
    if np.percentile(bg, 5) / max(1.0, np.percentile(bg, 95)) > 0.85:
        return im
    out = np.clip(np.asarray(im, dtype=np.float32) / np.maximum(bg, 1.0) * 245, 0, 255)
    return Image.fromarray(out.astype(np.uint8))


def tilt_angle(im):
    """Degrees to rotate (counter-clockwise, as PIL does) so the staff lines run level: the angle that makes the rows of the page most
    different from each other (level lines are dark rows next to light rows)."""
    s = 800 / max(im.size)
    small = im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))), Image.BOX)

    def score(angle):
        r = np.asarray(small.rotate(angle, resample=Image.BILINEAR, fillcolor=255), dtype=np.float32)
        d = np.diff((255 - r).mean(axis=1))
        return float((d * d).sum())
    best = max(np.arange(-8, 8.01, 0.5), key=score)
    return float(max(np.arange(best - 0.5, best + 0.51, 0.1), key=score))


def enlarge_if_small(data, ext):
    """Audiveris needs level staff lines about 20 px apart. A screenshot or small download has them 6-10 px apart and it then finds no music
    at all (an 850x1100 page: 4 s and nothing; enlarged 3x: all 35 bars). A phone photo adds shadows and a tilt. So an image is first evened out
    and straightened (on photos this matters most: measured with and without it, a photo scan went from 17% to 81% of notes right; turning the
    page black and white first made it worse, 17%, so that is left to Audiveris) (needs numpy; skipped without it) and then enlarged. PDFs are rendered by Audiveris itself."""
    if ext == ".pdf" or Image is None:
        return data, ext
    try:
        im = Image.open(io.BytesIO(data)); im.load()
        im = im.convert("L")
        fixed, angle = im, 0.0
        if np is not None:
            fixed = flatten(im)
            angle = tilt_angle(fixed)
            if abs(angle) >= 0.3:
                fixed = fixed.rotate(angle, resample=Image.BICUBIC, expand=True, fillcolor=255)
            else:
                angle = 0.0
        gap = staff_spacing(fixed)
        if gap is None:                                   # no clear lines: go by the size, roughly a letter page at 200 dpi or less
            k = 3300 / max(fixed.size) if max(fixed.size) < 1700 else 1
        else:
            k = TARGET_INTERLINE / gap if gap < 18 else 1
        k = min(k, 4.0, (19e6 / (fixed.width * fixed.height)) ** 0.5)      # Audiveris refuses pages over 20 million pixels
        if k < 1.2:
            k = 1.0
        if k == 1.0 and fixed is im:
            return data, ext
        big = fixed.resize((round(fixed.width * k), round(fixed.height * k)), Image.LANCZOS) if k > 1 else fixed
        out = io.BytesIO(); big.save(out, "PNG")
        print("scan: image prepared: tilt %.1f deg, enlarged %.1fx (staff lines %s px apart)" % (angle, k, "%.1f" % gap if gap else "unknown"), flush=True)
        return out.getvalue(), ".png"
    except Exception as e:                                # anything odd about the file: let Audiveris try it as it is
        print("scan: could not prepare the image:", e, flush=True)
        return data, ext


HOMR_TIMEOUT_S = 300
MAX_PAGE_PIXELS = 20e6      # Audiveris ignores any page it would draw bigger than this (it draws PDFs at 300 dpi)


def oversized_pdf(data):
    """(width, height) in inches of the first page if Audiveris would draw it over 20 million pixels, else None. Reads the page size from the file
    when it is written in the clear; a PDF that hides it (compressed) is not checked."""
    m = re.search(rb"/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]", data[:2_000_000])
    if not m:
        return None
    w, h = abs(float(m.group(3)) - float(m.group(1))) / 72, abs(float(m.group(4)) - float(m.group(2))) / 72
    return (w, h) if w * h * 300 * 300 > MAX_PAGE_PIXELS else None


def find_homr():
    """homr (https://github.com/liebharc/homr, AGPL-3.0, run as a separate program) in its own environment; HOMR can point at the executable."""
    env = os.environ.get("HOMR")
    if env and os.path.exists(env):
        return env
    exe = os.path.join(os.path.expanduser("~"), ".waterfall-notes", "homr-venv", "Scripts" if os.name == "nt" else "bin", "homr.exe" if os.name == "nt" else "homr")
    return exe if os.path.exists(exe) else None


def run_homr(data):
    """-> MusicXML text, or None if homr isn't installed, fails, or finds no notes. data is a PNG (already enlarged and straightened)."""
    exe = find_homr()
    if not exe:
        return None
    work = tempfile.mkdtemp(prefix="homr_")
    try:
        src = os.path.join(work, "page.png")
        with open(src, "wb") as f:
            f.write(data)
        try:
            subprocess.run([exe, src], capture_output=True, text=True, timeout=HOMR_TIMEOUT_S, cwd=work)
        except subprocess.TimeoutExpired:
            return None
        out = glob.glob(os.path.join(work, "*.musicxml"))
        if not out:
            return None
        with open(out[0], "rb") as f:
            text = f.read().decode("utf-8", "replace")
        return text if re.search(r"<pitch>", text) else None
    finally:
        shutil.rmtree(work, ignore_errors=True)


PDF_MAX_PAGES = 30


def homr_image(data, ext):
    """Image bytes -> MusicXML from homr (after the page is evened out, straightened and enlarged), or None."""
    if not find_homr():
        return None
    data, ext = enlarge_if_small(data, ext)
    if ext != ".png":                                         # homr reads what it is given; hand it a PNG
        try:
            b = io.BytesIO(); Image.open(io.BytesIO(data)).convert("L").save(b, "PNG"); data = b.getvalue()
        except Exception:
            return None
    return run_homr(data)


def pdf_page_pngs(data):
    """PDF bytes -> one PNG per page, drawn at 300 dpi (less if that would pass Audiveris's and homr's size limits)."""
    pdf = pdfium.PdfDocument(data)
    out = []
    for i in range(min(len(pdf), PDF_MAX_PAGES)):
        page = pdf[i]
        w, h = page.get_size()
        scale = min(300 / 72, (MAX_PAGE_PIXELS * 0.95 / (w * h)) ** 0.5)
        b = io.BytesIO(); page.render(scale=scale).to_pil().convert("L").save(b, "PNG")
        out.append(b.getvalue())
    return out


def merge_pages(texts):
    """MusicXML of several pages -> one score: the later pages' bars are added after the first page's, and the bars are numbered again."""
    import xml.etree.ElementTree as ET
    roots = [ET.fromstring(re.sub(r"<\?xml[^>]*\?>|<!DOCTYPE[^>]*>", "", t).strip()) for t in texts]
    parts = roots[0].findall("part")
    for r in roots[1:]:
        for bp, rp in zip(parts, r.findall("part")):
            for m in rp.findall("measure"):
                bp.append(m)
    for bp in parts:
        for i, m in enumerate(bp.findall("measure"), 1):
            m.set("number", str(i))
    return '<?xml version="1.0" encoding="UTF-8"?>' + ET.tostring(roots[0], encoding="unicode")


def homr_pdf(data):
    """A PDF read page by page with homr: any page it can't read means None, and the whole PDF goes to Audiveris instead."""
    if not (pdfium and find_homr()):
        return None
    try:
        pages = pdf_page_pngs(data)
    except Exception as e:
        print("scan: could not draw the PDF:", e, flush=True)
        return None
    texts = []
    for png in pages:
        t = homr_image(png, ".png")
        if not t:
            return None
        texts.append(t)
    return texts[0] if len(texts) == 1 else merge_pages(texts)


def run_scan(data, filename, engine=None):
    """Sheet-music image or PDF -> MusicXML. Measured on 24 real piano pages (8 scores x screenshot / print / camera photo), homr is about equal to
    Audiveris on clean pages and far better on photos (81% of notes right against 64%); a PDF read by Audiveris directly got 75%, against 84% when its
    pages are drawn and read by homr like a print. So images, and PDFs when pypdfium2 can draw them, go to homr first, then to Audiveris."""
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED:
        return 415, "Unsupported file type %r. Use PDF or an image (png/jpg/tif)." % ext
    engine = engine or os.environ.get("SCAN_ENGINE", "auto")
    if engine in ("auto", "homr"):
        text = homr_pdf(data) if ext == ".pdf" else homr_image(data, ext)
        if text:
            print("scan: read by homr", flush=True)
            return 200, text
        if engine == "homr":
            return 422, "homr could not read any music from that file."
    if ext == ".pdf":
        big = oversized_pdf(data)
        if big:
            return 422, "This PDF's pages are %.0f x %.0f inches, so the scanner would have to draw them at more than 20 million pixels and refuses. Export or print it at A4 or Letter size and try again." % big
    data, ext = enlarge_if_small(data, ext)
    exe = find_audiveris()
    if not exe:
        return 503, "No sheet-music scanner was found. Install homr or Audiveris (see the README)."
    print("scan: read by Audiveris", flush=True)
    work = tempfile.mkdtemp(prefix="scan_")
    try:
        src = os.path.join(work, "input" + ext)
        out = os.path.join(work, "out")
        os.makedirs(out)
        with open(src, "wb") as f:
            f.write(data)
        cmd = [exe, "-batch", "-export", "-output", out, "--", src]
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=TIMEOUT_S, cwd=work)
        except subprocess.TimeoutExpired:
            return 504, "Scanning took longer than %d seconds." % TIMEOUT_S
        mxl = glob.glob(os.path.join(out, "**", "*.mxl"), recursive=True)
        xml = glob.glob(os.path.join(out, "**", "*.xml"), recursive=True) + glob.glob(os.path.join(out, "**", "*.musicxml"), recursive=True)
        if mxl:
            with zipfile.ZipFile(mxl[0]) as z:
                inner = [n for n in z.namelist() if n.lower().endswith((".xml", ".musicxml")) and not n.startswith("META-INF")]
                if inner:
                    return 200, z.read(inner[0]).decode("utf-8", "replace")
        if xml:
            with open(xml[0], "rb") as f:
                return 200, f.read().decode("utf-8", "replace")
        tail = (proc.stdout + "\n" + proc.stderr).strip()[-600:]
        return 422, "Audiveris could not read any music from that image. Try a cleaner, flatter, higher-resolution scan" + ("" if Image else " (installing Pillow, pip install pillow, lets the helper enlarge small images itself)") + ".\n" + tail
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ---- piano-only transcription model (runs in its own Python environment so PyTorch stays out of this server) ----
PIANO_PY = os.environ.get("PIANO_PYTHON") or os.path.join(os.path.expanduser("~"), ".waterfall-notes", "piano-venv",
                                                           "Scripts" if os.name == "nt" else "bin", "python.exe" if os.name == "nt" else "python")
PIANO_CKPT = os.path.join(os.path.expanduser("~"), "piano_transcription_inference_data", "note_F1=0.9677_pedal_F1=0.9186.pth")
PIANO_WORKER = os.path.join(HERE, "piano_worker.py")
PIANO_MAX = 60 * 1024 * 1024
PIANO_TIMEOUT_S = 900


def piano_status():
    if not os.path.exists(PIANO_PY):
        return "missing: the piano environment is not installed"
    if not os.path.exists(PIANO_CKPT) or os.path.getsize(PIANO_CKPT) < 1.6e8:
        return "missing: the piano model file is not downloaded"
    return "ready"


class PianoWorker:
    """Keeps one `piano_worker.py --serve` process alive, so PyTorch and the 165 MB model load once instead of on every request.
    Requests are handled one at a time (the model uses all the CPU)."""

    def __init__(self):
        self.proc = None
        self.lines = queue.Queue()
        self.lock = threading.Lock()

    def _reader(self, proc, q):
        for line in proc.stdout:
            q.put(line)
        q.put(None)                                   # the process ended

    def _next(self, timeout):
        try:
            line = self.lines.get(timeout=timeout)
        except queue.Empty:
            return None
        return json.loads(line) if line and line.strip() else None

    def stop(self):
        if self.proc is not None:
            try:
                self.proc.kill()
            except OSError:
                pass
        self.proc = None

    def _start(self):
        self.lines = queue.Queue()
        self.proc = subprocess.Popen([PIANO_PY, PIANO_WORKER, "--serve"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.DEVNULL, text=True, bufsize=1, cwd=HERE)
        threading.Thread(target=self._reader, args=(self.proc, self.lines), daemon=True).start()
        first = self._next(300)
        if not first or not first.get("ready"):
            self.stop()
            raise RuntimeError((first or {}).get("error") or "the piano model did not start")

    def warm(self):
        """Load the model ahead of the first request."""
        with self.lock:
            if piano_status() == "ready" and (self.proc is None or self.proc.poll() is not None):
                try:
                    self._start()
                except Exception:
                    pass

    def transcribe(self, wav, out, timeout, fast=False):
        with self.lock:
            if self.proc is None or self.proc.poll() is not None:
                self._start()
            self.proc.stdin.write(json.dumps({"wav": wav, "out": out, "fast": bool(fast)}) + "\n")
            self.proc.stdin.flush()
            reply = self._next(timeout)
            if reply is None:
                self.stop()
                raise TimeoutError("the piano model stopped or took too long")
            if not reply.get("ok"):
                raise RuntimeError(reply.get("error") or "failed")


PIANO = PianoWorker()


def run_piano(wav_bytes, fast=False):
    st = piano_status()
    if st != "ready":
        return 503, st
    work = tempfile.mkdtemp(prefix="piano_")
    try:
        wav, out = os.path.join(work, "in.wav"), os.path.join(work, "out.json")
        with open(wav, "wb") as f:
            f.write(wav_bytes)
        try:
            PIANO.transcribe(wav, out, PIANO_TIMEOUT_S, fast)
        except TimeoutError as e:
            return 504, "The piano model took longer than %d minutes." % (PIANO_TIMEOUT_S // 60)
        except Exception as e:
            return 500, "The piano model failed: " + str(e)[:300]
        with open(out, "r", encoding="utf-8") as f:
            return 200, f.read()
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ---- "import my latest download": the newest media file in the user's Downloads folder ----
DOWNLOADS = os.environ.get("WN_DOWNLOADS") or os.path.join(os.path.expanduser("~"), "Downloads")
DOWNLOAD_EXTS = {".mp4", ".mov", ".webm", ".m4v", ".mkv", ".mp3", ".wav", ".m4a", ".flac", ".ogg", ".mid", ".midi",
                 ".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".xml", ".musicxml"}
DOWNLOAD_MAX = 400 * 1024 * 1024

# Background clips for reels: whatever videos or pictures you drop into the "backgrounds" folder next to this file show up in the Reel dialog.
BG_DIR = os.path.join(HERE, "backgrounds")
BG_KINDS = {".mp4": "video", ".webm": "video", ".m4v": "video", ".mov": "video", ".jpg": "image", ".jpeg": "image", ".png": "image", ".webp": "image"}
BG_MAX = 1024 * 1024 * 1024

def list_backgrounds():
    out = []
    try:
        names = sorted(os.listdir(BG_DIR), key=str.lower)
    except OSError:
        return out
    for n in names:
        kind, p = BG_KINDS.get(os.path.splitext(n)[1].lower()), os.path.join(BG_DIR, n)
        if kind and os.path.isfile(p):
            out.append({"name": n, "kind": kind, "size": os.path.getsize(p)})
    return out


def latest_download():
    """(path, stat, name) of the newest media file directly inside Downloads, or None. Unfinished downloads (.crdownload etc.) don't match."""
    best = None
    try:
        with os.scandir(DOWNLOADS) as it:
            for e in it:
                if not e.is_file() or os.path.splitext(e.name)[1].lower() not in DOWNLOAD_EXTS:
                    continue
                st = e.stat()
                if best is None or st.st_mtime > best[1].st_mtime:
                    best = (e.path, st, e.name)
    except OSError:
        return None
    return best


FETCH_MAX = 40 * 1024 * 1024
FETCH_TYPES = ("audio/", "video/", "image/", "application/pdf", "application/xml", "text/xml", "application/octet-stream",
               "application/vnd.recordare.musicxml", "application/x-midi")


def _public_ipv4(host):
    """Resolve host; return one public IPv4 address, 'private' if any address is non-public, or None if it can't be resolved."""
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return None
    pick = None
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            return "private"          # localhost, LAN, link-local/metadata: refuse the whole host
        if ip.version == 4 and pick is None:
            pick = str(ip)
    return pick


def fetch_file(url):
    """Download a direct file link with curl (uses the OS certificate store). Returns (status, bytes_or_message, content_type).
    The connection is pinned to the address we validated, and redirects are followed by hand so each hop is validated too."""
    curl = shutil.which("curl") or shutil.which("curl.exe")
    if not curl:
        return 503, "curl was not found on this computer, so links can't be fetched.", None
    for _ in range(4):
        p = urllib.parse.urlparse(url)
        if p.scheme not in ("http", "https") or not p.hostname:
            return 400, "Only http and https links work.", None
        ip = _public_ipv4(p.hostname)
        if ip == "private":
            return 403, "That address isn't a public website.", None
        if ip is None:
            return 502, "Could not find that website.", None
        port = p.port or (443 if p.scheme == "https" else 80)
        work = tempfile.mkdtemp(prefix="fetch_")
        try:
            body, hdr = os.path.join(work, "body"), os.path.join(work, "hdr")
            cmd = [curl, "-sS", "--proto", "=http,https", "--max-redirs", "0", "--max-time", "60", "--max-filesize", str(FETCH_MAX),
                   "-A", "WaterfallNotes/1.0", "--resolve", "%s:%d:%s" % (p.hostname, port, ip), "-D", hdr, "-o", body, "--", url]
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=75)
            if proc.returncode == 63:
                return 413, "That file is larger than %d MB." % (FETCH_MAX // 1048576), None
            if proc.returncode != 0 or not os.path.exists(hdr):
                return 502, "Could not reach that link.", None
            head = open(hdr, "rb").read().decode("latin-1").replace("\r", "").split("\n\n")
            block = [b for b in head if b.startswith("HTTP/")][-1]
            lines = block.split("\n")
            status = int(lines[0].split()[1])
            hdrs = {k.strip().lower(): v.strip() for k, _, v in (l.partition(":") for l in lines[1:]) if k}
            if status in (301, 302, 303, 307, 308) and hdrs.get("location"):
                url = urllib.parse.urljoin(url, hdrs["location"])
                continue
            if status != 200:
                return 502, "The site answered with an error (%d)." % status, None
            ctype = (hdrs.get("content-type") or "application/octet-stream").split(";")[0].strip().lower()
            if ctype in ("text/html", "application/xhtml+xml") or not ctype.startswith(FETCH_TYPES):
                return 415, "That link is a web page, not a file. Use a direct link to a .mid, audio, PDF or image file.", None
            with open(body, "rb") as fh:
                return 200, fh.read(), ctype
        except subprocess.TimeoutExpired:
            return 504, "That link took too long to download.", None
        finally:
            shutil.rmtree(work, ignore_errors=True)
    return 502, "Too many redirects.", None

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=HERE, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")   # always re-check files, so an open tab never keeps running an old version
        super().end_headers()

    def _reply(self, code, text, ctype="text/plain; charset=utf-8"):
        body = text.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if urllib.parse.urlparse(self.path).path == "/transcribe-piano":
            n = int(self.headers.get("Content-Length") or 0)
            if n <= 0 or n > PIANO_MAX:
                return self._reply(413, "Audio must be between 1 byte and %d MB." % (PIANO_MAX // 1048576))
            fast = (urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("speed") or [""])[0] == "fast"
            code, text = run_piano(self.rfile.read(n), fast)
            return self._reply(code, text, "application/json; charset=utf-8" if code == 200 else "text/plain; charset=utf-8")
        if self.path != "/scan":
            return self._reply(404, "Not found")
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_BYTES:
            return self._reply(413, "File must be between 1 byte and %d MB." % (MAX_BYTES // 1048576))
        name = re.sub(r"[^\w.\- ]", "_", os.path.basename(self.headers.get("X-Filename", "scan.pdf")))
        code, text = run_scan(self.rfile.read(n), name)
        self._reply(code, text, "application/xml; charset=utf-8" if code == 200 else "text/plain; charset=utf-8")

    def _own_page_only(self):
        """The Downloads endpoints are for this app's own page only: right Host (blocks DNS rebinding), our header (forces a CORS
        preflight for other sites, which we never grant), and no foreign Origin."""
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].lower()
        origin = self.headers.get("Origin")
        origin_ok = not origin or (urllib.parse.urlparse(origin).hostname or "") in ("localhost", "127.0.0.1")
        return host in ("localhost", "127.0.0.1") and self.headers.get("X-WN") == "1" and origin_ok

    def _latest(self):
        if not self._own_page_only():
            return self._reply(403, "Not allowed.")
        found = latest_download()
        if not found:
            return self._reply(404, "No video, audio, MIDI, PDF or image file found in your Downloads folder.")
        path, st, name = found
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/latest-download":
            body = json.dumps({"name": name, "size": st.st_size, "modified": st.st_mtime, "tooBig": st.st_size > DOWNLOAD_MAX})
            return self._reply(200, body, "application/json; charset=utf-8")
        if parsed.path == "/latest-download/file":
            want = (urllib.parse.parse_qs(parsed.query).get("name") or [""])[0]
            if want != name:
                return self._reply(409, "A newer download appeared. Press the button again.")
            if st.st_size > DOWNLOAD_MAX:
                return self._reply(413, "That file is larger than %d MB." % (DOWNLOAD_MAX // 1048576))
            import mimetypes
            self.send_response(200)
            self.send_header("Content-Type", mimetypes.guess_type(name)[0] or "application/octet-stream")
            self.send_header("Content-Length", str(st.st_size))
            self.end_headers()
            with open(path, "rb") as f:
                shutil.copyfileobj(f, self.wfile, 1024 * 1024)
            return
        return self._reply(404, "Not found")

    def _backgrounds(self):
        if not self._own_page_only():
            return self._reply(403, "Not allowed.")
        parsed = urllib.parse.urlparse(self.path)
        found = list_backgrounds()
        if parsed.path == "/backgrounds-list":
            return self._reply(200, json.dumps({"dir": BG_DIR, "files": found}), "application/json; charset=utf-8")
        want = os.path.basename((urllib.parse.parse_qs(parsed.query).get("name") or [""])[0])      # only a name from the list, never a path
        hit = next((f for f in found if f["name"] == want), None)
        if not hit:
            return self._reply(404, "No such clip in the backgrounds folder.")
        if hit["size"] > BG_MAX:
            return self._reply(413, "That clip is larger than %d MB." % (BG_MAX // 1048576))
        import mimetypes
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(want)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(hit["size"]))
        self.end_headers()
        with open(os.path.join(BG_DIR, want), "rb") as f:
            shutil.copyfileobj(f, self.wfile, 1024 * 1024)

    def do_GET(self):
        if self.path.startswith("/backgrounds-"):
            return self._backgrounds()
        if self.path.startswith("/latest-download"):
            return self._latest()
        if self.path == "/piano/status":
            return self._reply(200, piano_status())
        if self.path == "/scan/status":
            return self._reply(200, "ready" if find_homr() or find_audiveris() else "missing")
        if self.path.startswith("/fetch?"):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            code, body, ctype = fetch_file((q.get("url") or [""])[0])
            if code != 200:
                return self._reply(code, body)
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            return self.wfile.write(body)
        return super().do_GET()


if __name__ == "__main__":
    os.makedirs(BG_DIR, exist_ok=True)
    threading.Thread(target=PIANO.warm, daemon=True).start()      # load the piano model in the background so the first request is fast
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("Serving %s on http://127.0.0.1:%d (scanners: homr %s, Audiveris %s)" % (HERE, PORT, "found" if find_homr() else "not found", "found" if find_audiveris() else "not found"), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)
