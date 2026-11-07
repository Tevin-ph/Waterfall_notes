"""Scores stem-splitter outputs made with split_worker.py against the true parts from split_make_mix.py.
usage: python split_compare.py test_dir      test_dir holds mix.wav, t_*.wav and one folder per run:
  out (Demucs on the mix), out_rf (BS-RoFormer on the mix), out_piano (Demucs on t_piano.wav alone), out_rf_piano (BS-RoFormer on t_piano.wav alone)
Prints SDR (dB, higher is better) of the drums, bass and piano stems on the mix, and where the energy of a solo piano ends up (all of it should be in piano)."""
import json, os, sys
import numpy as np, soundfile as sf
d = sys.argv[1]; names = ("vocals", "drums", "bass", "guitar", "piano", "other")
load = lambda p: sf.read(p, dtype="float32", always_2d=True)[0].mean(1)
sdr = lambda ref, est: 10 * np.log10(np.sum(ref ** 2) / (np.sum((ref - est) ** 2) + 1e-12))
truth = {k: load(f"{d}/t_{k}.wav") for k in ("piano", "drums", "bass")}
print("mix: SDR in dB against the true parts; energy share per stem")
for eng, sub in (("demucs", "out"), ("roformer", "out_rf")):
    o = f"{d}/{sub}"
    if not os.path.exists(o + "/stems.json"): continue
    st = {n: load(f"{o}/{n}.wav") for n in names}; n = min(len(v) for v in st.values()); meta = {s["name"]: s for s in json.load(open(o + "/stems.json"))["stems"]}
    print(f"  {eng:9} drums {sdr(truth['drums'][:n], st['drums'][:n]):5.1f}  bass {sdr(truth['bass'][:n], st['bass'][:n]):5.1f}  piano {sdr(truth['piano'][:n], st['piano'][:n]):5.1f}   shares: " + " ".join(f"{k} {meta[k]['share']*100:.1f}%" for k in names))
print("solo piano: share of the energy in each stem")
for eng, sub in (("demucs", "out_piano"), ("roformer", "out_rf_piano")):
    o = f"{d}/{sub}"
    if not os.path.exists(o + "/stems.json"): continue
    meta = {s["name"]: s for s in json.load(open(o + "/stems.json"))["stems"]}
    print(f"  {eng:9} " + " ".join(f"{k} {meta[k]['share']*100:.1f}%" for k in names))
