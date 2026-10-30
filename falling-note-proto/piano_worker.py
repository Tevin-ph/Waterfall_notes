"""Runs the piano transcription model (ByteDance "High-resolution piano transcription", F1 ~0.97 on MAESTRO).

Two ways to use it, with the piano environment's python:
  python piano_worker.py in.wav out.json     one file, then exit
  python piano_worker.py --serve             stay running: reads {"wav": ..., "out": ...} lines on stdin and answers one JSON line each
                                             (so PyTorch and the model load once, not for every request)
Output file: {"notes": [{"m": midi, "t": onset_s, "d": duration_s, "v": 0.2..1}, ...]}
Kept as a separate script so scan_server.py never imports PyTorch itself.
"""
import json
import os
import sys

CHECKPOINT = os.path.join(os.path.expanduser("~"), "piano_transcription_inference_data", "note_F1=0.9677_pedal_F1=0.9186.pth")
_model = None


def _load_model():
    global _model
    if _model is None:
        from piano_transcription_inference import PianoTranscription
        _model = PianoTranscription(device="cpu", checkpoint_path=CHECKPOINT)
    return _model


HOP_BEST, HOP_FAST = 5.0, 8.0                          # seconds between 10 s windows: the library's own 5, or a faster 8
BATCH = int(os.environ.get("PIANO_BATCH", "4"))        # windows run through the network at once
SR, FPS, SEG = 16000, 100, 160000


def _events_fast(tr, audio, hop_s=HOP_BEST):
    """The library's model and thresholds, with 4 windows per batch. hop_s=5 is the library's own overlap: the notes are IDENTICAL to its
    output (measured 100% on real piano) but 1.3-1.7x faster. hop_s=8 (each window contributes its middle 8 s instead of 5 s) is up to
    ~2x faster still but changes some notes at the window joins: measured 99.1% identical on real piano, 95% on a dense stress clip."""
    import numpy as np
    import piano_transcription_inference.inference as inf
    from piano_transcription_inference.utilities import RegressionPostProcessor
    n = len(audio); hop = int(hop_s * SR)
    need = SEG + int(np.ceil(max(0, n - SEG) / hop)) * hop
    a = np.concatenate([audio[None, :], np.zeros((1, need - n), dtype=np.float32)], axis=1)
    starts = list(range(0, need - SEG + 1, hop))
    segs = np.concatenate([a[:, s:s + SEG] for s in starts], axis=0)
    out = inf.forward(tr.model, segs, batch_size=BATCH)
    margin = int(((SEG - hop) / 2) / SR * FPS)             # frames dropped from each inner window edge
    res = {}
    for k, v in out.items():
        x = v[:, :-1, :]; F = x.shape[1]; parts = []
        for i in range(len(starts)):
            lo = 0 if i == 0 else margin
            hi = F if i == len(starts) - 1 else F - margin
            parts.append(x[i, lo:hi])
        res[k] = np.concatenate(parts, axis=0)[: int(n / SR * FPS) + 1]
    pp = RegressionPostProcessor(tr.frames_per_second, classes_num=tr.classes_num, onset_threshold=tr.onset_threshold,
                                 offset_threshold=tr.offset_threshod, frame_threshold=tr.frame_threshold,
                                 pedal_offset_threshold=tr.pedal_offset_threshold)
    events, pedal = pp.output_dict_to_midi_events(res)
    return events, pedal or []


NOISY_ABOVE = 0.0026          # measured: clean studio recordings 0.0014-0.0018, phone-style copies 0.0035-0.0037


def _noisiness(x, sr):
    """The steady noise floor (12th percentile of each frequency over time, 100-5000 Hz) as a share of the typical peak level."""
    import numpy as np
    from scipy.signal import stft
    f, t, Z = stft(x / (np.abs(x).max() + 1e-9), fs=sr, nperseg=2048, noverlap=1536)
    mag = np.abs(Z)[(f >= 100) & (f <= 5000)]
    return float(np.percentile(mag, 12, axis=1).mean() / (np.median(mag.max(axis=0)) + 1e-9))


def _denoise(x, sr, alpha=1.6, floor=0.12):
    """Turn down steady hiss and room tone: per-frequency noise floor from the quietest frames, then a soft gain smoothed over time so the
    start of a note isn't chopped. On phone-style test copies of 3 MAESTRO pieces this cut false notes 373 -> 322 (F1 91.1 -> 91.7)."""
    import numpy as np
    from scipy.ndimage import uniform_filter1d
    from scipy.signal import istft, stft
    f, t, Z = stft(x, fs=sr, nperseg=2048, noverlap=1536)
    mag = np.abs(Z); noise = np.percentile(mag, 12, axis=1, keepdims=True)
    gain = uniform_filter1d(np.clip(1 - alpha * noise / (mag + 1e-9), floor, 1.0), size=3, axis=1)
    _, y = istft(Z * gain, fs=sr, nperseg=2048, noverlap=1536)
    y = y[: len(x)].astype(np.float32)
    return np.ascontiguousarray(0.9 * y / (np.abs(y).max() + 1e-9), dtype=np.float32)


def held_length(on, d, onsets):
    """Guess how long the key was held, never more than d (how long the note sounds). With the pedal down a note rings on after the finger
    lets go, and audio can't show when that was. Tuned against real key releases (MAESTRO, 3 held-out pieces, 4290 notes): half the time to
    the next note in the same hand (ignoring notes struck with this one), at least 0.15 s and at most 0.6 s; 1 s at most when nothing follows
    within 3 s. 90% of notes land within 150 ms of the real release (the model's own length: 49%). Long real holds (over 0.8 s, 1% of
    notes) are the weak spot. A guess, not a measurement."""
    import bisect
    i = bisect.bisect_right(onsets, on + 0.04)
    gap = onsets[i] - on if i < len(onsets) else None
    if gap is not None and gap <= 3.0:
        return min(d, max(0.15, min(0.6, 0.5 * gap)))
    return min(d, 1.0)


def transcribe_file(wav_path, out_path, fast=False):
    import numpy as np
    import soundfile as sf
    from piano_transcription_inference import sample_rate

    # The app sends a WAV already; read it directly (the library's own loader needs ffmpeg, which most PCs don't have).
    audio, sr = sf.read(wav_path, dtype="float32", always_2d=True)
    audio = audio.mean(axis=1)
    if sr != sample_rate:
        import librosa
        audio = librosa.resample(audio, orig_sr=sr, target_sr=sample_rate)
    audio = np.ascontiguousarray(audio, dtype=np.float32)
    # Only recordings that measure as noisy are cleaned first; clean ones are left exactly as they are (not tested on clean audio).
    noisy = os.environ.get("PIANO_DENOISE", "1") != "0" and _noisiness(audio, sample_rate) > NOISY_ABOVE
    if noisy:
        audio = _denoise(audio, sample_rate)
    tr = _load_model()
    try:
        events, pedal_events = _events_fast(tr, audio, HOP_FAST if fast else HOP_BEST)
    except Exception as e:                                # if the faster path ever fails, use the library's own method
        print("fast path failed, using the library's method:", e, file=sys.stderr)
        out = tr.transcribe(audio, None)                  # None: don't write a MIDI file
        events, pedal_events = out["est_note_events"], out.get("est_pedal_events") or []
    pedals = [(float(p["onset_time"]), float(p["offset_time"])) for p in pedal_events]
    notes = []
    hands = {0: [], 1: []}                                # onsets per hand (the same C4 split the app uses), for held_length
    for n in events:
        hands[1 if int(n["midi_note"]) < 60 else 0].append(float(n["onset_time"]))
    for h in hands.values():
        h.sort()
    for n in events:
        on, off = float(n["onset_time"]), float(n["offset_time"])
        d = max(0.03, off - on)
        m = int(n["midi_note"])
        note = {"m": m, "t": on, "d": d, "v": min(1.0, max(0.2, float(n["velocity"]) / 127.0))}
        # The model gives a note the length it SOUNDS, and with the sustain pedal down that runs on after the finger lets go. For a note that
        # sounded while the model heard the pedal down, kd is the guessed "key held" time; the rest of d is pedal ring. (No pedal heard:
        # the note's own length is already the key hold, so it is left alone.) Checked against real MIDI: the same 90% with or without
        # this pedal condition on pedaled music, and it protects songs played without pedal.
        if d > 0.2 and any(a <= off and b >= on for a, b in pedals):
            kd = held_length(on, d, hands[1 if m < 60 else 0])
            if kd < d - 0.08:
                note["kd"] = round(kd, 3)
        notes.append(note)
    with open(out_path, "w") as f:
        json.dump({"notes": notes, "pedal": [{"t": a, "d": max(0.05, b - a)} for a, b in pedals], "denoised": bool(noisy)}, f)


def serve():
    proto = sys.stdout            # the protocol channel; the library's own prints go to stderr instead
    sys.stdout = sys.stderr
    def say(obj):
        proto.write(json.dumps(obj) + "\n"); proto.flush()
    try:
        _load_model()
        say({"ready": True})
    except Exception as e:
        say({"ready": False, "error": str(e)[:300]}); return
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            transcribe_file(req["wav"], req["out"], bool(req.get("fast")))
            say({"ok": True})
        except Exception as e:
            say({"ok": False, "error": (type(e).__name__ + ": " + str(e))[:300]})


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--serve":
        serve()
    else:
        transcribe_file(sys.argv[1], sys.argv[2])
