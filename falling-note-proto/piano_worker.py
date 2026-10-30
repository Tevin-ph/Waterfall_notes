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
    tr = _load_model()
    try:
        events, pedal_events = _events_fast(tr, audio, HOP_FAST if fast else HOP_BEST)
    except Exception as e:                                # if the faster path ever fails, use the library's own method
        print("fast path failed, using the library's method:", e, file=sys.stderr)
        out = tr.transcribe(audio, None)                  # None: don't write a MIDI file
        events, pedal_events = out["est_note_events"], out.get("est_pedal_events") or []
    pedals = [(float(p["onset_time"]), float(p["offset_time"])) for p in pedal_events]
    notes = []
    for n in events:
        on, off = float(n["onset_time"]), float(n["offset_time"])
        d = max(0.03, off - on)
        note = {"m": int(n["midi_note"]), "t": on, "d": d, "v": min(1.0, max(0.2, float(n["velocity"]) / 127.0))}
        # The model gives a note the length it SOUNDS, and with the sustain pedal down that runs on until the pedal comes up. When a long note
        # ends right as a pedal comes up, the key was probably released earlier: kd is a short "key held" guess, the rest of d is pedal ring.
        if d > 0.45 and any(a <= off + 0.05 and abs(b - off) <= 0.15 for a, b in pedals):
            note["kd"] = 0.3
        notes.append(note)
    with open(out_path, "w") as f:
        json.dump({"notes": notes, "pedal": [{"t": a, "d": max(0.05, b - a)} for a, b in pedals]}, f)


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
