"""How close is each guess of "when did the finger let go" to the truth? Truth = the MAESTRO MIDI (real key-off times).
Prediction = piano_worker.py output for the same piece's audio. Usage: python eval_release.py [R] [floor]"""
import bisect, json, sys
import mido

NAMES = ["schubert", "debussy", "scarlatti"]
R = int(sys.argv[1]) if len(sys.argv) > 1 else 5          # semitones: a later note this close replaces the key
FLOOR = float(sys.argv[2]) if len(sys.argv) > 2 else 0.15


def true_notes(path):
    mid = mido.MidiFile(path); t = 0.0; on = {}; notes = []; pedal = []; down = None
    for msg in mid:
        t += msg.time
        if msg.type == "note_on" and msg.velocity > 0: on[msg.note] = t
        elif msg.type in ("note_off", "note_on") and msg.note in on:
            notes.append({"m": msg.note, "t": on.pop(msg.note), "off": t})
        elif msg.type == "control_change" and msg.control == 64:
            if msg.value >= 64 and down is None: down = t
            elif msg.value < 64 and down is not None: pedal.append((down, t)); down = None
    return notes, pedal


def match(pred, truth):
    by = {}
    for i, n in enumerate(truth): by.setdefault(n["m"], []).append(i)
    used = set(); pairs = []
    for p in sorted(pred, key=lambda n: n["t"]):
        best = None
        for i in by.get(p["m"], []):
            if i in used: continue
            dt = abs(truth[i]["t"] - p["t"])
            if dt <= 0.05 and (best is None or dt < best[0]): best = (dt, i)
        if best: used.add(best[1]); pairs.append((p, truth[best[1]]))
    return pairs


def hand(m): return 1 if m < 60 else 0


def g_next_same_hand(p, ons):          # the rule in the app now
    a = ons[hand(p["m"])]; i = bisect.bisect_right(a, p["t"] + 0.04)
    gap = a[i] - p["t"] if i < len(a) else None
    return min(p["d"], max(FLOOR, gap - 0.03)) if gap is not None and gap <= 3 else min(p["d"], 1.0)


def g_pitch_aware(p, notes_by_hand):   # a later note in the same hand that is close in pitch replaces this key; far ones do not
    lst = notes_by_hand[hand(p["m"])]; ts = [n["t"] for n in lst]
    i = bisect.bisect_right(ts, p["t"] + 0.04)
    held = [p]                                                     # keys still down (for the five-finger limit)
    for q in lst[i:]:
        gap = q["t"] - p["t"]
        if gap > 3: break
        if abs(q["m"] - p["m"]) <= R:
            return min(p["d"], max(FLOOR, gap - 0.03))
    return min(p["d"], 1.0)


def stats(errs, lens):
    if not errs: return "n=0"
    ae = sorted(abs(e) for e in errs); n = len(ae)
    return "n=%5d  median|err|=%.3fs  within100ms=%4.1f%%  within250ms=%4.1f%%  mean bar=%.2fs" % (
        n, ae[n // 2], 100 * sum(a <= 0.1 for a in ae) / n, 100 * sum(a <= 0.25 for a in ae) / n, sum(lens) / n)


tot = {k: ([], []) for k in ("model length (no fix)", "fixed 0.3 s", "next note, same hand", "pitch-aware")}
pedal_aff = {k: ([], []) for k in tot}
for name in NAMES:
    try:
        pred = json.load(open(name + ".pred.json"))["notes"]
    except Exception as e:
        print(name, "no prediction yet:", e); continue
    truth, tpedal = true_notes(name + ".midi")
    pairs = match(pred, truth)
    hands = [[], []]
    for p in pred: hands[hand(p["m"])].append(p["t"])
    for h in hands: h.sort()
    by_hand = [sorted([p for p in pred if hand(p["m"]) == h], key=lambda n: n["t"]) for h in (0, 1)]
    def pedal_down_at(t): return any(a <= t <= b for a, b in tpedal)
    print("%s: %d predicted, %d true, %d matched (%.1f%%), true pedal presses: %d" % (name, len(pred), len(truth), len(pairs), 100 * len(pairs) / max(1, len(truth)), len(tpedal)))
    for p, tr in pairs:
        true_hold = tr["off"] - tr["t"]
        flagged = "kd" in p
        guesses = {
            "model length (no fix)": p["d"],
            "fixed 0.3 s": 0.3 if flagged else p["d"],
            "next note, same hand": g_next_same_hand(p, hands) if flagged else p["d"],
            "pitch-aware": g_pitch_aware(p, by_hand) if flagged else p["d"],
        }
        aff = pedal_down_at(tr["off"])
        for k, g in guesses.items():
            tot[k][0].append(g - true_hold); tot[k][1].append(g)
            if aff: pedal_aff[k][0].append(g - true_hold); pedal_aff[k][1].append(g)
print("\nALL matched notes (R=%d semitones, floor=%.2f s)" % (R, FLOOR))
for k, (e, l) in tot.items(): print("  %-24s %s" % (k, stats(e, l)))
print("\nonly notes whose real key release happened while the pedal was down")
for k, (e, l) in pedal_aff.items(): print("  %-24s %s" % (k, stats(e, l)))

# ---- how many notes whose sound overshoots the real key release does the helper flag at all? ----
over = flagged_over = 0
allpairs = []
for name in NAMES:
    try: pred = json.load(open(name + ".pred.json"))["notes"]
    except Exception: continue
    truth, tpedal = true_notes(name + ".midi")
    hands_on = [[], []]
    for p in pred: hands_on[hand(p["m"])].append(p["t"])
    for h in hands_on: h.sort()
    by_hand = [sorted([p for p in pred if hand(p["m"]) == h], key=lambda n: n["t"]) for h in (0, 1)]
    for p, tr in match(pred, truth):
        allpairs.append((p, tr, hands_on, by_hand))
        if p["d"] - (tr["off"] - tr["t"]) > 0.3:
            over += 1; flagged_over += "kd" in p
print("\nnotes whose model length is >0.3 s longer than the real key hold: %d (%.1f%% of matched); the helper flags %d of them (%.1f%%)" % (
    over, 100 * over / max(1, len(allpairs)), flagged_over, 100 * flagged_over / max(1, over)))

if len(sys.argv) > 3 and sys.argv[3] == "grid":
    # Try every note, not only the flagged ones, with: held = min(d, max(floor, min(cap, frac * gap))) where gap = time to the next
    # same-hand note within `reach` semitones (reach=99: any note). Score = share within 150 ms of the truth.
    def score(frac, cap, floor, reach, only_flagged):
        errs, lens = [], []
        for p, tr, hon, bh in allpairs:
            true_hold = tr["off"] - tr["t"]
            if only_flagged and "kd" not in p: g = p["d"]
            else:
                lst = bh[hand(p["m"])]; ts = [n["t"] for n in lst]; i = bisect.bisect_right(ts, p["t"] + 0.04); gap = None
                for q in lst[i:]:
                    if q["t"] - p["t"] > 3: break
                    if abs(q["m"] - p["m"]) <= reach: gap = q["t"] - p["t"]; break
                g = min(p["d"], max(floor, min(cap, frac * gap))) if gap is not None else min(p["d"], 1.0, cap)
            errs.append(abs(g - true_hold)); lens.append(g)
        n = len(errs); errs.sort()
        return (sum(e <= 0.15 for e in errs) / n, sum(e <= 0.25 for e in errs) / n, errs[n // 2], sum(lens) / n)
    rows = []
    for only in (True, False):
        for reach in (3, 5, 7, 12, 99):
            for frac in (0.5, 0.7, 0.85, 1.0):
                for cap in (0.4, 0.7, 1.0, 3.0):
                    for floor in (0.1, 0.15, 0.25):
                        w150, w250, med, ml = score(frac, cap, floor, reach, only)
                        rows.append((w150, w250, med, ml, only, reach, frac, cap, floor))
    rows.sort(reverse=True)
    print("\nbest 12 settings by share within 150 ms of the real release (apply to flagged notes only: %s)")
    print("  w150   w250  median  meanbar  flaggedOnly reach frac  cap  floor")
    for r in rows[:12]: print("  %.3f  %.3f  %.3f  %.2f     %-5s       %2d   %.2f  %.1f  %.2f" % r)
    print("\nbest with flagged-only (what the helper does now):")
    for r in [x for x in rows if x[4]][:5]: print("  %.3f  %.3f  %.3f  %.2f     %-5s       %2d   %.2f  %.1f  %.2f" % r)
