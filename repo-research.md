# Repo research: how others turn piano audio/video into notes

34 repos read (README and front page only; papers and code were not read, and nothing was installed or run from them).
Verdicts are for this app: a local web page plus a small Python helper, on casual phone or Instagram piano videos shot from any angle.
Facts come from each README; "unsure" means the page did not say.

## Piano transcription models (audio to notes)
| Repo | What | Licence | CPU? | Verdict |
|---|---|---|---|---|
| bytedance/piano_transcription | Regression model with pedal, MAESTRO test frame AP 0.9285 (archived Dec 2025) | Apache-2.0 | yes (inference) | **In use** (via #2) |
| qiuqiangkong/piano_transcription_inference | pip package running the ByteDance weights | not stated | yes | **In use**; confirm licence before shipping to others |
| Yujia-Yan/Transkun | Neural semi-CRF piano transcriber; trained weights ship inside the pip package; note lengths are real key holds, not pedal-extended | code MIT (the weights' licence is not stated) | yes, about 0.7x real time | **Adopted as the preferred engine** (see the measured results below); the ByteDance model stays as the fallback |
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
| CPJKU/beat_this | Beat and downbeat tracker, small model about 8 MB, CPU works | MIT | Not tried: no recording here has a known true tempo, so it could only be compared with other guesses, not scored. The note-based Auto tempo already refuses unsteady music |
| CPJKU/madmom | DBN beat tracking | code BSD, models CC BY-NC-SA | Learn from |
| mir-aidj/all-in-one | Tempo/beats/structure, heavy Windows install | MIT | Skip |
| librosa/librosa | Audio analysis; used by the helper | ISC | In use |
| facebookresearch/demucs | Source separation (a 6-source model has a piano stem, "a lot of bleeding"); repo archived | MIT | Not tried: there is no recording with a real backing track and a known answer to test it on, and a synthetic backing would not be honest evidence. Revisit if videos with music behind the piano turn out to be common |
| deezer/spleeter | Separation, lower reported quality than Demucs | MIT | Skip |
| mir_eval | Standard scoring code | MIT | Dev only; our scripts compute the same numbers directly |
| MTG/essentia | C++ audio analysis | AGPL-3.0 | Skip: licence |

## Browser audio and MIDI
| Repo | What | Licence | Verdict |
|---|---|---|---|
| Signalsmith-Audio/signalsmith-stretch | Pitch and time shifting, WASM/AudioWorklet build, multi-octave pitch shift | MIT | **Adopted** (`vendor/signalsmith-stretch.mjs`, loaded on demand): transposing now shifts a video's own sound |
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

## Transkun and signalsmith-stretch: tested after approval
**Transkun** (installed from PyPI into the helper's environment; run through the helper on 16 kHz mono clips, the way the app sends audio; 3 held-out MAESTRO pieces, 4290+ real notes; scripts: `eval/eval_engines.py`):

| Engine | Audio | F1 | False notes | Missed | Key hold within 150 ms of real | Mean bar |
|---|---|---|---|---|---|---|
| ByteDance + our key-hold guess | clean | 98.3% | 59 | 93 | 88.5% | 0.16 s |
| ByteDance + our key-hold guess | phone-style | 91.1% | 373 | 403 | 85.3% | 0.18 s |
| **Transkun** | clean | **99.2%** | 20 | 46 | **94.8%** | 0.14 s |
| **Transkun** | phone-style | **98.4%** | 31 | 105 | **93.6%** | 0.15 s |

It is better on every measure, and by a wide margin on noisy audio, with no key-hold guessing needed (its lengths are the key holds). It takes about 0.7x real time on this CPU (113 s of music in 76 s), like the other model. So the helper now prefers Transkun and falls back to the ByteDance model if Transkun is not installed or fails. The noise-reduction step is not used with Transkun (it was not tested with it and the results above were already good). Caveats: the pretrained weights' licence is not stated (fine for personal use, check before sharing the app), three classical pieces is a small sample, and the phone-style copies are simulated, not real Instagram audio.

**signalsmith-stretch** (v1.3.2, MIT): in the app, a 440 Hz "video sound" transposed by -3, +2 and +7 semitones came out at 369.1, 495.1 and 659.2 Hz (expected 370.0, 493.9, 659.3), and at 0 the shifter switches off. It delays the sound by 0.12 s, so the video runs 0.12 s ahead while shifted to keep the sound on the notes. Only pitch was measured, not how it sounds on real music.

## Still not tried
* Demucs and beat_this (see the table for why). Anything that watches the hands: only works for top-down camera views (V2N), so it can't be the base.
* Anything that watches the hands: only works for top-down camera views (V2N), so it can't be the base.

## Left and right hand model
The old rule ("below middle C is left") is right for 84.4% of notes in 21 piano scores whose staves give the true hands (ASAP dataset, MusicXML, 8.9 MB, non-commercial licence; scripts in `falling-note-proto/eval`). `hands.js` replaces it for audio and single-track MIDI imports: notes that start together are split between the hands at the cheapest point (a beam search over the whole piece) using what hands can do: at most about an octave of stretch and five keys (counting keys still held), limited speed of movement, rare crossing, and a weak pitch preference. Settings were tuned on half of the pieces and scored on the other half:

| | C4 rule | best single split pitch per song (uses the answers) | hand model |
|---|---|---|---|
| pieces not used for tuning (10) | 83.7% | 92.4% | **94.4%** |
| pieces used for tuning (11) | 85.2% | 90.0% | 90.4% |
| all 21 | 84.4% | 91.2% | **92.4%** |

With 20-40 ms timing jitter, 3-8% missed and false notes, or pedal-length bars it still scores 90-92%.

Second round (asked to be more accurate): a "local register" preference (a note's rank among the notes played within 3 s of it: lower ones lean left, higher ones right) added +0.4 overall and +0.5 on unseen pieces, so it is in. A "register memory" (running average of where each hand has been playing) raised the tuned half (90.1% to 91.4%) but lowered the unseen half (93.9% to 93.3%), and widening the local-register search did the same, so both were left out as overfitting. The mistakes that remain are scattered single notes (mostly left-hand notes in the middle register given to the right hand), not swapped passages; getting past about 92-94% probably needs more labelled scores than the 21 used here. Weak spots: Beethoven 7-3 (79%), Chopin op. 10/1 (87%, wide fast right-hand arpeggios), a few pieces where the hands share a register. The truth is the staff, not the actual hand, so crossings are counted against the model.

## Small, quiet notes
Transkun finds 97.6% of the notes in phone-style audio; of the 105 it misses (3 pieces), 71% last under 0.1 s and their median velocity is 32 against about 50-60 for all notes. Tried: (1) feeding it 44.1 kHz instead of 16 kHz: identical results; (2) adding the ByteDance model's extra notes that Transkun lacks: 419 extras, 19 real (5%), so about 20 false notes per real one even when restricted to short or loud ones; (3) lowering the decoder's "no note" score by 1.5: F1 98.4% to 52.7%, and by 0.25: 98.4% to 94.3% (false notes 31 to 231, missed 105 to 268). No setting helped, so nothing changed (`eval/tk_sensitivity.py`, `eval/extra_notes_from_other_model.py`).
