"""Score a scanned MusicXML against the true one, note by note.

A scanned note is correct when a true note has the same pitch, starts at the same place in the music (within 1/16 of a quarter note) and,
for the strict score, lasts about as long (within 25%). Repeats and ornaments are left as written (not expanded), the same as the app's reader.
usage: python omr_score.py truth.xml scanned.xml
"""
import re
import sys
import xml.etree.ElementTree as ET
from fractions import Fraction

STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def strip(root):
    for el in root.iter():
        if "}" in el.tag:
            el.tag = el.tag.split("}", 1)[1]
    return root


def read_notes(path):
    """-> list of (part_index, bar*1000 + offset in the bar in quarter notes, midi pitch, length in quarter notes). Tied notes are joined; grace notes and rests skipped."""
    text = open(path, encoding="utf-8", errors="replace").read()
    text = re.sub(r"<!DOCTYPE[^>]*>", "", text)
    root = strip(ET.fromstring(text))
    out = []
    for pi, part in enumerate(root.iter("part")):
        divisions, t = Fraction(1), Fraction(0)
        open_ties = {}
        for mi, meas in enumerate(part.findall("measure")):
            mstart, pos, mend = t, t, t
            for el in meas:
                if el.tag == "attributes":
                    d = el.find("divisions")
                    if d is not None:
                        divisions = Fraction(int(float(d.text)))
                elif el.tag == "backup":
                    pos -= Fraction(int(el.find("duration").text)) / divisions
                elif el.tag == "forward":
                    pos += Fraction(int(el.find("duration").text)) / divisions
                elif el.tag == "note":
                    chord = el.find("chord") is not None
                    dur_el = el.find("duration")
                    dur = Fraction(int(float(dur_el.text))) / divisions if dur_el is not None else Fraction(0)
                    start = pos if not chord else last_start
                    if not chord:
                        last_start = pos
                        pos += dur
                    if el.find("grace") is not None or el.find("rest") is not None:
                        mend = max(mend, pos)
                        continue
                    p = el.find("pitch")
                    if p is None:
                        continue
                    midi = 12 * (int(p.find("octave").text) + 1) + STEP[p.find("step").text] + int(float(p.find("alter").text)) if p.find("alter") is not None else \
                        12 * (int(p.find("octave").text) + 1) + STEP[p.find("step").text]
                    ties = [x.get("type") for x in el.findall("tie")]
                    key = (midi, el.findtext("staff", "1"))
                    if "stop" in ties and key in open_ties:
                        n = open_ties[key]
                        n[3] += dur
                        if "start" not in ties:
                            del open_ties[key]
                        continue
                    n = [pi, mi * 1000 + (start - mstart), midi, dur]      # place = bar number and offset in the bar, so one wrong bar doesn't shift everything after it
                    out.append(n)
                    if "start" in ties:
                        open_ties[key] = n
                mend = max(mend, pos)
            t = mend
    return [tuple(n) for n in out]


def match(truth, got, strict):
    from collections import defaultdict
    by = defaultdict(list)
    for i, (pi, on, m, d) in enumerate(truth):
        by[m].append(i)
    used, hit = set(), 0
    for (pi, on, m, d) in sorted(got, key=lambda n: n[1]):
        best = None
        for i in by.get(m, []):
            if i in used:
                continue
            t_on, t_d = truth[i][1], truth[i][3]
            if abs(t_on - on) > Fraction(1, 16):
                continue
            if strict and t_d and abs(t_d - d) > Fraction(1, 4) * t_d:
                continue
            best = i
            break
        if best is not None:
            used.add(best)
            hit += 1
    return hit


def score(truth_path, got_path):
    truth, got = read_notes(truth_path), read_notes(got_path)
    res = {"truth": len(truth), "scanned": len(got)}
    for name, strict in (("pitch+position", False), ("pitch+position+length", True)):
        h = match(truth, got, strict)
        p, r = h / max(1, len(got)), h / max(1, len(truth))
        res[name] = {"precision": round(100 * p, 1), "recall": round(100 * r, 1), "f1": round(200 * p * r / max(1e-9, p + r), 1)}
    return res


if __name__ == "__main__":
    print(score(sys.argv[1], sys.argv[2]))


def bar_check(path):
    """Self-check that needs no answer key: the share of bars whose notes and rests add up to the time signature in every voice that has any.
    A scan with misread rhythm has bars that are too long or short. First and last bar of each part are skipped (pickup / last bar can be short).
    Returns (bars checked, bars that add up)."""
    text = re.sub(r"<!DOCTYPE[^>]*>", "", open(path, encoding="utf-8", errors="replace").read())
    root = strip(ET.fromstring(text))
    checked = ok = 0
    for part in root.iter("part"):
        divisions, nominal = Fraction(1), None
        ms = part.findall("measure")
        for mi, meas in enumerate(ms):
            for el in meas.iter("attributes"):
                d = el.find("divisions")
                if d is not None:
                    divisions = Fraction(int(float(d.text)))
                tm = el.find("time")
                if tm is not None and tm.find("beats") is not None and tm.find("beat-type") is not None:
                    try:
                        nominal = Fraction(int(tm.find("beats").text)) * 4 / Fraction(int(tm.find("beat-type").text))
                    except ValueError:
                        nominal = None
            if nominal is None or mi == 0 or mi == len(ms) - 1:
                continue
            voices = {}
            for el in meas:
                if el.tag == "note" and el.find("chord") is None and el.find("grace") is None:
                    key = (el.findtext("staff", "1"), el.findtext("voice", "1"))
                    dur = el.find("duration")
                    voices[key] = voices.get(key, Fraction(0)) + (Fraction(int(float(dur.text))) / divisions if dur is not None else 0)
            if not voices:
                continue
            checked += 1
            if all(v == nominal for v in voices.values()):
                ok += 1
    return checked, ok
