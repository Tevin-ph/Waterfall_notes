"""The same benchmark as omr_bench_run.py, but with homr (a deep-learning scanner) instead of the helper's Audiveris.
usage: python omr_bench_homr.py bench_dir out_dir [kinds=screen,print,photo] [piece filter]
homr is run from its own environment (~/.waterfall-notes/homr-venv). It is given the image as it is, with no preparation.
"""
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from omr_score import score  # noqa: E402

HOMR = os.path.join(os.path.expanduser("~"), ".waterfall-notes", "homr-venv", "Scripts", "homr.exe")
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
        work = tempfile.mkdtemp(prefix="homr_")
        src = os.path.join(work, "page" + os.path.splitext(img[0])[1])
        shutil.copy(img[0], src)
        t = time.time()
        try:
            subprocess.run([HOMR, src], capture_output=True, text=True, timeout=600, cwd=work)
        except subprocess.TimeoutExpired:
            pass
        rec = {"piece": name, "kind": kind, "secs": round(time.time() - t)}
        found = glob.glob(os.path.join(work, "*.musicxml"))
        if found:
            dst = os.path.join(out, name + "." + kind + ".xml")
            shutil.copy(found[0], dst)
            try:
                rec.update(score(truth, dst))
            except Exception as e:
                rec["error"] = str(e)
        else:
            rec["error"] = "no output"
        shutil.rmtree(work, ignore_errors=True)
        log.write(json.dumps(rec) + "\n"); log.flush()
        print(rec, flush=True)
