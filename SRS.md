# Software Requirements Specification: Waterfall Notes

| | |
|---|---|
| Version | 1.0 (draft) |
| Date | 2026-11-07 |
| Author | Tevin-ph |
| Repository | https://github.com/Tevin-ph/Waterfall_notes |
| Format | Follows the layout of IEEE 29148 / IEEE 830 |

Status words used in the tables: **Verified** = built and measured or tested, with the result noted; **Built** = built and tried by hand, not measured; **Partial** = built with a known gap (stated); **Planned** = not built yet.

---

## 1. Introduction

### 1.1 Purpose
This document states what Waterfall Notes must do (functional requirements) and how well it must do it (non-functional requirements). It is meant for the developer, a course or capstone reviewer, and anyone deciding whether the app fits a need.

### 1.2 Scope
Waterfall Notes is a local piano trainer. It turns a song into 3D falling notes over an 88-key piano and lets the user practise it at their own speed. A song can come from a MIDI file, an audio or video file, a video of falling notes, a photo, PDF or video of sheet music, or playing on a MIDI keyboard. The app also splits a song into instruments, shows a song as sheet music, edits notes, and exports video, audio, MIDI and vertical social-media reels.

It is a web page (vanilla JavaScript) served by a small Python program on the user's own computer (the *helper*). Nothing is uploaded to a cloud service by the app. Out of scope: user accounts, a hosted service, mobile apps, real-time multi-user play, teaching content, and any instrument other than piano for the falling-notes view.

### 1.3 Definitions

| Term | Meaning |
|---|---|
| Falling notes | Notes drawn as bars that fall onto a keyboard and reach a key when it should be pressed |
| Helper | `scan_server.py`, the local Python program at `http://localhost:8765` that serves the page and runs the heavy tools |
| Stem | One instrument's track after splitting (vocals, drums, bass, guitar, piano, other) |
| Transkun, ByteDance model | Piano-transcription models (audio to notes) run by the helper |
| Basic Pitch | Spotify's in-browser audio-to-notes model, the fallback |
| homr, Audiveris | Optical music recognition programs (sheet-music picture to MusicXML) |
| Demucs, BS-RoFormer | Source-separation models used to split a song into stems |
| OMR | Optical music recognition |
| MIDI | Standard note-event file and keyboard protocol |
| Reel | Vertical 9:16 video made for Instagram, TikTok or Shorts |
| Pedal | The piano's sustain pedal; a note rings on while it is down |
| F1 | Score that balances notes found against false notes (1.0 = perfect) |

### 1.4 References
- `README.md`: feature descriptions and measured results.
- `repo-research.md`: the open-source projects and papers read when choosing methods.
- `falling-note-proto/eval/README.md`: how each number below was measured.

### 1.5 Overview
Section 2 describes the product and its users. Section 3 lists interfaces. Section 4 lists functional requirements by feature. Section 5 lists non-functional requirements. Section 6 gives limitations and open items.

---

## 2. Overall description

### 2.1 Product perspective
A two-part local system:

```
Browser (Chrome or Edge)                     Helper (Python, 127.0.0.1:8765)
  index.html + ES modules                      scan_server.py
  three.js scene, Web Audio, Web MIDI   <--->  piano_worker.py   (Transkun / ByteDance)
  IndexedDB library                            split_worker.py   (Demucs / BS-RoFormer)
  Basic Pitch (in the page)                    homr, Audiveris, pypdfium2 (sheet music)
                                               curl (public file links), Downloads folder
```

The page works alone for MIDI files, the built-in tunes, keyboard play, in-browser listening, and picture-reading of falling-note videos. The helper adds the accurate piano model, sheet-music scanning, instrument splitting and link downloads. Each heavy tool is optional and has its own setup script (`setup_piano.ps1`, `setup_scanner.ps1`, `setup_split.ps1`).

### 2.2 Product functions (summary)
1. Bring a song in (MIDI, audio, video, picture of falling notes, sheet music, link, keyboard).
2. Practise it with falling notes (speed, transpose, loop, metronome, hands, pedal, sound choice).
3. Edit notes in a piano roll.
4. Show the song as sheet music and export it as MusicXML or print.
5. Export video, audio, MIDI and vertical reels.
6. Split a song into instruments, mix them, and open the piano part as falling notes.
7. Keep a library of songs on the user's computer.

### 2.3 Users

| User | Needs |
|---|---|
| Learner | Learn a piece from a recording or score by watching and slowing it down |
| Keyboard player | Record a take, fix notes, export it |
| Content creator | Turn a performance into a video or reel |
| Musician / arranger | Separate instruments, get the key and tempo |

Users are assumed to be comfortable opening a web page and running one command to start the helper.

### 2.4 Operating environment
- Windows 11 (developed and tested here); the helper is Python 3 and should run on macOS or Linux, but that is **not tested**.
- Chrome or Edge (current). WebGL for the 3D scene, Web Audio, Web MIDI for keyboards, MediaRecorder for video export.
- Optional NVIDIA GPU with CUDA for fast instrument splitting (tested on an RTX 3050 laptop GPU, 4 GB).
- Disk: about 1-2 GB for the piano model, about 2.5 GB for GPU PyTorch plus about 700 MB for the best splitter.

### 2.5 Design and implementation constraints
- C-1. All app code is original; third-party code and data are bundled or installed with their licences kept (see NFR-LIC).
- C-2. The app and helper run on the user's computer; the helper listens on `127.0.0.1` only.
- C-3. No build step is needed to run the app (`python falling-note-proto/scan_server.py`).
- C-4. Audio-to-notes is a guess; exact notes require a MIDI file or a falling-notes video.
- C-5. Streaming sites (Instagram, YouTube and similar) are not downloaded, because their terms forbid it.

### 2.6 Assumptions and dependencies
- The user has the right to use the files they import and the backgrounds they supply.
- The optional tools (Transkun, ByteDance model, homr, Audiveris, Demucs, BS-RoFormer, pypdfium2, Pillow, numpy, librosa) are installed by the setup scripts and remain available upstream.
- The BS-RoFormer checkpoint is a mirror copy (its author's page was deleted); the app checks its SHA-256 before keeping it.

---

## 3. External interface requirements

### 3.1 User interface
- UI-1. A sidebar offers Library, Create, Practice, Reel (under Export), Scan sheet music, Sheet music and Split instruments; each is a page reached by a URL hash.
- UI-2. Practice shows a 3D falling-notes scene above an 88-key piano that zooms to the octaves the song uses, with a 2D fallback when WebGL is unavailable.
- UI-3. Icons are bundled (Lucide) and the font is bundled (Inter); no page loads fonts or scripts from the internet at run time.
- UI-4. Long jobs (listening, scanning, splitting, exporting) show progress and, where the helper does the work, a clear message when the helper or a tool is missing.

### 3.2 Hardware interfaces
- HW-1. A MIDI keyboard through Web MIDI (note on/off and sustain pedal CC 64).
- HW-2. Speakers or headphones through Web Audio.
- HW-3. Optional GPU (CUDA) for splitting.

### 3.3 Software interfaces

| Interface | Used for |
|---|---|
| three.js (bundled) | 3D scene |
| Basic Pitch (bundled, Apache-2.0) | In-browser audio to notes |
| OpenSheetMusicDisplay (bundled) | Drawing sheet music |
| signalsmith-stretch (bundled) | Live pitch shifting of a video's sound |
| Salamander Grand Piano samples (CC BY 3.0) | Piano sound |
| Transkun, ByteDance piano transcription | Accurate audio to notes (helper) |
| homr, Audiveris, pypdfium2 | Sheet-music scanning (helper) |
| Demucs `htdemucs_6s`, BS-RoFormer SW | Instrument splitting (helper) |
| librosa | Key and tempo (helper) |

### 3.4 Communication interface (page to helper)
The page talks to the helper over HTTP on `http://localhost:8765`.

| Route | Purpose |
|---|---|
| `GET /` and static files | Serve the app |
| `GET /piano/status`, `GET /scan/status` | Is the piano model or scanner installed |
| `POST /transcribe-piano` | Audio to notes with pedal |
| `POST /scan` | Image, PDF or MusicXML to notes |
| `GET /fetch?url=` | Download a public file link |
| `GET /latest-download`, `/latest-download/file` | Newest file in the Downloads folder (user confirms) |
| `GET /backgrounds-list`, `/backgrounds-*` | Clips for reels |
| `GET /split/ready`, `POST /split`, `GET /split/status`, `GET /split/stem` | Splitting jobs and results |

---

## 4. Functional requirements

Priority: **M** must, **S** should, **C** could.

### 4.1 Library (FR-LIB)

| ID | Requirement | Pri | Status |
|---|---|---|---|
| FR-LIB-1 | The system shall save every created song in browser storage (IndexedDB) on the user's computer. | M | Built |
| FR-LIB-2 | The system shall list saved songs and let the user open or delete one. | M | Built |
| FR-LIB-3 | The system shall save a song's notes, hands, tempo, pedal events, attached video and edits so that reopening gives the same song. | M | Built |

### 4.2 Bringing a song in (FR-IMP)

| ID | Requirement | Pri | Status |
|---|---|---|---|
| FR-IMP-1 | The system shall import a MIDI file, including tempo and sustain-pedal events (CC 64), with no helper needed. | M | Built |
| FR-IMP-2 | The system shall accept an audio or video file by choosing it or dropping it on the page, and choose the reader automatically: a video showing falling notes is read from the picture, one showing sheet music is scanned, anything else is listened to. | M | Built |
| FR-IMP-3 | The system shall turn audio into notes with the piano model when installed (Transkun first, ByteDance model otherwise) and with Basic Pitch in the browser when it is not or when it fails. | M | Verified: Transkun F1 99.2% clean, 98.4% phone-style (3 MAESTRO pieces) |
| FR-IMP-4 | The system shall read a Synthesia-style video by finding the keyboard, mapping keys from the black-key pattern, and recording when each key changes colour, assigning hands from the two key colours, and falling back to listening if the video is not that kind. | S | Built; accuracy not measured |
| FR-IMP-5 | The system shall download a file from a pasted direct link through the helper, only from public addresses. | S | Built |
| FR-IMP-6 | The system shall refuse to download from Instagram, YouTube and similar sites, open the video in a new tab instead, and offer **Capture audio** that listens to that tab's sound. | S | Built |
| FR-IMP-7 | The system shall let the user listen to a YouTube video through YouTube's own player (first 10 minutes), with progress and stop at the end of the video. | C | Built |
| FR-IMP-8 | The system shall offer **Latest download**: ask the helper for the newest video, audio, MIDI, PDF or photo in the Downloads folder, show its name and use it only after the user confirms. Files over 400 MB shall be refused. | C | Built |
| FR-IMP-9 | The system shall record a new song from a MIDI keyboard, with layered takes. | S | Built |
| FR-IMP-10 | The system shall offer built-in tunes to start from. | C | Built |
| FR-IMP-11 | The system shall keep about 2 s before the first note when a recording starts with long silence, and remember the cut so a video still lines up. | S | Built |
| FR-IMP-12 | The system shall assign left and right hands to imported notes automatically (audio and single-track MIDI). | S | Verified: 94.4% right on pieces it was not tuned on |
| FR-IMP-13 | The system shall estimate tempo automatically for steady music and say so when the music is not steady. | S | Verified: 89.7% on made-up steady songs |

### 4.3 Practice (FR-PRA)

| ID | Requirement | Pri | Status |
|---|---|---|---|
| FR-PRA-1 | The system shall draw the song as falling notes over an 88-key piano in 3D, straight down by default or in a 3D tilt, with note letters and a separate colour per hand (colours pickable). | M | Built |
| FR-PRA-2 | The system shall play the song with a piano sound (Salamander samples; a simple synth plays until they load). | M | Built |
| FR-PRA-3 | The system shall change speed with a slider without changing pitch of the piano sound. | M | Built |
| FR-PRA-4 | The system shall transpose from -12 to +12 semitones; a video's own sound shall be pitch-shifted live and fall back to the piano sound if shifting cannot load. | M | Built |
| FR-PRA-5 | For a song that came with a video, the system shall offer a Sound switch: **Piano** (the notes played by the piano, never stretched) or **Original** (the video's sound, stretched when speed is not 1x), and remember the choice. | S | Built |
| FR-PRA-6 | The system shall provide a repeat section (Start, End, Loop). | M | Built |
| FR-PRA-7 | The system shall provide a count-in and a metronome with volume and beats per bar. | S | Built |
| FR-PRA-8 | The system shall provide a tempo control: BPM stepper, Tap, and Auto. | S | Built |
| FR-PRA-9 | The system shall let the user show only the right hand, only the left hand, or both. | M | Built |
| FR-PRA-10 | The system shall optionally draw animated hands, and ease the picture if the graphics card cannot keep up. | C | Built |
| FR-PRA-11 | The system shall show the sustain pedal, with a Pedal light on the stage, and a setting **Pedal in the sound**: Real (default), Auto (guess from bass changes, up to 2.5 s) and Off (keys only). | S | Verified: on the Debussy test piece Transkun's pedal agreed with the real one 96% and cut the ring-length error from 0.49 s to 0.03 s |
| FR-PRA-12 | The system shall play along with a connected MIDI keyboard. | S | Built |
| FR-PRA-13 | The system shall play the attached video beside the notes, in step with them. | S | Built |

### 4.4 Edit notes (FR-EDT)

| ID | Requirement | Pri | Status |
|---|---|---|---|
| FR-EDT-1 | The system shall provide a piano-roll editor: select, drag to move, drag the end to resize, double-click to add, Delete to remove. | M | Built |
| FR-EDT-2 | The system shall provide undo and redo (Ctrl+Z, Ctrl+Y). | M | Built |
| FR-EDT-3 | The system shall assign hands by hand or with **Auto hands**. | S | Verified (see FR-IMP-12) |
| FR-EDT-4 | The system shall shift selected notes by semitone or octave (including -8va / +8va for a wrongly guessed octave), snap to the beat, and change tempo. | S | Built |
| FR-EDT-5 | The system shall shorten pedal-stretched bars and remove very short notes on request, warning that fast music has real short notes. | C | Built |
| FR-EDT-6 | The system shall save edits to the library and show the song's video in the corner for checking. | S | Built |

### 4.5 Sheet music scanning (FR-SCN)

| ID | Requirement | Pri | Status |
|---|---|---|---|
| FR-SCN-1 | The system shall turn a photo, screenshot, PDF or MusicXML file of sheet music into notes. MusicXML shall work with no scanner installed. | M | Built |
| FR-SCN-2 | The system shall read images with homr first, then Audiveris if homr is missing or reads nothing. | M | Verified |
| FR-SCN-3 | The system shall prepare an image before scanning: even out shadows, straighten a tilted page, and enlarge small images until staff spacing is about 22 px, never above 19 million pixels. | S | Verified: an 850x1100 screenshot that failed unprepared gave all 35 bars once enlarged |
| FR-SCN-4 | The system shall draw each page of a PDF (300 dpi, up to 30 pages, within the pixel limit), read it like a print and join the pages into one score; without pypdfium2 it shall hand the PDF to Audiveris and say so when a page is too big. | S | Verified: 80% of notes found on 8 clean PDFs; a 2-page PDF joined correctly (99.2%) |
| FR-SCN-5 | The system shall find staves in a video of sheet music, split it into pages where the picture changes, scan the sharpest frame of each and join them in order. | C | Partial: 24 of 24 notes on a generated 3-page video; real video frames, scrolling scores and moving cursors untested |
| FR-SCN-6 | The system shall report when no scanner is installed or nothing was read, instead of failing silently. | M | Built |

### 4.6 Sheet music output (FR-SHT)

| ID | Requirement | Pri | Status |
|---|---|---|---|
| FR-SHT-1 | The system shall draw any song as a two-staff score, 16 bars a page. | S | Built |
| FR-SHT-2 | The system shall export the score as MusicXML and print it. | S | Verified: 21 real scores written out and read back gave the same pitch, hand and sixteenth for 97.4% of notes |

### 4.7 Export (FR-EXP)

| ID | Requirement | Pri | Status |
|---|---|---|---|
| FR-EXP-1 | The system shall export a video (.mp4 where the browser can, otherwise .webm) of the falling notes with the piano sound, recorded in real time. | S | Built |
| FR-EXP-2 | The system shall export an audio file (.wav), rendered faster than real time. | S | Built |
| FR-EXP-3 | The system shall export a MIDI file (.mid). | S | Built |
| FR-EXP-4 | The system shall make a vertical Reel at 1080 x 1920 or 720 x 1280 (default 720), with a title, a line under it, a start point and a length from 15 s to the whole song. | S | Built |
| FR-EXP-5 | The system shall offer drawn themes (Pirate seas, Deep space, Synthwave, Cherry blossom, Fire and embers, Plain dark) that move with the music, using no pictures or sounds from elsewhere. | C | Built |
| FR-EXP-6 | The system shall accept a video or picture background (from the `backgrounds` folder or any file), loop it, and allow darkening and effects over it. | C | Built |
| FR-EXP-7 | The system shall suggest a theme from the title, clip name and music, and, for a clip, effects, darkening and two note colours at a contrast of about 5 against it; the user's own choices shall never be overridden. | C | Built; suggestion quality not measured |
| FR-EXP-8 | The system shall keep the piano keys clear of social-media captions and buttons (Lift the keyboard, on by default) and warn when a saved video drew under 26 frames a second. | C | Built |

### 4.8 Split instruments (FR-SPL)

| ID | Requirement | Pri | Status |
|---|---|---|---|
| FR-SPL-1 | The system shall split a chosen song into vocals, drums, bass, guitar, piano and other, with a choice of model: Demucs (fast) or BS-RoFormer SW (best). | M | Verified (see NFR-ACC-5) |
| FR-SPL-2 | The system shall show progress and the device used (graphics card or processor) while splitting. | S | Built |
| FR-SPL-3 | The system shall identify which instruments are present in the song and tag the others "probably not in this song" (a stem counts as present when it is audible in at least 4% of seconds and carries at least 3% of the sound). | M | Partial: checked on one made-up mix and one solo piano recording only |
| FR-SPL-4 | The system shall provide a mixer with volume, mute, solo and download for each stem, a waveform to click and jump, and play, seek and time. | M | Built |
| FR-SPL-5 | The system shall provide presets: Karaoke (no vocals), Vocals only, No drums, and all on. | S | Built |
| FR-SPL-6 | The system shall download the current mix as one file. | S | Built |
| FR-SPL-7 | The system shall show the song's key (with the runner-up) and tempo. | S | Verified: key right on 8 of 9 test sounds, tempo exact on 3 of 6 (rest half or double) |
| FR-SPL-8 | The system shall offer **See the piano as falling notes**: read the piano stem with the piano model and open it in Practice, with the isolated piano as the song's sound; the button shall be hidden when there is no piano stem. | S | Built: 30 s test gave 460 notes |
| FR-SPL-9 | The system shall refuse to split when the helper is not set up and say what to run. | M | Built |

### 4.9 Not built yet (FR-PLN)

Tools shown in the reference screenshots of the stem-splitter product that inspired the Split page. None is committed work; they are listed so the scope is clear.

| ID | Requirement | Pri | Status |
|---|---|---|---|
| FR-PLN-1 | **Remover**: remove one chosen instrument or the vocals from a song and download the rest (partly covered by the mixer presets). | C | Planned |
| FR-PLN-2 | **Pitcher**: change a song's pitch and speed independently and download the result. | C | Planned |
| FR-PLN-3 | **Key and BPM finder** as its own page (the Split page already shows both). | C | Planned |
| FR-PLN-4 | **Cutter**, **Joiner** and **Recorder** audio tools. | C | Planned |
| FR-PLN-5 | A splitter that runs entirely in the browser (ONNX / WebGPU) with no helper. | C | Planned |
| FR-PLN-6 | A better tempo model (Beat This!) for the Split page, pending a safe download source. | C | Planned |

---

## 5. Non-functional requirements

### 5.1 Accuracy (NFR-ACC)

| ID | Requirement | Measured result | Status |
|---|---|---|---|
| NFR-ACC-1 | Audio to notes with the piano model shall find at least 95% of notes (F1, onset within 50 ms) on clean piano and on phone-style audio. | Transkun 99.2% clean, 98.4% phone-style; ByteDance 98.3% / 91.1% (3 MAESTRO pieces) | Met |
| NFR-ACC-2 | Note lengths shall follow real key holds. | Transkun: 94.8% / 93.6% within 150 ms of the real release | Met |
| NFR-ACC-3 | Hand assignment shall beat the "below middle C is left" rule. | 94.4% against 83.7% | Met |
| NFR-ACC-4 | Sheet-music scanning shall read at least 99% of notes of a clean, simple page, and the system shall tell the user to expect fixes otherwise. | 9 of 24 test pages at 99% or more; median page 92%; screenshot 79%, print 84%, photo 83%; dense classical pages 46-70% | Partial: the original 99% goal is met only on clean, simple pages |
| NFR-ACC-5 | Splitting shall recover the piano more cleanly with the best model than with the fast one. | Piano recovered 7.3 dB (BS-RoFormer) against 3.0 dB (Demucs) on a 30 s test mix; on solo piano, 100% against 80% of the sound in the piano stem | Met |
| NFR-ACC-6 | Key shall be right for at least three songs in four. | 8 of 9 test sounds; real band songs untested | Not measured on real songs |
| NFR-ACC-7 | The system shall state the limits of every guess (audio is a guess; tempo may be half or double; key may be the relative major or minor). | Stated in README and on the pages | Met |

### 5.2 Performance (NFR-PERF)

| ID | Requirement | Measured result | Status |
|---|---|---|---|
| NFR-PERF-1 | The Practice scene shall draw smoothly and ease the picture when the graphics card cannot keep up. | Eases automatically | Built |
| NFR-PERF-2 | Recording a Reel at 720 x 1280 shall draw at least 26 frames a second on a typical laptop. | 31 fps at 720 x 1280, 21 fps at 1080 x 1920 on one laptop | Met at 720 only |
| NFR-PERF-3 | Splitting a 4-minute song on a laptop GPU shall take under 3 minutes. | RTX 3050 (4 GB): Demucs about 1 minute, BS-RoFormer about 2.5 minutes | Met |
| NFR-PERF-4 | The system shall remain usable without a GPU. | Demucs about 0.6x the song's length on a processor; BS-RoFormer about 10x (not practical) | Partial |
| NFR-PERF-5 | Audio to notes with the piano model shall run about as fast as the library's own method or faster, with identical notes. | 1.3-1.7x faster by running 4 windows at once | Met |
| NFR-PERF-6 | Transcribing a piano stem shall take about the song's length. | 30 s test took about 28 s | Met |
| NFR-PERF-7 | Audio export shall render faster than real time. | Rendered quickly | Built |

### 5.3 Reliability and robustness (NFR-REL)

| ID | Requirement |
|---|---|
| NFR-REL-1 | When the helper or an optional tool is missing, the page shall still work for everything that does not need it and shall name what is missing. |
| NFR-REL-2 | When the piano model fails, the system shall fall back to the in-browser detector. |
| NFR-REL-3 | A scan that reads nothing from Audiveris-sized limits (page over about 20 MP, staff lines under about 12 px) shall be prevented or explained, not left to fail. |
| NFR-REL-4 | A failed or cancelled job shall not corrupt the library; edits and songs are saved only on user action or on completion. |
| NFR-REL-5 | The helper shall delete old split jobs so disk use does not grow without limit. |
| NFR-REL-6 | A downloaded model file shall be kept only if its SHA-256 matches. |

### 5.4 Usability (NFR-USE)

| ID | Requirement |
|---|---|
| NFR-USE-1 | There shall be no menus to choose how a file is read; the system chooses automatically and the user may fix the result in Edit notes. |
| NFR-USE-2 | One command shall start the app, and one command per optional tool shall install it. |
| NFR-USE-3 | Long operations shall show progress, and messages shall say what to do next in plain words. |
| NFR-USE-4 | The page shall work at a laptop screen size; the Split page and Reel dialog shall rearrange at narrow widths. |
| NFR-USE-5 | The user's last Sound, pedal and similar choices shall be remembered between visits. |
| NFR-USE-6 | Keyboard shortcuts shall exist for editing (Delete, Ctrl+Z, Ctrl+Y). |

### 5.5 Security and privacy (NFR-SEC)

| ID | Requirement |
|---|---|
| NFR-SEC-1 | The helper shall listen on `127.0.0.1` only. |
| NFR-SEC-2 | Routes that read the user's files or run jobs (Latest download, Backgrounds, Split) shall answer only this app's own page, by checking Host, Origin and a custom header (`X-WN`). |
| NFR-SEC-3 | The helper shall refuse to fetch links to localhost or LAN addresses, so it cannot be used to reach internal services. |
| NFR-SEC-4 | Uploads to the helper shall be limited in size (40 MB for a scan, 60 MB of audio for the piano model, 400 MB for a split song as WAV and for Latest download) and PDFs in pages (30). |
| NFR-SEC-5 | Latest download shall use a file only after the user sees its name and confirms. |
| NFR-SEC-6 | User songs, audio and videos shall stay on the user's computer; the app shall send nothing to a third party, except that YouTube's own player loads from YouTube when the user chooses to listen to a YouTube video. |
| NFR-SEC-7 | Libraries and scripts shall be bundled, with no run-time loading of scripts from the internet. |

### 5.6 Portability and compatibility (NFR-POR)

| ID | Requirement | Status |
|---|---|---|
| NFR-POR-1 | The page shall work in current Chrome and Edge on Windows 11. | Tested |
| NFR-POR-2 | The 3D scene shall fall back to 2D when WebGL is unavailable. | Built |
| NFR-POR-3 | Video export shall use .mp4 where the browser can write it and .webm otherwise. | Built |
| NFR-POR-4 | The helper shall run on macOS and Linux. | Not tested |
| NFR-POR-5 | A reel's .mp4 shall upload to Instagram. | Not tested (Chrome writes fragmented mp4; re-saving in a video editor may be needed) |

### 5.7 Maintainability (NFR-MNT)

| ID | Requirement |
|---|---|
| NFR-MNT-1 | Features shall be separate ES modules loaded when first needed (`splitter.js`, `picture.js`, `score.js`, `editor.js`, `reel.js`, `musicxml.js`, `hands.js`, `tempo.js`, `scene3d.js`). |
| NFR-MNT-2 | Each accuracy claim shall have a script that reproduces it in `falling-note-proto/eval/`. |
| NFR-MNT-3 | The README shall state each feature with its measured result and its untested parts. |
| NFR-MNT-4 | Third-party libraries shall be rebuilt from `build-bp/`, not edited by hand. |
| NFR-MNT-5 | Generated test material (`_test/`) shall be kept out of git. |

### 5.8 Licensing and legal (NFR-LIC)

| ID | Requirement |
|---|---|
| NFR-LIC-1 | The Salamander piano samples (CC BY 3.0) shall be credited whenever the app is shared. |
| NFR-LIC-2 | homr (AGPL-3.0) shall be run as a separate program, and its licence shall be read before the app is published or hosted. |
| NFR-LIC-3 | The Demucs weights are probably non-commercial and the BS-RoFormer checkpoint declares no licence, so splitting is for use on the user's own computer; this shall be checked before any public or paid release. |
| NFR-LIC-4 | The app shall not download from sites whose terms forbid it. |
| NFR-LIC-5 | Reel themes shall use only drawn shapes; backgrounds shall be files the user has the right to use. |

---

## 6. Limitations and open items

### 6.1 Known limitations
- Audio-to-notes is a guess; fast, quiet notes under 0.1 s (about 2.4% on phone-style audio) are not recovered.
- Only three classical pieces were used for audio accuracy; casual and pop playing may behave differently.
- Dense scores scan poorly (46-70% of notes); sheet-music videos with real frames, scrolling scores or moving cursors are untested.
- The presence rule for instruments was checked on two samples; stem quality on real band songs is untested.
- The piano stem's quality limits the quality of its falling notes.
- Tempo can come out half or double; key can come out as the relative major or minor.
- The falling-notes picture reader has no accuracy figure.
- The scan benchmark pages are drawn by an engraver, not scanned from paper (except two real prints checked by eye).

### 6.2 Open decisions
1. Whether to load the Beat This! tempo model from a third-party mirror (the official host's certificate has expired).
2. Which of the planned tools (4.9) to build next.
3. Whether to measure the falling-notes picture reader and the sheet-music video scanner.

### 6.3 Traceability
Each feature in the README maps to a requirement group: Library to FR-LIB; Create and Ways to bring in a song to FR-IMP; Practice to FR-PRA; Edit notes to FR-EDT; Scan sheet music to FR-SCN; Sheet music to FR-SHT; Export and Reel to FR-EXP; Split instruments to FR-SPL. Each measured figure is reproduced by a script named in `falling-note-proto/eval/README.md`.
