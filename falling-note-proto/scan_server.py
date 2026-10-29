"""Local server for the prototype: serves this folder and turns sheet-music images/PDFs into MusicXML.

POST /scan   body = raw file bytes, header X-Filename = original name
             -> 200 MusicXML text, or 4xx/5xx with a plain-text reason

Needs Audiveris (https://github.com/Audiveris/audiveris). Set AUDIVERIS to its executable if it is not auto-detected.
Runs only on 127.0.0.1.
"""
import glob
import http.server
import ipaddress
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import urllib.parse
import zipfile

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


def run_scan(data, filename):
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED:
        return 415, "Unsupported file type %r. Use PDF or an image (png/jpg/tif)." % ext
    exe = find_audiveris()
    if not exe:
        return 503, "Audiveris was not found. Install it, or set the AUDIVERIS environment variable to its executable."
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
        return 422, "Audiveris could not read any music from that image. Try a cleaner, flatter, higher-resolution scan.\n" + tail
    finally:
        shutil.rmtree(work, ignore_errors=True)


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

    def _reply(self, code, text, ctype="text/plain; charset=utf-8"):
        body = text.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/scan":
            return self._reply(404, "Not found")
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_BYTES:
            return self._reply(413, "File must be between 1 byte and %d MB." % (MAX_BYTES // 1048576))
        name = re.sub(r"[^\w.\- ]", "_", os.path.basename(self.headers.get("X-Filename", "scan.pdf")))
        code, text = run_scan(self.rfile.read(n), name)
        self._reply(code, text, "application/xml; charset=utf-8" if code == 200 else "text/plain; charset=utf-8")

    def do_GET(self):
        if self.path == "/scan/status":
            return self._reply(200, "ready" if find_audiveris() else "missing")
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
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("Serving %s on http://127.0.0.1:%d (Audiveris: %s)" % (HERE, PORT, find_audiveris() or "not found"), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)
