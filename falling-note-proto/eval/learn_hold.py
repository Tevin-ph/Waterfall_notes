import sys, json, bisect, io, contextlib
import numpy as np
sys.argv = ["x", "5", "0.15"]
with contextlib.redirect_stdout(io.StringIO()):
    import eval_release as E
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import Ridge
hand = E.hand

def rule(d, gap):                       # the shipped rule
    return min(d, 1.0) if gap is None else min(d, max(0.15, min(0.6, 0.5 * gap)))

def feats(notes, pedals):
    """one feature row per note: what a held-length model could know from the transcription alone"""
    ons = [[], []]; allo = sorted(n["t"] for n in notes)
    for n in notes: ons[hand(n["m"])].append(n["t"])
    for o in ons: o.sort()
    pt = np.array([p["t"] for p in pedals]); pe = np.array([p["t"] + p["d"] for p in pedals])
    rows = []
    for n in notes:
        a = ons[hand(n["m"])]; i = bisect.bisect_right(a, n["t"] + 0.04)
        g1 = a[i] - n["t"] if i < len(a) else 9.0
        g2 = a[i + 1] - n["t"] if i + 1 < len(a) else 9.0
        j = bisect.bisect_left(a, n["t"] - 1e-6); prev = n["t"] - a[j - 1] if j > 0 else 9.0
        ia = bisect.bisect_right(allo, n["t"] + 0.04); ga = allo[ia] - n["t"] if ia < len(allo) else 9.0
        chord = sum(1 for t in a[max(0, j - 6): j + 7] if abs(t - n["t"]) <= 0.04)
        dens = bisect.bisect_right(allo, n["t"] + 1) - bisect.bisect_left(allo, n["t"] - 1)
        end = n["t"] + n["d"]
        pedal_end = float(bool(len(pt)) and bool(((pt <= end) & (pe >= end - 0.05)).any()))
        pedal_any = float(bool(len(pt)) and bool(((pt <= end) & (pe >= n["t"])).any()))
        rows.append([n["d"], n["v"], n["m"], min(g1, 9), min(g2, 9), min(prev, 9), min(ga, 9), chord, dens, pedal_end, pedal_any, float(hand(n["m"])), rule(n["d"], g1 if g1 <= 3 else None)])
    return np.array(rows)

data = {}
for name in E.NAMES:
    pr = json.load(open(name + ".pred.json")); truth, _ = E.true_notes(name + ".midi")
    X = feats(pr["notes"], pr["pedal"]); idx = {id(p): i for i, p in enumerate(pr["notes"])}
    pairs = E.match(pr["notes"], truth)
    data[name] = (X[[idx[id(p)] for p, _ in pairs]], np.array([t["off"] - t["t"] for _, t in pairs]))

def score(pred, y): e = np.abs(pred - y); return 100 * (e <= .15).mean(), 100 * (e <= .25).mean(), np.median(e), pred.mean()

print("leave-one-piece-out (train on two pieces, test on the third)")
tot = {"shipped rule": [], "boosted trees (log target)": [], "ridge on log target": []}
for hold in E.NAMES:
    Xtr = np.vstack([data[n][0] for n in E.NAMES if n != hold]); ytr = np.concatenate([data[n][1] for n in E.NAMES if n != hold])
    Xte, yte = data[hold]
    d_te = Xte[:, 0]
    preds = {"shipped rule": Xte[:, -1]}
    gb = HistGradientBoostingRegressor(max_depth=4, learning_rate=0.08, max_iter=250, random_state=0).fit(Xtr[:, :-1], np.log(np.clip(ytr, 0.03, None)))
    preds["boosted trees (log target)"] = np.minimum(d_te, np.exp(gb.predict(Xte[:, :-1])))
    rg = Ridge(alpha=1.0).fit(Xtr[:, :-1], np.log(np.clip(ytr, 0.03, None)))
    preds["ridge on log target"] = np.minimum(d_te, np.exp(rg.predict(Xte[:, :-1])))
    print(" ", hold)
    for k, p in preds.items():
        s = score(p, yte); tot[k].append((p, yte)); print("    %-28s within150=%4.1f%% within250=%4.1f%% median=%.3fs mean bar=%.2fs" % ((k,) + s))
print("all three pieces together")
for k, v in tot.items():
    s = score(np.concatenate([a for a, _ in v]), np.concatenate([b for _, b in v])); print("  %-28s within150=%4.1f%% within250=%4.1f%% median=%.3fs mean bar=%.2fs" % ((k,) + s))

print("\nsecond try: boosted trees on the raw hold with absolute-error loss (targets the median directly)")
res = []
for hold in E.NAMES:
    Xtr = np.vstack([data[n][0] for n in E.NAMES if n != hold]); ytr = np.concatenate([data[n][1] for n in E.NAMES if n != hold]); Xte, yte = data[hold]
    gb = HistGradientBoostingRegressor(loss="absolute_error", max_depth=3, learning_rate=0.06, max_iter=200, random_state=0).fit(Xtr[:, :-1], ytr)
    res.append((np.minimum(Xte[:, 0], np.clip(gb.predict(Xte[:, :-1]), 0.05, None)), yte))
s = score(np.concatenate([a for a, _ in res]), np.concatenate([b for _, b in res])); print("  all three: within150=%4.1f%% within250=%4.1f%% median=%.3fs mean bar=%.2fs   (shipped rule: 90.0%% / 94.2%%)" % s)
