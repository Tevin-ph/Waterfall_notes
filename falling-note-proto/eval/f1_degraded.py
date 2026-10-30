import sys, json, io, contextlib
sys.argv = ["x", "5", "0.15"]
with contextlib.redirect_stdout(io.StringIO()):
    import eval_release as E
def run(suffix):
    tp = fp = fn = 0; offok = 0
    for nm in E.NAMES:
        pr = json.load(open(nm + suffix))["notes"]; truth, _ = E.true_notes(nm + ".midi"); m = E.match(pr, truth)
        tp += len(m); fp += len(pr) - len(m); fn += len(truth) - len(m)
    p, r = tp / (tp + fp), tp / (tp + fn); return p, r, 2 * p * r / (p + r), fp, fn
print("%-22s precision recall   F1    false notes  missed notes" % "")
for lab, suf in (("clean recording", ".pred.json"), ("phone-style", ".deg.json"), ("phone-style + denoise", ".dn.json")):
    p, r, f, fp, fn = run(suf); print("%-22s %6.1f%% %6.1f%% %6.1f%%   %6d      %6d" % (lab, 100 * p, 100 * r, 100 * f, fp, fn))
