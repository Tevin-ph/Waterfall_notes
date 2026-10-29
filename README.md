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
- **Practice**: 3D falling notes over an 88-key piano with note letters and separate colors per hand. Transpose (-12 to +12), speed, A-B loop, count-in, metronome, right/left hand only. Connect a MIDI keyboard, record layered takes, Save, and export `.mid`.
- **Scan sheet music**: photo, PDF or MusicXML to notes.

## Ways to bring in a song

- MIDI file
- **Falling-notes videos (exact):** for a video that shows a piano keyboard with falling notes (Synthesia style), the app reads the notes off the picture by watching which keys light up (`picture.js`). It finds the keyboard, works out which key is which from the black-key pattern, and records when each key changes colour. Hands come from the two key colours. Falls back to listening if the video isn't that kind. If the octave is guessed wrong, use Edit notes: select all, then -8va / +8va.
- **Sheet music in a video** (`score.js`): if a video shows sheet music instead of a keyboard, the app looks for staves in the picture, splits the video into pages where the picture changes, takes the sharpest frame of each page, enlarges it so the staff spacing is about 22 px, scans it with Audiveris and joins the pages in order. The result is the music as written with steady timing, not the video's own timing, and it isn't synced to the video. Tested only on a generated 3-page video (24 of 24 notes right); real video frames, scrolling scores and moving cursors are untested. Needs the scanner (Audiveris).
- **Edit notes** (`editor.js`): a piano roll for fixing any song. Click to select, drag to move, drag the right end to resize, double-click to add, Delete to remove, Ctrl+Z / Ctrl+Y, assign hands, shift by semitone or octave, remove blips. The video plays in the corner so you can check against it. Edits save to your library.
- Audio or video file, two detectors:
  - **Piano model (most accurate, optional):** ByteDance's [piano transcription](https://github.com/qiuqiangkong/piano_transcription_inference) model, run by the local helper. One-time setup, about 1-2 GB: `powershell -ExecutionPolicy Bypass -File falling-note-proto\setup_piano.ps1`. It is the default once installed. Speed (laptop CPU, timings drift with load): it runs 4 of the model's 10-second windows at once, which gives exactly the same notes as the library's one-at-a-time method but about 1.3-1.7x faster. "Piano model speed: Faster" also uses an 8 s step instead of 5 s (roughly 2x faster than the library's method, but about 1% of notes differ on real piano and about 5% on a very dense test clip).
  - **Not added: listening at 1.5x/2x.** Measured on 40 s of real piano (original-speed notes as the reference): 1.5x listening agreed 76% (F1) and 2x about 74-76%, with a third of notes missing at 2x. Too lossy for fast music.
  - **In the browser:** Spotify's [Basic Pitch](https://github.com/spotify/basic-pitch) (Apache-2.0, bundled in `falling-note-proto/vendor`). Used when the piano model isn't installed or fails; less accurate on piano.
  - Audio is a guess. For exact notes use the song's MIDI file.
- Sheet music photo or PDF: needs [Audiveris](https://github.com/Audiveris/audiveris) installed separately. MusicXML files work without it.
- Direct file link: the helper downloads it with `curl`, only from public addresses (localhost and LAN addresses are refused).
- Instagram, YouTube and similar links are not downloaded (their terms don't allow it). Pasting one opens the video in a new tab; then **Capture audio** listens to that tab's sound while you play it and turns it into notes.
- Links and captured audio need the "I own the rights to this media or have permission to use it" box ticked. It is a self-declaration, not a check.
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
- `build-bp/` how `vendor/basicpitch.js` was bundled (`npm install && npx esbuild entry.js --bundle --format=esm --minify --outfile=../falling-note-proto/vendor/basicpitch.js`)
- `falling-note-spec.md` feature and architecture notes
