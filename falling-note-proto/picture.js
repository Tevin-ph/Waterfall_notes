// Reads notes from a falling-notes ("Synthesia style") video by watching which piano keys light up.
// 1) find the keyboard in the picture, 2) work out which key is which from the black-key pattern,
// 3) play the video through and record when each key changes colour. Exact timing, no listening, no guessing from sound.
// readPicture(file, onProgress(0..1, label)) -> { notes: [{m,t,d,v,h}], info: {...} }   (throws Error with a plain message)

const WHITE_IDX = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];            // white-key index within an octave for each pitch class
const BLACK_PCS = [1, 3, 6, 8, 10];
const GAP_PATTERN = [1, 2, 1, 1, 2];                                 // gaps (in white-key widths) after C#, D#, F#, G#, A#
const whiteIndex = m => 7 * Math.floor(m / 12) + WHITE_IDX[m % 12];
const isBlack = m => BLACK_PCS.includes(m % 12);

const wait = (target, ev, ms = 15000) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error("The video took too long to load.")), ms);
  target.addEventListener(ev, () => { clearTimeout(t); res(); }, { once: true });
  target.addEventListener("error", () => { clearTimeout(t); rej(new Error("The browser can't play this video (try an mp4 in H.264 format).")); }, { once: true });
});
const seekTo = (v, t) => new Promise(res => { v.addEventListener("seeked", res, { once: true }); v.currentTime = t; });
const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

export async function readPicture(file, onProgress = () => {}) {
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
  try {
    onProgress(0.02, "Opening the video…");
    await wait(v, "loadedmetadata");
    if (!v.videoWidth) throw new Error("This file has no picture to read.");
    if (!isFinite(v.duration)) {                                              // some WebM files don't say how long they are: seek far to make the browser work it out
      v.currentTime = 1e7; await new Promise(r => v.addEventListener("timeupdate", r, { once: true })); v.currentTime = 0;
      await new Promise(r => v.addEventListener("seeked", r, { once: true }));
    }
    const dur = v.duration;
    if (!isFinite(dur) || dur < 1) throw new Error("The video is too short or its length is unknown.");
    const W = Math.min(960, v.videoWidth), H = Math.round(v.videoHeight * W / v.videoWidth);
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    const y0 = Math.floor(H * 0.45), RH = H - y0;                         // the keyboard is always in the lower part

    // ---- 1. a "resting" picture of the keyboard: per-pixel median over several moments ----
    const SAMPLES = 9, frames = [];
    for (let i = 0; i < SAMPLES; i++) {
      await seekTo(v, dur * (0.04 + 0.9 * i / (SAMPLES - 1)));
      cx.drawImage(v, 0, 0, W, H); frames.push(cx.getImageData(0, y0, W, RH).data);
      onProgress(0.03 + 0.07 * (i + 1) / SAMPLES, "Looking at the keyboard…");
    }
    const rest = new Uint8ClampedArray(W * RH * 4), tmp = new Array(SAMPLES);
    for (let p = 0; p < W * RH * 4; p += 4) for (let c = 0; c < 3; c++) {
      for (let k = 0; k < SAMPLES; k++) tmp[k] = frames[k][p + c];
      tmp.sort((a, b) => a - b); rest[p + c] = tmp[SAMPLES >> 1];
    }
    const L = (x, y) => { const p = (y * W + x) * 4; return lum(rest[p], rest[p + 1], rest[p + 2]); };

    // ---- 2. find the keyboard: the rows with the most light/dark jumps are the black-key rows ----
    const trans = new Float32Array(RH);
    for (let y = 0; y < RH; y++) { let n = 0; for (let x = 1; x < W; x++) if (Math.abs(L(x, y) - L(x - 1, y)) > 70) n++; trans[y] = n; }
    const sm = trans.map((_, y) => ((trans[y - 1] || 0) + trans[y] + (trans[y + 1] || 0)) / 3);
    let yPeak = 0; for (let y = 0; y < RH; y++) if (sm[y] > sm[yPeak]) yPeak = y;
    if (sm[yPeak] < 10) throw new Error("I couldn't find a piano keyboard in this video.");
    let zTop = yPeak, zBot = yPeak;
    while (zTop > 0 && sm[zTop - 1] >= 0.6 * sm[yPeak]) zTop--;
    while (zBot < RH - 1 && sm[zBot + 1] >= 0.6 * sm[yPeak]) zBot++;
    const yRow = Math.round(zTop + 0.4 * (zBot - zTop));

    // dark segments on that row are the black keys
    const row = []; for (let x = 0; x < W; x++) row.push(L(x, yRow));
    const sorted = [...row].sort((a, b) => a - b), white = sorted[Math.floor(sorted.length * 0.85)], thr = 0.5 * white;
    let runs = [], s = -1;
    for (let x = 0; x <= W; x++) {
      const dark = x < W && row[x] < thr;
      if (dark && s < 0) s = x; else if (!dark && s >= 0) { runs.push([s, x - 1]); s = -1; }
    }
    runs = runs.filter(r => r[1] - r[0] + 1 >= 2);
    const widths = runs.map(r => r[1] - r[0] + 1).sort((a, b) => a - b), medW = widths[widths.length >> 1] || 0;
    runs = runs.filter(r => (r[1] - r[0] + 1) <= 2.2 * medW && (r[1] - r[0] + 1) >= 0.4 * medW);
    if (runs.length < 6) throw new Error("I couldn't make out the black keys. Is the whole keyboard visible in the video?");
    const centers = runs.map(r => (r[0] + r[1]) / 2);
    const gaps = centers.slice(1).map((c, i) => c - centers[i]);
    const smallGaps = [...gaps].sort((a, b) => a - b), minGap = smallGaps[0];
    const wKey = median(gaps.filter(g => g <= 1.35 * minGap));            // one white key's width in pixels
    const cls = gaps.map(g => (Math.abs(g - wKey) < 0.3 * wKey ? 1 : Math.abs(g - 2 * wKey) < 0.4 * wKey ? 2 : 0));

    // longest stretch of recognisable gaps, matched against the repeating 1,2,1,1,2 pattern
    let best = { len: 0, at: 0 }, runStart = 0;
    for (let i = 0; i <= cls.length; i++) {
      if (i === cls.length || cls[i] === 0) { if (i - runStart > best.len) best = { len: i - runStart, at: runStart }; runStart = i + 1; }
    }
    if (best.len < 5) throw new Error("I couldn't tell the keys apart (need a clear view of at least 6 black keys).");
    let rot = -1;
    for (let r = 0; r < 5 && rot < 0; r++) {
      let ok = true; for (let i = 0; i < best.len; i++) if (cls[best.at + i] !== GAP_PATTERN[(r + i) % 5]) { ok = false; break; }
      if (ok) rot = r;
    }
    if (rot < 0) throw new Error("The black keys don't look like a normal piano pattern.");
    const refCenter = centers[best.at], refMidi = 60 + BLACK_PCS[rot];     // octave is a placeholder, fixed below

    // x of every key (relative to the reference black key)
    const xWhite = m => (refCenter - wKey / 2) + (whiteIndex(m) - whiteIndex(refMidi - 1)) * wKey;
    const xKey = m => (isBlack(m) ? xWhite(m - 1) + wKey / 2 : xWhite(m));

    // ---- how far down the keyboard goes, and which keys exist ----
    let kbBot = zBot;
    for (let y = zBot; y < RH; y++) { let sum = 0, n = 0; for (let x = 0; x < W; x += 3) { sum += L(x, y); n++; } if (sum / n > 0.25 * white) kbBot = y; else break; }
    const yWhite = Math.min(RH - 2, Math.round(zBot + 0.55 * (kbBot - zBot))), yBlack = Math.round(zTop + 0.4 * (zBot - zTop));
    const present = [];
    for (let m = 21 - 24; m <= 108 + 24; m++) {                              // generous range; the pixels decide
      if (isBlack(m)) continue;
      const x = Math.round(xWhite(m)); if (x < 3 || x >= W - 3) continue;
      if (L(x, yWhite) > 0.55 * white) present.push(m);
    }
    if (present.length < 8) throw new Error("I couldn't see enough white keys.");
    // keep the longest unbroken run of keys
    present.sort((a, b) => a - b);
    let seg = [present[0]], bestSeg = seg;
    for (let i = 1; i < present.length; i++) {
      const gapIdx = whiteIndex(present[i]) - whiteIndex(present[i - 1]);
      if (gapIdx === 1) seg.push(present[i]); else { if (seg.length > bestSeg.length) bestSeg = seg; seg = [present[i]]; }
    }
    if (seg.length > bestSeg.length) bestSeg = seg;
    let lo = bestSeg[0], hi = bestSeg[bestSeg.length - 1];
    // fix the octave: a full 88-key board starts on A0; otherwise centre the keyboard near middle C
    const nWhite = bestSeg.length; let shift = 0, octaveGuessed = true;
    if (nWhite >= 50 && nWhite <= 52) { shift = nearestOctave(21 - lo); octaveGuessed = false; }   // a full piano starts on A0 (MIDI 21)
    else { const centre = (lo + hi) / 2; shift = Math.round((60 - centre) / 12) * 12; }
    // all keys from lo..hi (including the blacks between them), moved by the octave shift
    const keys = [];
    for (let m = lo; m <= hi + 1; m++) {
      if (isBlack(m) && m > hi) continue;
      const black = isBlack(m), x = Math.round(xKey(m));
      if (x < 1 || x >= W - 1) continue;
      keys.push({ ref: m, midi: m + shift, black, x, y: black ? yBlack : yWhite,
                  hw: Math.max(1, Math.round((black ? 0.16 : 0.22) * wKey)), hh: Math.max(2, Math.round(0.05 * (kbBot - zTop + 1))) });
    }
    for (const k of keys) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = k.y - k.hh; yy <= k.y + k.hh; yy++) for (let xx = k.x - k.hw; xx <= k.x + k.hw; xx++) {
        if (yy < 0 || yy >= RH) continue; const p = (yy * W + xx) * 4; r += rest[p]; g += rest[p + 1]; b += rest[p + 2]; n++;
      }
      k.rest = [r / n, g / n, b / n];
    }
    onProgress(0.12, "Found " + keys.length + " keys. Watching the video…");

    // ---- 3. play the video through, noting when each key changes colour ----
    const ON = 60, OFF = 35;                                                 // colour distance thresholds (with hysteresis)
    const state = keys.map(() => ({ on: false, since: 0, sumRGB: [0, 0, 0], n: 0, offFrames: 0, lastOn: 0 }));
    const events = []; let prevT = 0, frameCount = 0;
    const closeNote = (k, st, tEnd) => {
      if (tEnd - st.since < 0.045) return;
      events.push({ m: k.midi, t: st.since, d: tEnd - st.since, v: 0.8, rgb: st.sumRGB.map(c => c / Math.max(1, st.n)) });
    };
    await new Promise((resolve, reject) => {
      let lastFrameAt = performance.now(), done = false;
      const watchdog = setInterval(() => { if (performance.now() - lastFrameAt > 6000 && !done) { done = true; clearInterval(watchdog); v.pause(); reject(new Error("The video stopped playing. Keep this tab in front while it reads.")); } }, 1000);
      const finish = () => { if (done) return; done = true; clearInterval(watchdog); v.pause(); resolve(); };
      v.addEventListener("ended", finish, { once: true });
      const cb = (_now, meta) => {
        lastFrameAt = performance.now();
        const t = meta.mediaTime;
        cx.drawImage(v, 0, 0, W, H);
        const img = cx.getImageData(0, y0, W, RH).data;
        const mid = frameCount ? (prevT + t) / 2 : t;                        // a change happened somewhere between the last frame and this one
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i], st = state[i];
          let r = 0, g = 0, b = 0, n = 0;
          for (let yy = k.y - k.hh; yy <= k.y + k.hh; yy++) for (let xx = k.x - k.hw; xx <= k.x + k.hw; xx++) {
            if (yy < 0 || yy >= RH) continue; const p = (yy * W + xx) * 4; r += img[p]; g += img[p + 1]; b += img[p + 2]; n++;
          }
          r /= n; g /= n; b /= n;
          const d = Math.hypot(r - k.rest[0], g - k.rest[1], b - k.rest[2]);
          if (!st.on && d > ON) { st.on = true; st.since = mid; st.sumRGB = [0, 0, 0]; st.n = 0; st.offFrames = 0; }
          else if (st.on && d < OFF) { st.offFrames++; if (st.offFrames >= 2) { st.on = false; closeNote(k, st, st.lastOn || mid); } }
          else if (st.on) st.offFrames = 0;
          if (st.on) { if (d > OFF) { st.lastOn = t + (t - prevT) / 2; if (d > ON) { st.sumRGB[0] += r; st.sumRGB[1] += g; st.sumRGB[2] += b; st.n++; } } }
        }
        prevT = t; frameCount++;
        onProgress(0.12 + 0.86 * Math.min(1, t / dur), "Reading the notes… " + Math.round(100 * t / dur) + "%");
        if (!done) v.requestVideoFrameCallback(cb);
      };
      v.requestVideoFrameCallback(cb);
      v.currentTime = 0; v.playbackRate = 2;
      v.play().catch(() => reject(new Error("The browser wouldn't play the video. Click the page once and try again.")));
    });
    keys.forEach((k, i) => { if (state[i].on) closeNote(k, state[i], Math.min(dur, state[i].lastOn || prevT)); });
    if (!events.length) throw new Error("I didn't see any keys light up. This may not be a falling-notes video.");

    // ---- hands: if the lit keys come in two clearly different colours, those are the two hands ----
    const hue = ([r, g, b]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx === mn) return 0; const d = mx - mn;
      let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return ((h * 60) + 360) % 360; };
    const hues = events.map(e => hue(e.rgb)), hd = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
    let c1 = hues[0], c2 = hues.reduce((far, h) => (hd(h, c1) > hd(far, c1) ? h : far), hues[0]);
    for (let it = 0; it < 8; it++) {
      const g1 = [], g2 = []; hues.forEach((h, i) => (hd(h, c1) <= hd(h, c2) ? g1 : g2).push(i));
      if (g1.length) c1 = circMean(g1.map(i => hues[i])); if (g2.length) c2 = circMean(g2.map(i => hues[i]));
    }
    const twoColours = hd(c1, c2) > 40;
    const grp = events.map((e, i) => (hd(hues[i], c1) <= hd(hues[i], c2) ? 1 : 2));
    const meanPitch = g => { const a = events.filter((_, i) => grp[i] === g); return a.length ? a.reduce((s, e) => s + e.m, 0) / a.length : 0; };
    const rightGroup = meanPitch(1) >= meanPitch(2) ? 1 : 2;
    const notes = events.map((e, i) => ({ m: e.m, t: e.t, d: e.d, v: e.v, h: twoColours ? (grp[i] === rightGroup ? 0 : 1) : (e.m < 60 ? 1 : 0) }))
      .sort((a, b) => a.t - b.t);
    onProgress(1, "Done");
    return { notes, info: { keys: keys.length, lowest: keys[0].midi, highest: keys[keys.length - 1].midi, octaveGuessed, twoHands: twoColours, frames: frameCount } };
  } finally {
    v.pause(); v.removeAttribute("src"); v.load(); URL.revokeObjectURL(url);
  }
}

function median(a) { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; }
function nearestOctave(diff) { return Math.round(diff / 12) * 12; }
function circMean(hs) { let x = 0, y = 0; for (const h of hs) { x += Math.cos(h * Math.PI / 180); y += Math.sin(h * Math.PI / 180); } return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360; }
