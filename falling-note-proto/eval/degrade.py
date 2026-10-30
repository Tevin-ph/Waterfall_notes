"""Make a recording sound like a phone/Instagram clip: room echo, noise, narrow band, light compression. Deterministic (seeded)."""
import sys, numpy as np, soundfile as sf
from scipy.signal import fftconvolve, butter, sosfilt
name = sys.argv[1]
x, sr = sf.read(name + ".wav", dtype="float32", always_2d=True); x = x.mean(axis=1)
rng = np.random.default_rng(7)
n = int(0.7 * sr); t = np.arange(n) / sr
ir = rng.standard_normal(n) * np.exp(-6.9 * t / 0.8); ir[0] = 1.0; ir /= np.abs(ir).sum() / 4        # about 0.8 s of room
wet = fftconvolve(x, ir)[: len(x)]; y = 0.65 * x + 0.35 * wet / (np.abs(wet).max() + 1e-9) * np.abs(x).max()
noise = np.cumsum(rng.standard_normal(len(y))); noise -= np.convolve(noise, np.ones(2000) / 2000, mode="same"); noise /= noise.std() + 1e-9   # brown-ish hiss
sig = y.std(); y = y + noise * sig / (10 ** (12 / 20))                                                                                # 12 dB signal-to-noise
y = sosfilt(butter(4, [150, 6000], btype="band", fs=sr, output="sos"), y)                                                              # phone-ish band
y = np.tanh(2.2 * y / (np.abs(y).max() + 1e-9)) / np.tanh(2.2)                                                                         # light compression
sf.write(name + ".deg.wav", (0.9 * y / np.abs(y).max()).astype("float32"), sr)
print(name, "degraded", len(y) / sr, "s")
