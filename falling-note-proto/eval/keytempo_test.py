"""Key and tempo as the Splitter page works them out (librosa; same method as split_worker.py analyse), on the sounds made by keytempo_make_tests.py.
usage: python keytempo_test.py dir   (needs librosa). Result when written: key right on 8 of 9 with Temperley profiles (7 of 9 with Krumhansl), tempo exact on 3 of 6, 2 more at half or double."""
import json, os, sys, numpy as np, librosa, warnings
warnings.filterwarnings("ignore")
d = sys.argv[1]; tests = json.load(open(d + "/tests.json")); SR = 22050
MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]); MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
# Temperley-style profiles are often better on pop/classical mixes; try both
TMAJ = np.array([5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0]); TMIN = np.array([5.0, 2.0, 3.5, 4.5, 2.0, 4.0, 2.0, 4.5, 3.5, 2.0, 1.5, 4.0])
def key(x, profiles):
    y = librosa.effects.harmonic(x, margin=4)
    tun = librosa.estimate_tuning(y=y, sr=SR)
    c = librosa.feature.chroma_cqt(y=y, sr=SR, tuning=tun, n_chroma=12, bins_per_octave=36)
    c = c / (c.sum(0, keepdims=True) + 1e-9); h = c.mean(1)
    best = None
    for t in range(12):
        for p, mn in ((profiles[0], False), (profiles[1], True)):
            r = np.corrcoef(np.roll(h, -t), p)[0, 1]
            if best is None or r > best[0]: best = (r, t, mn)
    return best
res = {"KS": [0, 0, 0], "Temperley": [0, 0, 0]}; tmp = [0, 0, 0]
for t in tests:
    x = np.fromfile(f"{d}/{t['name']}.f32", dtype=np.float32)
    if "bpm" in t:
        oenv = librosa.onset.onset_strength(y=x, sr=SR)
        b = librosa.beat.tempo(onset_envelope=oenv, sr=SR, start_bpm=120)[0]
        ok = abs(b - t["bpm"]) <= 1.5; oct_ = any(abs(b - t["bpm"] * m) <= 1.5 for m in (0.5, 2)); tmp[0] += ok; tmp[1] += (not ok and oct_); tmp[2] += 1
        print(f"{t['name']:16} true {t['bpm']:>4} librosa {b:6.1f} {'ok' if ok else 'octave' if oct_ else 'WRONG'}")
    else:
        row = []
        for nm, prof in (("KS", (MAJOR, MINOR)), ("Temperley", (TMAJ, TMIN))):
            r, tonic, mn = key(x, prof); ok = tonic == t["tonic"] and mn == t["minor"]; rel = (not ok) and ((t["minor"] and not mn and tonic == (t["tonic"] + 3) % 12) or ((not t["minor"]) and mn and tonic == (t["tonic"] + 9) % 12))
            res[nm][0] += ok; res[nm][1] += rel; res[nm][2] += 1
            row.append(f"{nm}: {'ok' if ok else 'relative' if rel else 'WRONG'}")
        print(f"{t['name']:16} {'  '.join(row)}")
print("tempo exact", tmp[0], "octave", tmp[1], "of", tmp[2]); print("key:", res)
