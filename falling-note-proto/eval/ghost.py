import sys, json, bisect, io, contextlib
import numpy as np
sys.argv = ["x", "5", "0.15"]
with contextlib.redirect_stdout(io.StringIO()):
    import eval_release as E
from sklearn.ensemble import HistGradientBoostingClassifier
hand = E.hand
RULES = {  # the Clean up levels already in the editor (remove blips / quiet / quiet low notes)
    "gentle": lambda n: n["d"] < 0.06 or (n["v"] < 0.25 and n["d"] < 0.1),
    "medium": lambda n: n["d"] < 0.08 or (n["v"] < 0.3 and n["d"] < 0.15) or (n["m"] < 45 and n["v"] < 0.35),
    "strong": lambda n: n["d"] < 0.12 or (n["v"] < 0.35 and n["d"] < 0.3) or (n["m"] < 48 and n["v"] < 0.45),
}
def feats(notes):
    ons = sorted(n["t"] for n in notes); rows = []
    ts = np.array(ons)
    for n in notes:
        near = ((np.abs(ts - n["t"]) < 0.5)).sum() - 1                                  # notes starting within +-0.5 s
        same = sum(1 for o in notes if o is not n and o["m"] == n["m"] and abs(o["t"] - n["t"]) < 0.3)
        harm = sum(1 for o in notes if o is not n and abs(o["t"] - n["t"]) < 0.06 and (n["m"] - o["m"]) in (12, 19, 24, 28, 31, 7, 5) and o["d"] > n["d"])
        nb = sum(1 for o in notes if o is not n and abs(o["t"] - n["t"]) < 0.05 and abs(o["m"] - n["m"]) == 1)
        rows.append([n["d"], n["v"], n["m"], near, same, harm, nb])
    return np.array(rows, float)
data = {}
for nm in E.NAMES:
    for kind, f in (("clean", nm + ".pred.json"), ("deg", nm + ".deg.json")):
        pr = json.load(open(f))["notes"]; truth, _ = E.true_notes(nm + ".midi")
        ok = {id(p) for p, _ in E.match(pr, truth)}
        data[(nm, kind)] = (pr, feats(pr), np.array([id(p) in ok for p in pr]))
print("how many false notes (not in the real MIDI, within 50 ms) per recording")
for nm in E.NAMES:
    for kind in ("clean", "deg"):
        pr, X, y = data[(nm, kind)]; print("  %-9s %-5s predicted=%5d  false=%4d (%.1f%%)" % (nm, kind, len(pr), (~y).sum(), 100 * (~y).mean()))
print("\nfilter results on the phone-style (degraded) recordings; 'removed false' = share of false notes taken out, 'lost true' = share of real notes taken out")
def report(label, keep_by_piece):
    f_removed = f_total = t_lost = t_total = 0
    for nm in E.NAMES:
        pr, X, y = data[(nm, "deg")]; keep = keep_by_piece[nm]
        f_removed += ((~y) & (~keep)).sum(); f_total += (~y).sum(); t_lost += (y & ~keep).sum(); t_total += y.sum()
    print("  %-40s removed false %5.1f%%   lost true %4.1f%%" % (label, 100 * f_removed / f_total, 100 * t_lost / t_total))
for k, r in RULES.items(): report("Clean up: " + k, {nm: np.array([not r(n) for n in data[(nm, "deg")][0]]) for nm in E.NAMES})
for thr in (0.3, 0.5, 0.7):
    keeps = {}
    for hold in E.NAMES:
        Xtr = np.vstack([data[(n, "deg")][1] for n in E.NAMES if n != hold] + [data[(n, "clean")][1] for n in E.NAMES if n != hold]); ytr = np.concatenate([data[(n, "deg")][2] for n in E.NAMES if n != hold] + [data[(n, "clean")][2] for n in E.NAMES if n != hold])
        clf = HistGradientBoostingClassifier(max_depth=3, learning_rate=0.08, max_iter=150, random_state=0).fit(Xtr, ytr)
        keeps[hold] = clf.predict_proba(data[(hold, "deg")][1])[:, 1] >= thr
    report("learned filter (keep if P(real) >= %.1f)" % thr, keeps)
