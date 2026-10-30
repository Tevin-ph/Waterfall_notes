"""Transkun vs the ByteDance model (with the helper's key-hold guess) on clean and phone-style copies of three MAESTRO pieces, as 16 kHz mono
clips (what the app sends). Needs <name>.pred.json / <name>.deg.json (ByteDance) and <name>[.deg].tkw.json (Transkun) next to the MIDI files.
Run with the piano environment's python from this folder."""
import sys, json, io, contextlib
sys.path.insert(0, "..")
sys.argv = ["x", "5", "0.15"]
with contextlib.redirect_stdout(io.StringIO()):
    import eval_release as E
sys.path.insert(0, "../..")
import piano_worker as W

def bytedance_shown(path):                       # what the app shows for the ByteDance engine: the pedal-gated key-hold guess
    d = json.load(open(path)); pedals = [(p["t"], p["t"] + p["d"]) for p in d["pedal"]]
    hands = {0: [], 1: []}
    for n in d["notes"]: hands[1 if n["m"] < 60 else 0].append(n["t"])
    for h in hands.values(): h.sort()
    out = []
    for n in d["notes"]:
        n = dict(n); on, off = n["t"], n["t"] + n["d"]
        if n["d"] > 0.2 and any(a <= off and b >= on for a, b in pedals):
            kd = W.held_length(on, n["d"], hands[1 if n["m"] < 60 else 0])
            if kd < n["d"] - 0.08: n["d"] = kd
        out.append(n)
    return out

rows = {"ByteDance + key-hold guess": {"clean": [0, 0, 0, [], 0], "phone": [0, 0, 0, [], 0]}, "Transkun": {"clean": [0, 0, 0, [], 0], "phone": [0, 0, 0, [], 0]}}
for nm in E.NAMES:
    truth, _ = E.true_notes(nm + ".midi")
    for kind, bd, tk in (("clean", nm + ".pred.json", nm + ".tkw.json"), ("phone", nm + ".deg.json", nm + ".deg.tkw.json")):
        for label, notes in (("ByteDance + key-hold guess", bytedance_shown(bd)), ("Transkun", json.load(open(tk))["notes"])):
            m = E.match(notes, truth); r = rows[label][kind]
            r[0] += len(m); r[1] += len(notes) - len(m); r[2] += len(truth) - len(m)
            r[3] += [abs(p["d"] - (t["off"] - t["t"])) for p, t in m]; r[4] += sum(p["d"] for p, _ in m)
print("3 MAESTRO pieces (4290+ real notes), 16 kHz mono clips as the app sends them")
print("%-28s %-6s %9s %7s %7s | %7s %7s | %s" % ("engine", "audio", "precision", "recall", "F1", "false", "missed", "key hold within 150 ms / mean bar"))
for label, d in rows.items():
    for kind, (tp, fp, fn, errs, tot) in d.items():
        p, r = tp / (tp + fp), tp / (tp + fn)
        print("%-28s %-6s %8.1f%% %6.1f%% %6.1f%% | %7d %7d | %.1f%% / %.2fs" % (label, kind, 100 * p, 100 * r, 200 * p * r / (p + r), fp, fn, 100 * sum(e <= .15 for e in errs) / len(errs), tot / tp))
