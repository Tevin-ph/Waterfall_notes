"""MusicXML (ASAP piano scores) -> notes with the true hand: staff 1 = right hand (0), staff 2 = left hand (1). Time in seconds at the score's first tempo."""
import json, os, sys, xml.etree.ElementTree as ET
STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
def parse(path):
    root = ET.parse(path).getroot(); notes = []; tempo = 100.0
    for s in root.iter("sound"):
        if s.get("tempo"): tempo = float(s.get("tempo")); break
    for part in root.findall("part"):
        divisions = 1; pos = 0; open_tie = {}
        for meas in part.findall("measure"):
            mstart = pos
            last_onset = pos
            for el in meas:
                tag = el.tag
                if tag == "attributes":
                    d = el.find("divisions")
                    if d is not None: divisions = int(float(d.text))
                elif tag == "backup": pos -= int(float(el.find("duration").text))
                elif tag == "forward": pos += int(float(el.find("duration").text))
                elif tag == "note":
                    dur_el = el.find("duration"); dur = int(float(dur_el.text)) if dur_el is not None else 0
                    is_chord = el.find("chord") is not None
                    onset = last_onset if is_chord else pos
                    if not is_chord: last_onset = onset
                    if el.find("grace") is None and el.find("rest") is None and el.find("pitch") is not None:
                        p = el.find("pitch"); m = 12 * (int(p.find("octave").text) + 1) + STEP[p.find("step").text] + int(float(p.find("alter").text)) if p.find("alter") is not None else 12 * (int(p.find("octave").text) + 1) + STEP[p.find("step").text]
                        st = el.find("staff"); staff = int(st.text) if st is not None else 1
                        ties = [t.get("type") for t in el.findall("tie")]
                        key = (staff, m)
                        if "stop" in ties and key in open_tie:
                            open_tie[key]["dur"] += dur
                            if "start" not in ties: del open_tie[key]
                        else:
                            n = {"m": m, "on": onset, "dur": dur, "h": 0 if staff == 1 else 1, "div": divisions}
                            notes.append(n)
                            if "start" in ties: open_tie[key] = n
                    if not is_chord: pos += dur
            # measures advance to the end of the longest voice
            pos = max(pos, mstart)
    out = []
    for n in notes:
        q = 60.0 / tempo / n["div"]
        out.append({"m": n["m"], "t": round(n["on"] * q, 4), "d": round(max(0.05, n["dur"] * q * 0.92), 4), "v": 0.7, "h": n["h"]})
    out.sort(key=lambda n: (n["t"], n["m"]))
    return out, tempo
if __name__ == "__main__":
    os.makedirs("asap_json", exist_ok=True)
    for f in sorted(os.listdir("asap")):
        try: notes, tempo = parse("asap/" + f)
        except Exception as e: print("FAIL", f, e); continue
        json.dump(notes, open("asap_json/" + f.replace(".musicxml", ".json"), "w"))
        r = sum(1 for n in notes if n["h"] == 0); lo = sum(1 for n in notes if n["m"] < 60 and n["h"] == 0); hi = sum(1 for n in notes if n["m"] >= 60 and n["h"] == 1)
        c4 = sum(1 for n in notes if (n["m"] < 60) == (n["h"] == 1))
        print("%-46s notes=%5d right=%4.0f%% dur=%4.0fs  C4-split accuracy=%.1f%%  (right-hand notes below C4: %d, left-hand notes at/above C4: %d)" % (f[:46], len(notes), 100 * r / len(notes), notes[-1]["t"], 100 * c4 / len(notes), lo, hi))
