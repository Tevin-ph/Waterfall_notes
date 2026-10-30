import numpy as np, soundfile as sf, librosa
from scipy.signal import stft
def noisiness(x, sr):
    """noise floor (12th percentile per frequency) as a share of the typical level, in the band where piano lives"""
    f, t, Z = stft(x, fs=sr, nperseg=2048, noverlap=1536); mag = np.abs(Z)[(f >= 100) & (f <= 5000)]
    return float(np.percentile(mag, 12, axis=1).mean() / (np.median(mag.max(axis=0)) + 1e-9))
for nm in ("schubert", "debussy", "scarlatti"):
    row = []
    for suf in ("", ".deg", ".dn"):
        x, sr = sf.read(nm + suf + ".wav", dtype="float32", always_2d=True); x = x.mean(axis=1)
        if sr != 16000: x = librosa.resample(x, orig_sr=sr, target_sr=16000)
        x = x / (np.abs(x).max() + 1e-9); row.append(noisiness(x, 16000))
    print("%-10s clean=%.4f  phone-style=%.4f  after denoise=%.4f" % ((nm,) + tuple(row)))
