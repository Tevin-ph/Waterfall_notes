import sys, json, io, contextlib
import numpy as np
sys.argv = ["x", "5", "0.15"]
with contextlib.redirect_stdout(io.StringIO()):
    import eval_release as E
    import ghost as G
rules = {
 "d < 0.04": lambda n, f: n["d"] < 0.04,
 "d < 0.05": lambda n, f: n["d"] < 0.05,
 "d < 0.06 (Gentle part 1)": lambda n, f: n["d"] < 0.06,
 "d < 0.08": lambda n, f: n["d"] < 0.08,
 "v at the model's floor (0.2)": lambda n, f: n["v"] <= 0.2001,
 "v < 0.25": lambda n, f: n["v"] < 0.25,
 "v < 0.25 and d < 0.1": lambda n, f: n["v"] < 0.25 and n["d"] < 0.1,
 "quieter echo: same key within 0.3 s, v lower": lambda n, f: f[4] > 0 and n["v"] < 0.3,
 "overtone ghost (octave/12th above, same start)": lambda n, f: f[5] > 0 and n["v"] < 0.35,
 "semitone neighbour at same start, quiet": lambda n, f: f[6] > 0 and n["v"] < 0.35,
 "isolated: no other note within 0.5 s, short": lambda n, f: f[3] == 0 and n["d"] < 0.15,
 "isolated and quiet": lambda n, f: f[3] == 0 and n["v"] < 0.3,
 "isolated, quiet, below C3": lambda n, f: f[3] == 0 and n["v"] < 0.35 and n["m"] < 48,
}
tot_f = sum((~G.data[(nm, "deg")][2]).sum() for nm in E.NAMES); tot_t = sum(G.data[(nm, "deg")][2].sum() for nm in E.NAMES)
print("on the phone-style recordings: %d false notes, %d real notes" % (tot_f, tot_t))
print("%-50s %9s %9s %10s" % ("rule", "false out", "real lost", "precision"))
for k, r in rules.items():
    rf = rt = 0
    for nm in E.NAMES:
        pr, X, y = G.data[(nm, "deg")]
        for n, f, ok in zip(pr, X, y):
            if r(n, f):
                if ok: rt += 1
                else: rf += 1
    print("%-50s %9d %9d %9.0f%%" % (k, rf, rt, 100 * rf / max(1, rf + rt)))
