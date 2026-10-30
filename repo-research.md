# Repo research: how others turn piano audio/video into notes

34 repos read (README and front page only; papers and code were not read, and nothing was installed or run from them).
Verdicts are for this app: a local web page plus a small Python helper, on casual phone or Instagram piano videos shot from any angle.
Facts come from each README; "unsure" means the page did not say.

## Piano transcription models (audio to notes)
| Repo | What | Licence | CPU? | Verdict |
|---|---|---|---|---|
| bytedance/piano_transcription | Regression model with pedal, MAESTRO test frame AP 0.9285 (archived Dec 2025) | Apache-2.0 | yes (inference) | **In use** (via #2) |
| qiuqiangkong/piano_transcription_inference | pip package running the ByteDance weights | not stated | yes | **In use**; confirm licence before shipping to others |
| Yujia-Yan/Transkun | Neural semi-CRF piano transcriber; README: note onset F1 0.9833, onset+offset 0.8149 (column order unsure), pedal onset 0.8444 | MIT | CLI defaults to CPU | **Best candidate to try**: not installed here (needs a pip install and a checkpoint nobody could approve). Test on the degraded clips in `falling-note-proto/eval` first |
| EleutherAI/aria-amt | Seq-to-seq piano transcription, "preliminary" weights | Apache-2.0 | unsure, Python 3.11 | Skip for now |
| sony/hFT-Transformer | Frequency-time transformer, ISMIR 2023 | code MIT, checkpoints CC BY-NC-SA | unsure | Skip: non-commercial weights |
| spotify/basic-pitch | Light, any-instrument transcription | Apache-2.0 | yes | **In use** as the in-browser fallback |
| jongwook/onsets-and-frames | PyTorch Onsets and Frames, no pretrained weights | MIT | no (trains on GPU) | Learn from |
| magenta onsets_frames_transcription | TF original, "currently inactive" | unsure | unsure | Learn from |
| magenta/mt3 | Multi-instrument T5X model | Apache-2.0 | unsure | Skip: heavy, hard to run |

## Reading the piano from video, hand tracking
| Repo | What | Licence | Verdict |
|---|---|---|---|
| yonghyunk1m/V2N | Top-view video to key press/release (onset F1 94.7, +offset 89.5 at 50 ms on PianoVAM). Needs the keyboard corners marked per video; collapses on other camera setups | MIT code, CC BY 4.0 weights | Learn from. Not usable for sideways or angled links |
| maxschridde1494/Beethoven | Two detectors: find the keys, then find pressed keys; no accuracy stated | MIT | Learn from (two-stage idea) |
| itsJvmes/Virtual-Piano | MediaPipe fingertip speed triggers notes (virtual piano) | not stated | Learn from the relative-velocity idea; it detects air motion, not key contact |
| google-ai-edge/mediapipe | Hand tracking building block | Apache-2.0 | Possible building block only |
| emilamaj/SynToMid | Falling-notes video to MIDI, "very buggy" | not stated | Skip: we already read falling-notes videos (`picture.js`) |
| andrewmourcos/SharpMusic | Archived prototype, white keys only | not stated | Skip |
| CynapticsAI/AnywherePiano, RonitSachdev/AirChords | Webcam virtual piano / chord triggers | not stated / unverified | Skip: not transcription |

## Beat, tempo, separation, evaluation
| Repo | What | Licence | Verdict |
|---|---|---|---|
| CPJKU/beat_this | Beat and downbeat tracker, small model about 8 MB, CPU works | MIT | Good if we later want audio-based beats; not installed |
| CPJKU/madmom | DBN beat tracking | code BSD, models CC BY-NC-SA | Learn from |
| mir-aidj/all-in-one | Tempo/beats/structure, heavy Windows install | MIT | Skip |
| librosa/librosa | Audio analysis; used by the helper | ISC | In use |
| facebookresearch/demucs | Source separation (a 6-source model has a piano stem, "a lot of bleeding"); repo archived | MIT | Worth testing for videos with music or voice behind the piano; needs a large model download, not done |
| deezer/spleeter | Separation, lower reported quality than Demucs | MIT | Skip |
| mir_eval | Standard scoring code | MIT | Dev only; our scripts compute the same numbers directly |
| MTG/essentia | C++ audio analysis | AGPL-3.0 | Skip: licence |

## Browser audio and MIDI
| Repo | What | Licence | Verdict |
|---|---|---|---|
| Signalsmith-Audio/signalsmith-stretch | Pitch and time shifting, WASM/AudioWorklet build, multi-octave pitch shift | MIT | **Best route for real transposing of a video's own sound** (today it switches to the piano sound). Needs adding a library file; not done |
| urtzurd/html-audio | Small granular pitch shifter | MIT | Learn from; quality unverified |
| Tonejs/Tone.js | Web Audio framework (PitchShift docs not read) | MIT | Skip |
| Tonejs/Midi | MIDI read/write in the browser | MIT | Possible for MIDI export; our own writer works |
| ryohey/signal | Browser MIDI editor | MIT | Learn from |
| mido, pretty-midi, JZZ | MIDI libraries | MIT | Skip for the page; mido is used in the test scripts |
| Audiveris | Sheet-music recognition | AGPL-3.0 | **In use** as a separate program; not bundled |

## What I measured and decided
Test data: three MAESTRO performances (not in the model's training set) with real key-off times, plus phone-style copies of them (room echo, 12 dB hiss, 150-6000 Hz band, light compression). Scripts: `falling-note-proto/eval`.

* **Key-release guess** (`piano_worker.held_length`): half the gap to the next note in the same hand, 0.15-0.6 s. 88.5% of notes within 150 ms of the real release; the model's own length 49%. Kept.
* **Learned key-release model** (boosted trees, ridge; trained on two pieces, tested on the third): 87-88% within 150 ms, worse than the rule. **Not built.**
* **Pitch-aware release rule**: no better than ignoring pitch. **Dropped.**
* **False-note filter**: on phone-style audio 5.6-11% of the model's notes are false (0.1-2.4% on clean audio). No simple rule (short, quiet, isolated, overtone, echo) removes more false notes than real ones, and a learned filter removed 10% of the false notes at best while losing 1.4% of real ones. The old Clean up levels removed about 5 real notes for each false one, so **they were removed**. Rule of thumb from this: fixing false notes needs a better model or cleaner audio, not a filter.
* **Tempo detector** (`falling-note-proto/tempo.js`, the Auto button next to Tap): lays a beat grid over the note starts and scores each tempo against what random timing would score. On 300 made-up songs with known tempo it is right within 3% on 89.7% (the old fixed 100 BPM: 3.3%). **On real expressive piano it is not reliable**: three MAESTRO performances scored a "fit" of 0.02-0.05, below even random note timing (0.11-0.18) and far below steady playing (0.27-0.49), so the button refuses (fit under 0.2) and tells the user to Tap. A first version tuned only on made-up songs returned 190 BPM (the top of its range) on all three real pieces; the made-up test had hidden that. No true tempo exists for the real pieces, so only the made-up songs measure accuracy.
* **Noise reduction before transcription** (`piano_worker._denoise`, runs only when a recording measures as noisy): on the phone-style copies, F1 went 91.1% to 91.7% overall (false notes 373 to 322) and on the Schubert piece 92.4% to 93.7%. A small gain, not a fix. It is skipped for clean recordings (measured noisiness 0.0014-0.0018 clean, 0.0035-0.0037 phone-style, cut-off 0.0026) because it was not tested on clean audio. Real phone clips will sit somewhere in between; the cut-off is a guess there.

## Not tried, and what it would take
* Transkun, Demucs, beat_this, signalsmith-stretch: each is a pip/npm install plus a model or library download. Nobody was there to approve those, so they are untested. Transkun and Demucs are the two most likely to help on noisy phone audio; test them on the degraded clips with `eval/` before adopting.
* Anything that watches the hands: only works for top-down camera views (V2N), so it can't be the base.
