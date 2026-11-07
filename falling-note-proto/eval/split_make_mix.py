"""Makes the test mix for comparing stem splitters: a real piano recording (30 s of a MAESTRO piece) plus a synthetic drum loop and bass line, both
mixed together and saved apart so each splitter's output can be scored against the true parts.
usage: python split_make_mix.py piano.wav out_dir      (writes mix.wav, t_piano.wav, t_drums.wav, t_bass.wav; needs numpy, soundfile)
The drums (kick, snare, hats at 110 BPM) and bass (a one-note-per-beat line) are made up, so they are an unusual test for a splitter built on real
band recordings: treat the piano numbers as the informative ones, and the drum and bass numbers as a sanity check."""
import os, sys
import numpy as np, soundfile as sf
p, sr = sf.read(sys.argv[1], dtype="float32", always_2d=True); out = sys.argv[2]; os.makedirs(out, exist_ok=True)
n = sr * 30; p = p[sr * 20: sr * 20 + n]
if p.shape[1] == 1: p = np.repeat(p, 2, 1)
p = p[:, :2] / (np.abs(p).max() + 1e-9) * 0.5
rng = np.random.default_rng(0); bpm = 110; beat = 60 / bpm
drums = np.zeros(n, np.float32)
for k in range(int(30 / beat) + 1):
    t0 = int(k * beat * sr); L = int(0.25 * sr); tt = np.arange(L) / sr
    if t0 + L < n:
        if k % 2 == 0: drums[t0:t0 + L] += (np.sin(2 * np.pi * (55 + 90 * np.exp(-tt * 30)) * tt) * np.exp(-tt * 12)).astype(np.float32) * 0.9
        else: drums[t0:t0 + L] += (rng.normal(0, 1, L) * np.exp(-tt * 22) * 0.5).astype(np.float32)
    for h in (0, 0.5):
        t1 = int((k + h) * beat * sr); L2 = int(0.05 * sr)
        if t1 + L2 < n: drums[t1:t1 + L2] += (rng.normal(0, 1, L2) * np.exp(-np.arange(L2) / sr * 90) * 0.18).astype(np.float32)
bass = np.zeros(n, np.float32); notes = [41, 41, 44, 36, 41, 41, 46, 43]
for k in range(int(30 / beat) + 1):
    f = 440 * 2 ** ((notes[k % 8] - 69) / 12); a = int(k * beat * sr); b = min(n, int((k + 0.9) * beat * sr))
    if a < n:
        seg = np.arange(b - a) / sr; bass[a:b] += (0.5 * np.sin(2 * np.pi * f * seg) + 0.2 * np.sin(2 * np.pi * 2 * f * seg)) * np.exp(-seg * 2.5)
d2 = np.stack([drums, drums], 1) * 0.7; b2 = np.stack([bass, bass], 1) * 0.8; mix = p + d2 + b2; mix /= np.abs(mix).max() * 1.05
for nm, a in (("mix", mix), ("t_piano", p), ("t_drums", d2), ("t_bass", b2)): sf.write(os.path.join(out, nm + ".wav"), a.astype(np.float32), sr, subtype="PCM_16")
print("written to", out)
