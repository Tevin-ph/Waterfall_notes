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
- Direct file link: the helper downloads it with `curl`, only from public addresses (localhost and LAN addresses are refused). Links to YouTube, Instagram and similar sites are not supported.
- Played in on a MIDI keyboard

## Layout

- `falling-note-proto/index.html` the app
- `falling-note-proto/scan_server.py` local helper: serves the app, runs Audiveris, fetches file links
- `build-bp/` how `vendor/basicpitch.js` was bundled (`npm install && npx esbuild entry.js --bundle --format=esm --minify --outfile=../falling-note-proto/vendor/basicpitch.js`)
- `falling-note-spec.md` feature and architecture notes
