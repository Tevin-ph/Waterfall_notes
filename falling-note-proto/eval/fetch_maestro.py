"""Pull a few named files out of the 108 GB MAESTRO zip with HTTP range requests (no full download)."""
import io, os, sys, urllib.request, zipfile

URL = "https://storage.googleapis.com/magentadata/datasets/maestro/v3.0.0/maestro-v3.0.0.zip"
OUT = sys.argv[1]
WANT = [
    "2015/MIDI-Unprocessed_R2_D1-2-3-6-7-8-11_mid--AUDIO-from_mp3_03_R2_2015_wav--1",
    "2004/MIDI-Unprocessed_SMF_17_R1_2004_03-06_ORIG_MID--AUDIO_20_R2_2004_12_Track12_wav--1",
    "2014/MIDI-UNPROCESSED_01-03_R1_2014_MID--AUDIO_01_R1_2014_wav--1",
]


class Remote(io.RawIOBase):
    def __init__(self, url):
        r = urllib.request.urlopen(urllib.request.Request(url, method="HEAD"))
        self.size = int(r.headers["Content-Length"]); self.url = url; self.pos = 0; self.fetched = 0
    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos
    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos
    def read(self, n=-1):
        if n < 0 or self.pos + n > self.size: n = self.size - self.pos
        if n <= 0: return b""
        req = urllib.request.Request(self.url, headers={"Range": "bytes=%d-%d" % (self.pos, self.pos + n - 1)})
        data = urllib.request.urlopen(req).read(); self.pos += len(data); self.fetched += len(data); return data
    def readinto(self, b):
        d = self.read(len(b)); b[:len(d)] = d; return len(d)


rem = Remote(URL)
z = zipfile.ZipFile(io.BufferedReader(rem, 1 << 20))
names = {i.filename: i for i in z.infolist()}
print("entries:", len(names), "central directory fetched:", rem.fetched // 1024, "KB")
for stem in WANT:
    for ext in (".midi", ".wav"):
        hit = [n for n in names if n.endswith(stem + ext)]
        if not hit:
            print("NOT FOUND", stem + ext); continue
        info = names[hit[0]]
        dest = os.path.join(OUT, os.path.basename(hit[0]))
        print("fetching", os.path.basename(hit[0]), info.file_size // 1024, "KB (stored as", info.compress_size // 1024, "KB)")
        with z.open(info) as src, open(dest, "wb") as dst:
            while True:
                chunk = src.read(1 << 20)
                if not chunk: break
                dst.write(chunk)
print("total bytes fetched:", rem.fetched // (1024 * 1024), "MB")
