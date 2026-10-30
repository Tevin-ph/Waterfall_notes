import sys, json, io, contextlib
sys.argv = ["x", "5", "0.15"]
with contextlib.redirect_stdout(io.StringIO()):
    import eval_release as E
def run(label, f):
    errs = []; lens = []; flagged = 0; total = 0
    for name in E.NAMES:
        pred = json.load(open(name + f))["notes"]; truth, _ = E.true_notes(name + ".midi")
        for p, tr in E.match(pred, truth):
            g = p.get("kd", p["d"]) if "new" in f else p["d"]
            errs.append(abs(g - (tr["off"] - tr["t"]))); lens.append(g); total += 1; flagged += "kd" in p
    n = len(errs); errs.sort()
    print("%-34s n=%d within100=%4.1f%% within150=%4.1f%% within250=%4.1f%% median=%.3fs mean bar=%.2fs  notes given a held length: %.0f%%" % (
        label, n, 100*sum(x<=.1 for x in errs)/n, 100*sum(x<=.15 for x in errs)/n, 100*sum(x<=.25 for x in errs)/n, errs[n//2], sum(lens)/n, 100*flagged/n))
run("model's own length", ".pred.json")
run("shipped helper now (kd)", ".new.json")
