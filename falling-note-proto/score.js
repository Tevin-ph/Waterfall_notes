// Reads WRITTEN music from a video that shows sheet music (page flips or a score on screen).
// 1) sample the video and look for staves (groups of 5 evenly spaced horizontal lines), 2) split it into pages where the picture changes,
// 3) take the sharpest frame of each page and enlarge it so the notation scanner can read it, 4) scan each page, 5) join the pages in order.
// Notation gives the notes as written with steady timing, not the exact timing of the performance in the video.
// readScoreVideo(file, onProgress(0..1, label), scanImage(blob, name) -> MusicXML text, parseXml(text) -> {notes, bpm, name})
// Throws an Error with .notScore = true when the video doesn't look like sheet music, so the caller can try something else.

const AW = 640;                                              // width frames are analysed at
const wait = (target, ev, ms = 15000) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error("The video took too long to load.")), ms);
  target.addEventListener(ev, () => { clearTimeout(t); res(); }, { once: true });
  target.addEventListener("error", () => { clearTimeout(t); rej(new Error("The browser can't play this video.")); }, { once: true });
});
const seekTo = (v, t) => new Promise(res => { v.addEventListener("seeked", res, { once: true }); v.currentTime = t; });

// Finds groups of five evenly spaced dark horizontal lines in a grayscale frame. Returns { staves, spacing } (spacing in pixels of this frame).
function staffInfo(gray, w, h) {
  const rows = [];
  for (let y = 0; y < h; y++) { let dark = 0; for (let x = 0; x < w; x++) if (gray[y * w + x] < 150) dark++; rows.push(dark / w); }
  const lines = []; let y = 0;
  while (y < h) {                                            // merge neighbouring rows into one line position
    if (rows[y] > 0.22) { let y2 = y, wsum = 0, sum = 0; while (y2 < h && rows[y2] > 0.22) { wsum += rows[y2]; sum += rows[y2] * y2; y2++; } lines.push(sum / wsum); y = y2; } else y++;
  }
  let staves = 0, spacingSum = 0;
  for (let i = 0; i + 4 < lines.length;) {
    const d = [1, 2, 3, 4].map(k => lines[i + k] - lines[i + k - 1]), mean = d.reduce((a, b) => a + b, 0) / 4;
    if (mean >= 3 && mean <= 30 && d.every(x => Math.abs(x - mean) <= 0.22 * mean)) { staves++; spacingSum += mean; i += 5; } else i++;
  }
  return { staves, spacing: staves ? spacingSum / staves : 0 };
}

export async function readScoreVideo(file, onProgress, scanImage, parseXml) {
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
  try {
    onProgress(0.02, "Looking for sheet music in the video…");
    await wait(v, "loadedmetadata");
    if (!v.videoWidth) throw new Error("This file has no picture to read.");
    if (!isFinite(v.duration)) { v.currentTime = 1e7; await new Promise(r => v.addEventListener("timeupdate", r, { once: true })); v.currentTime = 0; await new Promise(r => v.addEventListener("seeked", r, { once: true })); }
    const dur = v.duration, AH = Math.round(v.videoHeight * AW / v.videoWidth);
    const cv = document.createElement("canvas"); cv.width = AW; cv.height = AH;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    const grab = async t => {
      await seekTo(v, Math.min(t, Math.max(0, dur - 0.05)));
      cx.drawImage(v, 0, 0, AW, AH);
      const d = cx.getImageData(0, 0, AW, AH).data, gray = new Uint8Array(AW * AH); let sharp = 0;
      for (let i = 0, p = 0; i < d.length; i += 4, p++) gray[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      for (let y = 1; y < AH; y++) for (let x = 1; x < AW; x++) { const p = y * AW + x; sharp += Math.abs(gray[p] - gray[p - 1]) + Math.abs(gray[p] - gray[p - AW]); }
      const thumb = new Float32Array(64 * 36);                 // 64x36 average, for telling pages apart
      for (let ty = 0; ty < 36; ty++) for (let tx = 0; tx < 64; tx++) {
        let s = 0, n = 0; for (let y = Math.floor(ty * AH / 36); y < Math.floor((ty + 1) * AH / 36); y++) for (let x = Math.floor(tx * AW / 64); x < Math.floor((tx + 1) * AW / 64); x++) { s += gray[y * AW + x]; n++; }
        thumb[ty * 64 + tx] = s / Math.max(1, n);
      }
      return { t, gray, thumb, sharp, ...staffInfo(gray, AW, AH) };
    };

    // ---- is it a score video? look at ~10 frames spread through it ----
    const probe = []; for (let i = 0; i < 10; i++) probe.push(await grab(dur * (0.03 + 0.94 * i / 9)));
    const withStaves = probe.filter(f => f.staves >= 1).length;
    if (withStaves < 4) { const e = new Error("This video doesn't show sheet music."); e.notScore = true; throw e; }
    onProgress(0.08, "Found sheet music. Finding the pages…");

    // ---- sample through the video; a new page starts when the picture changes ----
    const step = Math.max(0.5, dur / 240), samples = [];
    for (let t = 0; t < dur; t += step) { samples.push(await grab(t)); if (samples.length % 10 === 0) onProgress(0.08 + 0.2 * t / dur, "Finding the pages…"); }
    // Fraction of pixels that changed a lot. Averages would hide a page whose only difference is a few notes on an identical staff.
    const changed = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 80) n++; return n / a.length; };
    const SAME = 0.0006;                                       // below this the picture is the same page (compression noise stays far under it)
    const pages = []; let cur = null;
    for (const f of samples) {
      if (f.staves < 1) { cur = null; continue; }             // title cards, black frames, talking
      if (cur && changed(cur.last.gray, f.gray) < SAME) { cur.frames.push(f); cur.last = f; }
      else { cur = { frames: [f], last: f }; pages.push(cur); }
    }
    // a page that comes back (same picture as an earlier one) is only read once
    const unique = [];
    for (const p of pages) { const best = p.frames.reduce((a, b) => (b.sharp > a.sharp ? b : a)); if (!unique.some(u => changed(u.best.gray, best.gray) < SAME / 2)) unique.push({ best, spacing: best.spacing }); }
    const MAX = 40; const use = unique.slice(0, MAX);
    if (!use.length) { const e = new Error("I couldn't find a clear page of music."); e.notScore = true; throw e; }

    // ---- grab each page at full size, enlarged so the staff spacing is about 22 px (what the scanner reads best), then scan it ----
    const notes = []; let offset = 0, failed = 0, tempo = 0, title = "";
    for (let i = 0; i < use.length; i++) {
      onProgress(0.3 + 0.68 * i / use.length, "Reading page " + (i + 1) + " of " + use.length + "… (about 10-30 seconds each)");
      await seekTo(v, Math.min(use[i].best.t, Math.max(0, dur - 0.05)));
      const nativeSpacing = use[i].spacing * (v.videoWidth / AW), scale = Math.max(1, Math.min(4, Math.ceil(22 / Math.max(3, nativeSpacing))));
      const pc = document.createElement("canvas"); pc.width = v.videoWidth * scale; pc.height = v.videoHeight * scale;
      const pg = pc.getContext("2d"); pg.imageSmoothingEnabled = true; pg.imageSmoothingQuality = "high"; pg.fillStyle = "#fff"; pg.fillRect(0, 0, pc.width, pc.height);
      pg.drawImage(v, 0, 0, pc.width, pc.height);
      const blob = await new Promise(r => pc.toBlob(r, "image/png"));
      try {
        const song = parseXml(await scanImage(blob, "page-" + (i + 1) + ".png"));
        let end = 0; for (const n of song.notes) { notes.push({ ...n, t: n.t + offset }); end = Math.max(end, n.t + n.d); }
        offset += end + 0.4; tempo = tempo || song.bpm; if (!title && song.name && song.name !== "Scanned score") title = song.name;
      } catch (e) { failed++; console.warn("score page", i + 1, "not read:", e.message); }
    }
    if (!notes.length) throw new Error("I found " + use.length + " page(s) of music but the scanner couldn't read any notes. Video frames are lower quality than a real score: try a PDF.");
    onProgress(1, "Done");
    return { notes, bpm: tempo || 100, title, info: { pages: use.length, failedPages: failed, truncated: unique.length > MAX } };
  } finally {
    v.pause(); v.removeAttribute("src"); v.load(); URL.revokeObjectURL(url);
  }
}
