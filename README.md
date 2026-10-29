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
- Audio or video file: turned into notes in the browser by Spotify's [Basic Pitch](https://github.com/spotify/basic-pitch) (Apache-2.0, bundled in `falling-note-proto/vendor`)
- Sheet music photo or PDF: needs [Audiveris](https://github.com/Audiveris/audiveris) installed separately. MusicXML files work without it.
- Direct file link: the helper downloads it with `curl`, only from public addresses (localhost and LAN addresses are refused).
- Instagram, YouTube and similar links are not downloaded (their terms don't allow it). Pasting one opens the video in a new tab; then **Capture audio** listens to that tab's sound while you play it and turns it into notes.
- Links and captured audio need the "I own the rights to this media or have permission to use it" box ticked. It is a self-declaration, not a check.
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
