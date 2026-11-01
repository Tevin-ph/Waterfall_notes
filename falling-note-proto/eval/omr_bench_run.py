"""Send every benchmark page to the running helper (POST /scan) and score what comes back against the answer key.
usage: python omr_bench_run.py bench_dir out_dir [kinds=screen,print,photo] [pieces substring filter]
Appends one JSON line per page to out_dir/results.jsonl, so a long run can be read while it goes on.
"""
import glob
import json
import os
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from omr_score import score  # noqa: E402

bench, out = sys.argv[1], sys.argv[2]
kinds = (sys.argv[3] if len(sys.argv) > 3 else "screen,print,photo").split(",")
only = sys.argv[4] if len(sys.argv) > 4 else ""
os.makedirs(out, exist_ok=True)
log = open(os.path.join(out, "results.jsonl"), "a")
for truth in sorted(glob.glob(os.path.join(bench, "*.truth.xml"))):
    name = os.path.basename(truth)[:-len(".truth.xml")]
    if only and only not in name:
        continue
    for kind in kinds:
        img = glob.glob(os.path.join(bench, name + "." + kind + ".*"))
        if not img:
            continue
        data = open(img[0], "rb").read()
        req = urllib.request.Request("http://localhost:8765/scan", data=data, headers={"X-Filename": os.path.basename(img[0])})
        t = time.time()
        try:
            body = urllib.request.urlopen(req, timeout=400).read().decode("utf-8")
            code = 200
        except urllib.error.HTTPError as e:
            body, code = e.read().decode("utf-8", "replace"), e.code
        rec = {"piece": name, "kind": kind, "http": code, "secs": round(time.time() - t)}
        if code == 200:
            path = os.path.join(out, name + "." + kind + ".xml")
            open(path, "w", encoding="utf-8").write(body)
            try:
                rec.update(score(truth, path))
            except Exception as e:                      # a scan that isn't readable MusicXML counts as nothing found
                rec["error"] = str(e)
        else:
            rec["error"] = body.split("\n")[0][:120]
        log.write(json.dumps(rec) + "\n"); log.flush()
        print(rec, flush=True)
