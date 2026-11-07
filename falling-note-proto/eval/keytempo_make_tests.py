"""Makes the test sounds for keytempo_test.py: raw mono float32 files at 22050 Hz in out_dir, plus tests.json with the right answers.
Made-up sounds with a known key or tempo, and real piano recordings (MAESTRO, in _test/maestro) whose key is worked out from their MIDI notes.
usage: python keytempo_make_tests.py out_dir [maestro_dir]    (needs numpy, scipy, soundfile, pretty_midi)"""
import json, os, sys
import numpy as np, soundfile as sf
from scipy.signal import resample_poly

SR = 22050
out = sys.argv[1]; maestro = sys.argv[2] if len(sys.argv) > 2 else None
os.makedirs(out, exist_ok=True)
rng = np.random.default_rng(1)
tests = []

def save(name, x, **truth):
    np.asarray(x / (np.abs(x).max() + 1e-9) * 0.8, dtype=np.float32).tofile(os.path.join(out, name + ".f32"))
    tests.append(dict(name=name, **truth))

def drums(bpm, secs, swing=0.0):
    n = int(secs * SR); x = np.zeros(n); beat = 60 / bpm
    for k in range(int(secs / beat) + 1):
        for sub, kind in ((0, "k" if k % 2 == 0 else "s"), (0.5, "h")):
            t0 = int((k + sub) * beat * SR); L = int(0.2 * SR); tt = np.arange(L) / SR
            if t0 + L >= n: continue
            if kind == "k": x[t0:t0+L] += np.sin(2*np.pi*(55+90*np.exp(-tt*30))*tt)*np.exp(-tt*12)
            elif kind == "s": x[t0:t0+L] += rng.normal(0, 1, L)*np.exp(-tt*22)*0.5
            else: x[t0:t0+L] += rng.normal(0, 1, L)*np.exp(-tt*90)*0.15
    return x

def chord_tones(root_midi, minor, secs_each, n_chords_degrees, scale_degrees):
    pass

def progression(tonic, minor, secs=24, chord_secs=1.5):
    # tonic (0-11) as pitch class; chords on degrees I IV V I (major) or i iv V i (minor), arpeggiated, with 5 harmonics
    maj = [0, 4, 7]; mnr = [0, 3, 7]
    degs = [(0, minor), (5, minor), (7, False), (0, minor)]
    n = int(secs * SR); x = np.zeros(n); t = 0.0; i = 0
    while t < secs:
        d, m = degs[i % 4]; root = 48 + tonic + d
        for j, off in enumerate(mnr if m else maj):
            for k in range(int(chord_secs / 0.25)):
                midi = root + off + (12 if (k % 3 == 1) else 0) + (12 if j == 2 and k % 2 else 0)
                f = 440 * 2 ** ((midi - 69) / 12); a = int((t + k * 0.25) * SR); L = int(0.3 * SR)
                if a + L >= n: continue
                tt = np.arange(L) / SR
                x[a:a+L] += sum(np.sin(2*np.pi*f*h*tt)/h for h in range(1, 6))*np.exp(-tt*5)*(0.5 if j else 0.7)
        t += chord_secs; i += 1
    return x

for bpm in (70, 90, 100, 128, 140, 174):
    save("tempo_%d" % bpm, drums(bpm, 24), bpm=bpm)
names = ["C","C#","D","Eb","E","F","F#","G","Ab","A","Bb","B"]
for tonic, minor in ((0, False), (3, False), (6, False), (9, True), (2, True), (4, True)):
    save("key_%s_%s" % (names[tonic], "min" if minor else "maj"), progression(tonic, minor), tonic=tonic, minor=minor)

if maestro:
    import pretty_midi
    MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]; MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
    for nm in ("debussy", "scarlatti", "schubert"):
        mid = os.path.join(maestro, nm + ".midi"); wav = os.path.join(maestro, nm + ".wav")
        if not (os.path.exists(mid) and os.path.exists(wav)): continue
        h = np.zeros(12)
        for ins in pretty_midi.PrettyMIDI(mid).instruments:
            for n in ins.notes: h[n.pitch % 12] += min(2, max(0.1, n.end - n.start))
        best = max(((np.corrcoef(np.roll(h, -t), p)[0, 1], t, mn) for t in range(12) for p, mn in ((MAJOR, False), (MINOR, True))))
        a, sr = sf.read(wav, dtype="float32", always_2d=True); a = resample_poly(a.mean(1), SR, sr)
        save("real_" + nm, a[: SR * 120], tonic=best[1], minor=best[2], note="key from the MIDI notes of the same performance")
json.dump(tests, open(os.path.join(out, "tests.json"), "w"), indent=1)
print(len(tests), "tests written to", out)
