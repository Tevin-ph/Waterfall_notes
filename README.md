# Waterfall Notes

A falling-notes piano practice app, built from a behavior-level study of the public Falling Note web app (see `falling-note-spec.md`). All code here is original.

## Run

```
python falling-note-proto/scan_server.py
```

Then open http://localhost:8765 (Chrome or Edge).

## Features

- Load a MIDI file, or use the built-in demo
- 3D falling notes over an 88-key piano, with note letters and separate colors per hand
- Practice tools: speed, A-B loop, count-in, metronome, right/left hand only
- Connect a MIDI keyboard (Web MIDI), play along and record layered takes, save as `.mid`
- Scan sheet music (photo, PDF or MusicXML) via [Audiveris](https://github.com/Audiveris/audiveris), which must be installed separately
- Audio/video file to notes, in the browser, using Spotify's [Basic Pitch](https://github.com/spotify/basic-pitch) (Apache-2.0, bundled in `falling-note-proto/vendor`)

## Layout

- `falling-note-proto/` the app (`index.html`) and the local scan helper (`scan_server.py`)
- `build-bp/` how `vendor/basicpitch.js` was bundled (`npm install && npx esbuild entry.js --bundle --format=esm --minify --outfile=../falling-note-proto/vendor/basicpitch.js`)
- `falling-note-spec.md` feature and architecture notes
