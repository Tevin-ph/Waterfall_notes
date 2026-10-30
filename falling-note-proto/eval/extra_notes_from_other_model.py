import sys, json, io, contextlib
sys.argv = ["x", "5", "0.15"]
with contextlib.redirect_stdout(io.StringIO()):
    import eval_release as E
def near(n, pool, tol=0.05): return any(abs(p["t"] - n["t"]) <= tol for p in pool.get(n["m"], []))
rows = []; base = [0, 0, 0]; kinds = {}
for nm in E.NAMES:
    for suf, bd in ((".tkw.json", ".pred.json"), (".deg.tkw.json", ".deg.json")):
        tk = json.load(open(nm + suf))["notes"]; b = json.load(open(nm + bd))["notes"]; truth, _ = E.true_notes(nm + ".midi")
        pool = {}
        for p in tk: pool.setdefault(p["m"], []).append(p)
        okb = {id(p) for p, _ in E.match(b, truth)}                     # which ByteDance notes are real
        tkm = E.match(tk, truth); base[0] += len(tkm); base[1] += len(tk) - len(tkm); base[2] += len(truth) - len(tkm)
        for n in b:
            if not near(n, pool):
                rows.append((suf, n["d"], n["v"], id(n) in okb))
print("ByteDance notes that Transkun did not find (clean + phone-style, 3 pieces): %d, of which real: %d (%.0f%%)" % (len(rows), sum(r[3] for r in rows), 100 * sum(r[3] for r in rows) / len(rows)))
for label, f in (("all", lambda r: True), ("phone-style only", lambda r: r[0].startswith(".deg")), ("short (<0.12 s)", lambda r: r[1] < 0.12), ("short and v >= 0.4", lambda r: r[1] < 0.12 and r[2] >= 0.4), ("v >= 0.5", lambda r: r[2] >= 0.5), ("v >= 0.6", lambda r: r[2] >= 0.6)):
    s = [r for r in rows if f(r)]; real = sum(r[3] for r in s)
    print("  %-22s extras=%4d  real=%4d  precision=%3.0f%%   (Transkun alone missed %d real notes in total)" % (label, len(s), real, 100 * real / max(1, len(s)), base[2]))
