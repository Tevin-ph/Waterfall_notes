"""Splits a song into stems with Demucs, in the piano environment (torch + demucs; no torchaudio or ffmpeg needed).

usage: python split_worker.py input.wav out_dir [model]
  input.wav: any sample rate, mono or stereo (the app sends 44.1 kHz stereo)
  model: htdemucs_6s (default: vocals, drums, bass, guitar, piano, other)  |  htdemucs_ft (4 stems, better on those four: vocals, drums, bass, other)
         bsroformer_sw (6 stems, a BS-RoFormer; needs ~/.waterfall-notes/models/bs-roformer-sw/ and ~/.waterfall-notes/msst, see setup_split.ps1)
Writes out_dir/<stem>.wav (16-bit stereo at the model's rate, 44.1 kHz) and out_dir/stems.json:
  {"model", "rate", "seconds", "stems": [{"name", "rms_db", "active", "share", "present"}]}
`active` is the share of 1-second windows where the stem is audible, `share` its share of the song's total energy; `present` is the identifier's verdict
that the instrument really is in the song (a stem that is silent, or only bleed from the louder ones, is marked absent so the app can grey it out).
Prints "PROGRESS 0.xx" lines while it works (0 to 1, the separation itself), then "DONE".
"""
import json
import os
import sys

import numpy as np
import soundfile as sf
import torch

ACTIVE_DB = -45          # a 1 s window counts as playing above this level (dBFS)
PRESENT_ACTIVE = 0.04    # present when audible in at least 4% of the song...
PRESENT_SHARE = 0.03     # ...and carrying at least 3% of the song's total energy (bleed from the loud stems into the others is usually under that;
                         # a guess: measured on one synthetic mix only, not on real band recordings)


NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"]
TEMPERLEY_MAJOR = [5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0]
TEMPERLEY_MINOR = [5.0, 2.0, 3.5, 4.5, 2.0, 4.0, 2.0, 4.5, 3.5, 2.0, 1.5, 4.0]


def analyse(names, arrays, rate):
    """Key and tempo of the song, from the separated parts: the key from everything except the drums (they say nothing about it), the tempo from the
    drums when there are any. Tested on made-up sounds and three real piano pieces: key right on 8 of 9 (Temperley profiles on a harmonic CQT chroma),
    tempo exact on 3 of 6 with the others at half or double speed, a known ambiguity. Returns {} if librosa isn't there."""
    try:
        import librosa
    except ImportError:
        return {}
    out = {}
    try:
        tonal = sum(a.mean(axis=0) for n, a in zip(names, arrays) if n != "drums")
        y = librosa.resample(np.asarray(tonal, dtype=np.float32), orig_sr=rate, target_sr=22050)
        y = librosa.effects.harmonic(y, margin=4)
        c = librosa.feature.chroma_cqt(y=y, sr=22050, tuning=librosa.estimate_tuning(y=y, sr=22050), bins_per_octave=36)
        h = (c / (c.sum(0, keepdims=True) + 1e-9)).mean(1)
        res = sorted(((np.corrcoef(np.roll(h, -t), p)[0, 1], t, minor) for t in range(12) for p, minor in ((TEMPERLEY_MAJOR, False), (TEMPERLEY_MINOR, True))), reverse=True)
        lab = lambda k: NAMES[k[1]] + (" minor" if k[2] else " major")
        out["key"] = {"name": lab(res[0]), "alt": lab(res[1]), "score": round(float(res[0][0]), 3)}
    except Exception as e:
        print("key failed:", e, flush=True)
    try:
        beat = [a for n, a in zip(names, arrays) if n == "drums"]
        z = beat[0].mean(axis=0) if beat and float(np.mean(beat[0] ** 2)) > 1e-7 else sum(a.mean(axis=0) for a in arrays)
        z = librosa.resample(np.asarray(z, dtype=np.float32), orig_sr=rate, target_sr=22050)
        out["bpm"] = round(float(librosa.beat.tempo(onset_envelope=librosa.onset.onset_strength(y=z, sr=22050), sr=22050, start_bpm=120)[0]), 1)
    except Exception as e:
        print("tempo failed:", e, flush=True)
    return out


def stem_stats(x, rate, total_energy):
    mono = x.mean(axis=0)
    energy = float(np.mean(mono ** 2))
    rms = float(np.sqrt(energy) + 1e-12)
    win = rate
    n = max(1, len(mono) // win)
    wins = np.sqrt(np.mean(mono[: n * win].reshape(n, win) ** 2, axis=1) + 1e-12)
    active = float(np.mean(20 * np.log10(wins) > ACTIVE_DB))
    share = energy / max(total_energy, 1e-12)
    return {"rms_db": round(20 * np.log10(rms), 1), "active": round(active, 3), "share": round(share, 3), "present": bool(active >= PRESENT_ACTIVE and share >= PRESENT_SHARE)}


HOME = os.path.join(os.path.expanduser("~"), ".waterfall-notes")
ROFORMER_DIR = os.path.join(HOME, "models", "bs-roformer-sw")


def pick_device():
    """The graphics card when this environment's PyTorch can use one (split-venv), else the CPU. SPLIT_DEVICE=cpu forces the CPU."""
    if os.environ.get("SPLIT_DEVICE", "").lower() != "cpu" and torch.cuda.is_available():
        return "cuda"
    return "cpu"


def separate_roformer(x, progress, device="cpu"):
    """x: (2, samples) float tensor at 44.1 kHz, as is. -> (stems, 2, samples), names. Chunks of 13 s overlapped by half and cross-faded, as in the
    reference inference code (ZFTurbo/Music-Source-Separation-Training, MIT), which supplies the model definition."""
    import torch.nn.functional as F
    import yaml
    sys.path.insert(0, os.path.join(HOME, "msst"))
    from models.bs_roformer import BSRoformer
    with open(os.path.join(ROFORMER_DIR, "BS-Rofo-SW-Fixed.yaml")) as f:
        cfg = yaml.load(f, Loader=yaml.FullLoader)
    model = BSRoformer(**cfg["model"])
    state = torch.load(os.path.join(ROFORMER_DIR, "BS-Rofo-SW-Fixed.ckpt"), map_location="cpu", weights_only=False)
    model.load_state_dict(state.get("state_dict", state) if isinstance(state, dict) else state)
    model.eval().to(device)
    names = cfg["training"]["instruments"]
    chunk = cfg["audio"]["chunk_size"]
    step = chunk // cfg["inference"]["num_overlap"]
    fade = chunk // 10
    border = chunk - step
    length = x.shape[1]
    mix = F.pad(x, (border, border), mode="reflect") if length > 2 * border else x
    n = mix.shape[1]
    window = torch.ones(chunk)
    window[:fade] = torch.linspace(0, 1, fade)
    window[-fade:] = torch.linspace(1, 0, fade)
    result = torch.zeros(len(names), 2, n)
    counter = torch.zeros(n)
    with torch.no_grad():
        i = 0
        while i < n:
            part = mix[:, i:i + chunk]
            L = part.shape[-1]
            part = F.pad(part, (0, chunk - L), mode="reflect" if L > chunk // 2 else "constant")
            if device == "cuda":                                    # half precision on the graphics card: about twice as fast, half the memory
                with torch.autocast("cuda", dtype=torch.float16):
                    y = model(part[None].to(device))[0].float().cpu()
            else:
                y = model(part[None])[0]
            w = window.clone()
            if i == 0:
                w[:fade] = 1
            elif i + step >= n:
                w[-fade:] = 1
            result[..., i:i + L] += y[..., :L] * w[:L]
            counter[i:i + L] += w[:L]
            i += step
            progress(min(1.0, i / n))
    result = result / counter.clamp(min=1e-10)
    if length > 2 * border:
        result = result[..., border:-border]
    return result, names


def main(inp, outdir, model_name="htdemucs_6s"):
    os.makedirs(outdir, exist_ok=True)
    wav, sr = sf.read(inp, dtype="float32", always_2d=True)
    wav = wav.T                                                       # (channels, samples)
    if wav.shape[0] == 1:
        wav = np.repeat(wav, 2, axis=0)
    wav = wav[:2]
    if model_name == "bsroformer_sw":
        rate = 44100
        x = torch.from_numpy(np.ascontiguousarray(wav))
        if sr != rate:
            import julius
            x = julius.resample_frac(x, sr, rate)
        device = pick_device()
        print("DEVICE", device, flush=True)
        out, sources = separate_roformer(x, lambda p: print("PROGRESS %.3f" % p, flush=True), device)
        total = x.shape[1]
        return finish(out, sources, rate, total, outdir, model_name)
    from demucs.apply import apply_model
    from demucs.pretrained import get_model
    device = pick_device()
    print("DEVICE", device, flush=True)
    model = get_model(model_name)
    model.eval()
    rate = model.samplerate
    x = torch.from_numpy(np.ascontiguousarray(wav))
    if sr != rate:
        import julius
        x = julius.resample_frac(x, sr, rate)
    ref = x.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    x = (x - mean) / std
    total = x.shape[1]
    seg = float(getattr(model, "segment", None) or model.models[0].segment) * rate         # one chunk the model works on, in samples

    def progress(info):
        if info.get("state") == "end":
            print("PROGRESS %.3f" % min(1.0, (info["segment_offset"] + seg) / total), flush=True)

    with torch.no_grad():
        out = apply_model(model, x[None], device=device, shifts=0, split=True, overlap=0.25, progress=False, num_workers=0, callback=progress)[0]
    out = out * std + mean
    finish(out, model.sources, rate, total, outdir, model_name)


def finish(out, sources, rate, total, outdir, model_name):
    stems = []
    arrays = [s.numpy() for s in out]
    total_energy = sum(float(np.mean(a.mean(axis=0) ** 2)) for a in arrays)
    for name, a in zip(sources, arrays):
        sf.write(os.path.join(outdir, name + ".wav"), a.T, rate, subtype="PCM_16")
        stems.append(dict(name=name, **stem_stats(a, rate, total_energy)))
    with open(os.path.join(outdir, "stems.json"), "w") as f:
        json.dump({"model": model_name, "rate": rate, "seconds": round(total / rate, 2), "stems": stems, **analyse(list(sources), arrays, rate)}, f)
    print("DONE", flush=True)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "htdemucs_6s")
