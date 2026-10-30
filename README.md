# Waterfall Notes

A falling-notes piano trainer, built from a behavior-level study of the public Falling Note web app (see `falling-note-spec.md`). All code here is original.

## Run

```
python falling-note-proto/scan_server.py
```

Then open http://localhost:8765 in Chrome or Edge.

## Pages

- **Library**: every song you make is saved on this computer (browser storage). Open or delete them.
- **Create**: paste a direct link to a file, press Record to play a new song in on a MIDI keyboard, choose or drop a file, or start from a built-in tune.
- **Practice**: 3D falling notes (straight down by default, or a 3D tilt) over an 88-key piano with note letters and separate colors per hand (pickable). Transpose (-12 to +12; a video's own sound is pitch-shifted live with signalsmith-stretch, and falls back to the piano sound if that can't load), speed slider, a Sound switch for a song that came with a video (Piano: the piano plays the notes, never stretched, at any speed; Original: the video's own sound, which is stretched when the speed isn't 1x; your choice is remembered), a repeat section (Start / End / Loop), count-in, metronome (volume, beats per bar), tempo (BPM stepper, Tap, and Auto for steady music), optional animated hands (drawn cheaply, and the page eases the picture if the graphics card can't keep up), pedal view (hide the pedal sustain by default), right/left hand only. Connect a MIDI keyboard, record layered takes, Save, and Export as a video (.mp4 where the browser can, else .webm; the falling notes with the piano, recorded in real time), an audio file (.wav, rendered quickly) or MIDI (.mid).
- **Scan sheet music**: photo, PDF or MusicXML to notes.
- **Sheet music** (the reverse): any song's notes drawn as a two-staff score, 16 bars a page, with Download MusicXML and Print (`musicxml.js` writes the notation, `vendor/osmd.js` draws it). It is an approximation: rhythm is rounded to sixteenths using the song's tempo and first beat (set Auto or Tap first), each hand is one voice, the key is guessed from the notes, and notes held under moving ones are shown short. Writing 21 real scores out and reading them back gave the same pitch, hand and sixteenth for 97.4% of the notes.

## Ways to bring in a song
There are no menus to choose how a file is read: a video that shows falling notes is read off the picture, one that shows sheet music is scanned, anything else is listened to (piano model if set up, otherwise the in-browser detector).

- MIDI file
- **Falling-notes videos (exact):** for a video that shows a piano keyboard with falling notes (Synthesia style), the app reads the notes off the picture by watching which keys light up (`picture.js`). It finds the keyboard, works out which key is which from the black-key pattern, and records when each key changes colour. Hands come from the two key colours. Falls back to listening if the video isn't that kind. If the octave is guessed wrong, use Edit notes: select all, then -8va / +8va.
- **Sheet music in a video** (`score.js`): if a video shows sheet music instead of a keyboard, the app looks for staves in the picture, splits the video into pages where the picture changes, takes the sharpest frame of each page, enlarges it so the staff spacing is about 22 px, scans it with Audiveris and joins the pages in order. The result is the music as written with steady timing, not the video's own timing, and it isn't synced to the video. Tested only on a generated 3-page video (24 of 24 notes right); real video frames, scrolling scores and moving cursors are untested. Needs the scanner (Audiveris).
- **Edit notes** (`editor.js`): a piano roll for fixing any song. Click to select, drag to move, drag the right end to resize, double-click to add, Delete to remove, Ctrl+Z / Ctrl+Y, assign hands by hand or with Auto hands (hands.js), shift by semitone or octave, snap to the beat, change the tempo, shorten pedal-stretched bars, remove blips (careful: fast music has real notes that short). The video plays in the corner so you can check against it. Edits save to your library.
- Audio or video file, two detectors:
  - **Piano model (most accurate, optional):** [Transkun](https://github.com/Yujia-Yan/Transkun) when it is installed (the setup script installs it), otherwise ByteDance's [piano transcription](https://github.com/qiuqiangkong/piano_transcription_inference) model, run by the local helper. Transkun's note lengths are the real key holds (the other model's include the pedal's ring), and it held up much better on phone-style audio; numbers are in "How well it works" below. The two paragraphs about speed and key-hold guessing further down describe the ByteDance fallback. One-time setup, about 1-2 GB: `powershell -ExecutionPolicy Bypass -File falling-note-proto\setup_piano.ps1`. It is the default once installed. Speed (laptop CPU, timings drift with load): it runs 4 of the model's 10-second windows at once, which gives exactly the same notes as the library's one-at-a-time method but about 1.3-1.7x faster. The helper can also use an 8 s step instead of 5 s (roughly 2x faster than the library's method, but about 1% of notes differ on real piano and about 5% on a very dense test clip); the page no longer offers that choice, since Transkun is the default engine.
  - **Not added: listening at 1.5x/2x.** Measured on 40 s of real piano (original-speed notes as the reference): 1.5x listening agreed 76% (F1) and 2x about 74-76%, with a third of notes missing at 2x. Too lossy for fast music.
  - **In the browser:** Spotify's [Basic Pitch](https://github.com/spotify/basic-pitch) (Apache-2.0, bundled in `falling-note-proto/vendor`). Used when the piano model isn't installed or fails; less accurate on piano.
  - Audio is a guess. For exact notes use the song's MIDI file.
- Sheet music photo or PDF: needs [Audiveris](https://github.com/Audiveris/audiveris) installed separately. MusicXML files work without it.
- Direct file link: the helper downloads it with `curl`, only from public addresses (localhost and LAN addresses are refused).
- Instagram, YouTube and similar links are not downloaded (their terms don't allow it). Pasting one opens the video in a new tab; then **Capture audio** listens to that tab's sound while you play it and turns it into notes.
- **YouTube links (listening, no download):** pasting a YouTube link shows the "use your file" card; "play it here instead" loads YouTube's official player in the page. Press Start, pick *This tab* with *Share tab audio* in Chrome's share window, and the app presses play through YouTube's player controls, listens with a real progress bar (time played of length), and stops when the player reports the video ended. First 10 minutes only. Ads that YouTube plays in the embed would be heard too.
- **Latest download:** the button on Create asks the helper for the newest video, audio, MIDI, PDF or photo in your Downloads folder, shows you its name, and only uses it after you confirm. The helper answers only this app's own page (checked Host, Origin and a header), and files over 400 MB are refused.
- Played in on a MIDI keyboard

## Look

The Practice scene is real 3D ([three.js](https://threejs.org) with a bloom glow pass) and zooms to the octaves the song uses. If WebGL is unavailable it falls back to a 2D drawing. Icons are [Lucide](https://lucide.dev) (ISC) and the font is Inter (OFL), both bundled locally.

## Layout

- `falling-note-proto/index.html` the app
- `falling-note-proto/scene3d.js` the 3D scene
- `falling-note-proto/vendor/` bundled libraries (Basic Pitch + model, three.js, icons, font). Rebuild with `build-bp/` (`entry.js`, `entry3d.js`, `make-icons.mjs`)
- `falling-note-proto/scan_server.py` local helper: serves the app, runs Audiveris, fetches file links
- `build-bp/` how `vendor/basicpitch.js` was bundled (`npm install && npx esbuild entry.js --bundle --format=esm --minify --outfile=../falling-note-proto/vendor/basicpitch.js`). The 3D scene's `vendor/three.js` is built the same way from `entry3d.js`, which lists the three.js pieces the scene may use: add a new one there (and rebuild) before using it in `scene3d.js`.
- `falling-note-spec.md` feature and architecture notes

## How well it works (measured)
Numbers come from three held-out MAESTRO piano performances with a known answer, in `falling-note-proto/eval`; the longer write-up and the 34 repos read are in `repo-research.md`.
- **Transkun (the preferred engine):** notes found (F1, onset within 50 ms) 99.2% in clean recordings and 98.4% in phone-style copies (echo, hiss, narrow band); its note lengths are the real key holds, 94.8% / 93.6% within 150 ms of the real release.
- **ByteDance model (fallback):** 98.3% clean, 91.1% phone-style (91.7% with the helper's noise reduction, applied only to noisy recordings). Its note lengths include the pedal's ring, so the helper guesses the key hold: 88.5% of notes within 150 ms (the raw length: 49%). Real holds over 0.8 s are the weak spot of the guess.
- **Left/right hands** (`hands.js`, used for audio and single-track MIDI imports, and by the editor's Auto hands button): 94.4% of notes given the right hand on scores it was not tuned on, against 83.7% for the old "below middle C is left" rule (92.4% against 84.4% over all 21 test scores). It still gets about 80-87% on a few pieces where the hands cross or share a register. Truth = which staff each note is on in the score, a proxy for who plays it; it was tested with timing jitter and 8% missed and false notes (90.7%). A model of what two hands can reach, not of any one player.
- Auto tempo works on steady playing only (89.7% on made-up steady songs) and says so otherwise.
- Only three classical pieces were used, so casual or pop playing may behave differently.
- **Silence at the start:** a recording that begins with a long silence (you press Start, then play the video later) keeps about 2 s before the first note; the cut is remembered so the video still lines up. The metronome's first beat is the first note.
- **Small, quiet notes** (under 0.1 s, the 2.4% of notes Transkun misses on phone-style audio) have no safe fix yet: higher sample rate made no difference, extra notes from the other model were 5% real, and lowering the decoder's "no note" score even slightly cost far more false notes than it found (F1 98.4% to 94.3% at the gentlest setting tried).

## Credits
- **Piano sound:** Salamander Grand Piano by Alexander Holm, licensed [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), as distributed in [Tonejs/audio](https://github.com/Tonejs/audio) (30 samples in `falling-note-proto/vendor/piano`). Credit to the author is required when the app is shared. A simple built-in synth plays until the samples have loaded.