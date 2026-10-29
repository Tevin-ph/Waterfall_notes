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


def transcribe_file(wav_path, out_path):
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
    est = _load_model().transcribe(audio, None)          # None: don't write a MIDI file
    notes = []
    for n in est["est_note_events"]:
        on, off = float(n["onset_time"]), float(n["offset_time"])
        notes.append({"m": int(n["midi_note"]), "t": on, "d": max(0.03, off - on), "v": min(1.0, max(0.2, float(n["velocity"]) / 127.0))})
    with open(out_path, "w") as f:
        json.dump({"notes": notes}, f)


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
            transcribe_file(req["wav"], req["out"])
            say({"ok": True})
        except Exception as e:
            say({"ok": False, "error": (type(e).__name__ + ": " + str(e))[:300]})


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--serve":
        serve()
    else:
        transcribe_file(sys.argv[1], sys.argv[2])
