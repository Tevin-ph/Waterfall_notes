# Falling Note — feature & architecture notes

Source: public web app at https://fallingnoteapp.com/ (marketing page + "Open Studio"), observed via page text and REA static bundle analysis (evidence ids below). Behavior-level notes only: no code or assets copied. Whether the iPhone app shares this codebase is unconfirmed.

## What it is
Turns a song (audio/video file, link, recording, or scanned sheet music) into a synchronized practice view: falling 3D notes, lit piano keys, engraved sheet music, and the source video, all in time.

## Features (from the site)
- **Input:** files, pasted link, record, scan (PDF / photo of sheet music)
- **Views, live together:** Sheet (engraved as it plays), Notes (falling, 3D), Keys (lit), Video (in sync)
- **Looks:** Flat, Spectrum (note-name colours C-D-E-F-G-A-B), plus Pro "Sketch" and "Glow"
- **Practice:** metronome, count-in, loop, guide hands, speed control
- **Stems:** mute the piano part and play it yourself (free)
- **Export (Pro):** video, PDF sheet, MIDI, MusicXML, sheet-on-video
- **Other Pro:** chord detection, scan sheet music, more assistant chats
- **Assistant chat:** changes the look, sets practice speed, gives a tour
- **Account sync:** library on the web too (free)
- **Pricing model:** free = 1 hour of songs/month; Pro = 3,600 credits/month, 1 credit per second of music (sheet scans also cost credits)
- **Extra tools:** MIDI Art, Study, Align, Notes-on-Video, Sheet-on-Video, developer API keys

## Routes found in the bundle (static candidates, reachability unverified)
`/`, `/practice`, `/scan`, `/notes-on-video`, `/sheet-on-video`, `/midi-art`, `/study`, `/paywall`, `/developer/api-keys`, `/contact`, `/privacy`, `/terms`

## Architecture (inferred)
- Vite-built SPA, code-split into lazy chunks. Chunk names suggest the renderer design:
  `PianoKeyboardRenderer`, `PianoLayout`, `SketchWaterfallRenderer`, `NotefallCameraFit`, `noteDrawEnd`, `NotePalettes`, `WaterfallSharedInputs`, `pianoSceneSettings`, `IntroPage`
- Separate "waterfall" renderers share one input model (`WaterfallSharedInputs`), so looks are swappable. A camera-fit module implies a 3D scene.
- Service worker (`/sw.js`) + PWA icons: installable/offline shell.
- reCAPTCHA Enterprise on the page (gates sign-up/uploads, not core playback).
- Song analysis (audio -> notes, sheet OCR, stems) almost certainly runs server-side, billed per second. Not visible from the client.

## Deeper findings (main bundle, read as text after REA timed out on it)
Confirms the web app is the same product as the iPhone app: the bundle links to App Store id6760156164.
- **Stack:** React SPA; Firebase (Auth, App Check, Analytics); Google reCAPTCHA Enterprise; Stripe billing; YouTube iframe API for link imports.
- **Backend is split into separate services** (service names only; we do not call them):
  - audio-to-notes transcription (hosted on Modal)
  - beat analysis (Modal)
  - score generation: notes -> sheet music (Modal)
  - finger/hand assignment from notes (Modal)
  - hand-motion service (Modal), likely video of hands
  - sheet-music scan service (own subdomain)
  - media import from links (own subdomain, "fetch-media")
  - account API and Stripe billing (Google Cloud Run)
- **Playback sound:** a public piano sample set (splendid-grand-piano) loaded from a community samples host, so audio is sampled, not synthesized.
- **Not found in main bundle:** no 3D library by name, so the falling-notes view is in the lazy chunks listed above.

## Implication for our build
The hard part (audio -> notes, sheet scan, fingering) is server-side ML. The client is a renderer + player. Our prototype can skip transcription by taking MIDI, then add an open-source transcriber (e.g. Basic Pitch) later.

## Not established
- Request/response formats of the backend services (not probed, and we should not call their private endpoints).
- Credit accounting and exact models used.

## Rebuild plan (our own code)
1. Note model: `{pitch, startSec, durSec, hand?}` from MIDI input first (skip transcription).
2. Waterfall renderer (Canvas/WebGL) + keyboard highlight, driven by one playback clock.
3. Practice controls: speed, loop, count-in, metronome, hand guide.
4. Palettes + Flat/Spectrum looks.
5. Later: audio-to-notes (existing open-source transcription), sheet rendering, exports.

Evidence: REA analyze_web_bundle ev_e4531c3d215df004d2d40fe90bda2dfaae524993bc3c0435d460ce8b9d3a1233 (13 scripts, 12 route candidates).
