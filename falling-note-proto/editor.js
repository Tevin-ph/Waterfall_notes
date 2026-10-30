// Piano-roll note editor: select, drag, resize, add, delete, undo. Edits the real song data, so playback, the library and exports all follow.
// initEditor(api) is called once by the page; api gives access to the song and transport without this file touching page globals.
const RULER = 26, ROW = 15, LOW = 21, HIGH = 108, HIT_EDGE = 7;
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const isBlack = m => [1, 3, 6, 8, 10].includes(m % 12);
const HAND = ["#4db5ff", "#ff8f4d"];

export function initEditor(api) {
  const $ = id => document.getElementById(id);
  const box = $("rollBox"), cv = $("roll"), cx = cv.getContext("2d");
  let pps = 140, scrollX = 0, scrollY = 0, W = 0, H = 0, DPR = 1;
  let sel = new Set(), drag = null, undo = [], redo = [], nextId = 1, saveTimer = 0, preview = 0;

  const song = () => api.song();
  const sources = () => {                                           // every real note object, wherever it lives
    const s = song(), out = [];
    for (const n of s.base) out.push({ n, list: s.base });
    for (const L of s.layers) for (const n of L.notes) out.push({ n, list: L.notes });
    return out;
  };
  const ensureIds = () => { for (const { n } of sources()) if (n.id >= nextId) nextId = n.id + 1; for (const { n } of sources()) if (!n.id) n.id = nextId++; };
  const byId = id => { for (const x of sources()) if (x.n.id === id) return x; return null; };
  const selected = () => [...sel].map(byId).filter(Boolean);
  const handOf = n => (n.h != null ? n.h : n.m < 60 ? 1 : 0);

  // ---------- history ----------
  const snapshot = () => { const s = song(); return JSON.stringify({ base: s.base, layers: s.layers, bpm: s.bpm, off: s.off || 0 }); };
  const restore = str => {
    const s = song(), o = JSON.parse(str); s.base = o.base; s.layers = o.layers;
    if (o.bpm) { s.bpm = o.bpm; s.off = o.off || 0; api.tempoChanged(); }          // Undo also takes back a tempo change
    commit(false);
  };
  const remember = () => { undo.push(snapshot()); if (undo.length > 60) undo.shift(); redo = []; };
  function commit(save = true) {
    api.rebuild(); api.resetSched(api.pos());
    sel = new Set([...sel].filter(id => byId(id)));
    updateInfo(); if (save) { clearTimeout(saveTimer); saveTimer = setTimeout(() => api.save(), 1200); }
  }
  // Takes (recorded layers) are merged into the song the first time you edit, so every note has a hand you can change.
  function flatten() {
    const s = song(); if (!s.layers.length) return;
    for (const n of s.notes) if (n.layer) s.base.push({ m: n.m, t: n.t, d: n.d, v: n.v, h: n.h, id: n.id });
    s.layers = []; api.renderLayers();
  }
  const edit = fn => { ensureIds(); remember(); flatten(); fn(); commit(); };

  // ---------- geometry ----------
  const yOf = m => RULER + (HIGH - m) * ROW - scrollY;
  const mOf = y => HIGH - Math.floor((y - RULER + scrollY) / ROW);
  const xOf = t => t * pps - scrollX;
  const tOf = x => Math.max(0, (x + scrollX) / pps);
  const clampM = m => Math.max(LOW, Math.min(HIGH, m));
  const snapT = t => Math.max(0, Math.round(t * 200) / 200);
  const totalW = () => Math.max(W, (song().dur + 2) * pps);
  const totalH = () => RULER + (HIGH - LOW + 1) * ROW;
  function clampScroll() {
    scrollX = Math.max(0, Math.min(scrollX, totalW() - W)); scrollY = Math.max(0, Math.min(scrollY, Math.max(0, totalH() - H)));
    const r = $("rollScroll"); r.max = Math.max(1, Math.round(totalW() - W)); r.value = Math.round(scrollX);
  }
  function resize() {
    const r = box.getBoundingClientRect(); DPR = Math.min(2, window.devicePixelRatio || 1);
    W = r.width; H = r.height; cv.width = W * DPR; cv.height = H * DPR; cx.setTransform(DPR, 0, 0, DPR, 0, 0); clampScroll();
  }
  new ResizeObserver(resize).observe(box);

  // ---------- drawing ----------
  function noteRect(n) { return { x: xOf(n.t), y: yOf(n.m) + 1, w: Math.max(4, n.d * pps), h: ROW - 2 }; }
  function draw() {
    requestAnimationFrame(draw);
    if (!W || !$("v-edit").classList.contains("show")) return;
    const s = song(), p = api.pos();
    cx.clearRect(0, 0, W, H);
    for (let m = LOW; m <= HIGH; m++) {                                    // pitch rows: black keys darker, a line at every C
      const y = yOf(m); if (y > H || y + ROW < RULER) continue;
      cx.fillStyle = isBlack(m) ? "#0b0b10" : "#101016"; cx.fillRect(0, y, W, ROW);
      if (m % 12 === 0) { cx.fillStyle = "rgba(255,255,255,.14)"; cx.fillRect(0, y + ROW - 1, W, 1); cx.fillStyle = "#6c6c78"; cx.font = "10px system-ui"; cx.fillText("C" + (m / 12 - 1), 4, y + ROW - 4); }
    }
    const beat = 60 / (s.bpm || 100), t0 = Math.floor(tOf(0) / beat) * beat;   // beat lines
    for (let t = t0; xOf(t) < W; t += beat) { const x = xOf(t); if (x < 0) continue; const bar = Math.round(t / beat) % 4 === 0; cx.fillStyle = bar ? "rgba(255,255,255,.11)" : "rgba(255,255,255,.04)"; cx.fillRect(Math.round(x), RULER, 1, H); }
    // notes
    for (const n of s.notes) {
      const r = noteRect(n); if (r.x > W || r.x + r.w < 0 || r.y > H || r.y + r.h < RULER) continue;
      const on = sel.has(n.id), hand = handOf(n);
      cx.fillStyle = (api.hand || HAND)[hand]; cx.globalAlpha = n.t <= p && n.t + n.d >= p ? 1 : 0.88; cx.beginPath(); cx.roundRect(r.x, r.y, r.w, r.h, 3); cx.fill(); cx.globalAlpha = 1;
      if (on) { cx.strokeStyle = "#fff"; cx.lineWidth = 2; cx.stroke(); cx.lineWidth = 1; }
      if (r.w > 20) { cx.fillStyle = "#0e0e14"; cx.font = "600 10px system-ui"; cx.fillText(NAMES[n.m % 12], r.x + 4, r.y + ROW - 5); }
    }
    if (drag && drag.kind === "marquee") {
      const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1), w = Math.abs(drag.x1 - drag.x0), h = Math.abs(drag.y1 - drag.y0);
      cx.fillStyle = "rgba(255,228,94,.12)"; cx.fillRect(x, y, w, h); cx.strokeStyle = "#ffe45e"; cx.strokeRect(x + .5, y + .5, w, h);
    }
    // ruler + playhead
    cx.fillStyle = "#14141a"; cx.fillRect(0, 0, W, RULER);
    cx.font = "11px system-ui"; cx.fillStyle = "#8a8a93";
    const step = pps > 200 ? 0.5 : pps > 90 ? 1 : pps > 45 ? 2 : 5;
    for (let t = Math.floor(tOf(0) / step) * step; xOf(t) < W; t += step) { const x = xOf(t); if (x < -30) continue; cx.fillRect(Math.round(x), RULER - 7, 1, 7); cx.fillText(fmt(t), x + 4, 14); }
    const px = xOf(p); cx.fillStyle = "#e5484d"; cx.fillRect(Math.round(px) - 1, 0, 2, H);
    cx.beginPath(); cx.moveTo(px - 6, 0); cx.lineTo(px + 6, 0); cx.lineTo(px, 9); cx.fill();
    if (api.S.playing && (px > W * 0.85 || px < 0)) { scrollX = Math.max(0, p * pps - W * 0.2); clampScroll(); }   // follow the playhead
  }
  const fmt = t => Math.floor(t / 60) + ":" + String(Math.floor(t % 60)).padStart(2, "0") + (t % 1 && pps > 200 ? ".5" : "");
  requestAnimationFrame(draw);

  // ---------- mouse ----------
  const pos = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function hit(x, y) {
    const list = song().notes;
    for (let i = list.length - 1; i >= 0; i--) { const n = list[i], r = noteRect(n); if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return { n, edge: x > r.x + r.w - HIT_EDGE && r.w > HIT_EDGE * 2 }; }
    return null;
  }
  function ping(m) {                                                    // hear a pitch while moving notes
    const now = performance.now(); if (now - preview < 90) return; preview = now; api.preview(m);
  }
  cv.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    cv.setPointerCapture(e.pointerId); const { x, y } = pos(e); ensureIds();
    if (y < RULER) { drag = { kind: "seek" }; api.seek(tOf(x)); return; }
    const h = hit(x, y);
    if (h) {
      if (e.shiftKey) { sel.has(h.n.id) ? sel.delete(h.n.id) : sel.add(h.n.id); }
      else if (!sel.has(h.n.id)) sel = new Set([h.n.id]);
      updateInfo();
      drag = { kind: h.edge ? "resize" : "move", x0: x, y0: y, started: false,
               orig: selected().map(({ n }) => ({ id: n.id, t: n.t, d: n.d, m: n.m })), lastM: h.n.m };
      if (!h.edge) ping(h.n.m);
    } else {
      if (!e.shiftKey) sel = new Set();
      drag = { kind: "marquee", x0: x, y0: y, x1: x, y1: y }; updateInfo();
    }
  });
  cv.addEventListener("pointermove", e => {
    const { x, y } = pos(e);
    if (!drag) { const h = hit(x, y); cv.style.cursor = y < RULER ? "pointer" : h ? (h.edge ? "ew-resize" : "grab") : "default"; return; }
    if (drag.kind === "seek") { api.seek(tOf(x)); return; }
    if (drag.kind === "marquee") { drag.x1 = x; drag.y1 = y; return; }
    const dx = (x - drag.x0) / pps, dm = Math.round((drag.y0 - y) / ROW);
    if (!drag.started && Math.abs(x - drag.x0) < 3 && Math.abs(y - drag.y0) < 3) return;
    if (!drag.started) { drag.started = true; remember(); flatten(); }
    for (const o of drag.orig) {
      const found = byId(o.id); if (!found) continue; const n = found.n;
      if (drag.kind === "move") { n.t = snapT(o.t + dx); n.m = clampM(o.m + dm); if (n.h == null) n.h = n.m < 60 ? 1 : 0; }
      else n.d = Math.max(0.03, snapT(o.d + dx));
    }
    const lead = byId(drag.orig[0].id); if (lead && drag.kind === "move" && lead.n.m !== drag.lastM) { drag.lastM = lead.n.m; ping(lead.n.m); }
    api.rebuild();
  });
  cv.addEventListener("pointerup", e => {
    if (!drag) return;
    if (drag.kind === "marquee") {
      const x0 = Math.min(drag.x0, drag.x1), x1 = Math.max(drag.x0, drag.x1), y0 = Math.min(drag.y0, drag.y1), y1 = Math.max(drag.y0, drag.y1);
      for (const n of song().notes) { const r = noteRect(n); if (r.x < x1 && r.x + r.w > x0 && r.y < y1 && r.y + r.h > y0 && y1 > RULER) sel.add(n.id); }
      updateInfo();
    } else if ((drag.kind === "move" || drag.kind === "resize") && drag.started) commit();
    drag = null;
  });
  cv.addEventListener("dblclick", e => {
    const { x, y } = pos(e); if (y < RULER || hit(x, y)) return;
    const m = clampM(mOf(y)), t = snapT(tOf(x));
    edit(() => { const id = nextId++; song().base.push({ m, t, d: 0.3, v: 0.8, h: api.handOfAuto(m), id }); sel = new Set([id]); });
    api.preview(m);
  });
  cv.addEventListener("wheel", e => {
    e.preventDefault();
    if (e.ctrlKey) { const t = tOf(pos(e).x); pps = Math.max(30, Math.min(600, pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); scrollX = t * pps - pos(e).x; }
    else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) scrollX += e.deltaX || e.deltaY;
    else scrollY += e.deltaY;
    clampScroll();
  }, { passive: false });
  $("rollScroll").addEventListener("input", e => { scrollX = +e.target.value; });

  // ---------- keys + buttons ----------
  addEventListener("keydown", e => {
    if (!$("v-edit").classList.contains("show") || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    const k = e.key, ctrl = e.ctrlKey || e.metaKey;
    if (k === "Delete" || k === "Backspace") { e.preventDefault(); del(); }
    else if (ctrl && k.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
    else if (ctrl && k.toLowerCase() === "y") { e.preventDefault(); doRedo(); }
    else if (ctrl && k.toLowerCase() === "a") { e.preventDefault(); ensureIds(); sel = new Set(song().notes.map(n => n.id)); updateInfo(); }
    else if (k === "ArrowUp" || k === "ArrowDown") { e.preventDefault(); shiftPitch((k === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 12 : 1)); }
    else if (k === "ArrowLeft" || k === "ArrowRight") { if (!sel.size) return; e.preventDefault(); nudge((k === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 0.1 : 0.01)); }
    else if (k === " ") { e.preventDefault(); api.togglePlay(); }
    else if (k === "Escape") { sel = new Set(); updateInfo(); }
  });
  const del = () => { if (!sel.size) return; edit(() => { const ids = sel; for (const { list } of sources()) for (let i = list.length - 1; i >= 0; i--) if (ids.has(list[i].id)) list.splice(i, 1); sel = new Set(); }); };
  const shiftPitch = d => { const targets = sel.size ? selected() : null; edit(() => { for (const { n } of (targets || sources())) n.m = clampM(n.m + d); }); const f = (targets || sources())[0]; if (f) api.preview(f.n.m); };
  const nudge = d => edit(() => { for (const { n } of selected()) n.t = Math.max(0, Math.round((n.t + d) * 1000) / 1000); });
  const setHand = h => { if (!sel.size) return; edit(() => { for (const { n } of selected()) n.h = h; }); };
  const doUndo = () => { if (!undo.length) return; redo.push(snapshot()); restore(undo.pop()); };
  const doRedo = () => { if (!redo.length) return; undo.push(snapshot()); restore(redo.pop()); };
  $("eUndo").onclick = doUndo; $("eRedo").onclick = doRedo; $("eDelete").onclick = del;
  $("eRight").onclick = () => setHand(0); $("eLeft").onclick = () => setHand(1);
  $("eDown").onclick = () => shiftPitch(-1); $("eUp").onclick = () => shiftPitch(1);
  $("eOctDown").onclick = () => shiftPitch(-12); $("eOctUp").onclick = () => shiftPitch(12);
  $("eClean").onclick = () => edit(() => { for (const { list } of sources()) for (let i = list.length - 1; i >= 0; i--) if (list[i].d < 0.05) list.splice(i, 1); });
  // Tidy bars. The earlier Clean up levels (remove blips / quiet / quiet low notes) were removed: measured on phone-style recordings with a
  // known answer they deleted several real notes for every false one (Gentle: 10% of real notes lost to remove 18% of the false ones).
  $("eTidy").onchange = e => {
    if (e.target.value === "trim") {      // for songs with no pedal information: show long bars as a short held key (Settings > Pedal brings the full length back). No note is removed or joined.
      e.target.value = ""; let cut = 0;
      edit(() => {
        // Same guess as the piano helper (tuned against real key releases): half the time to the next note in the same hand, at least 0.15 s and
        // at most 0.6 s (never more than the bar's own length), or 1 s at most when nothing follows within 3 s.
        const ons = [[], []]; for (const { n } of sources()) ons[handOf(n)].push(n.t); ons.forEach(a => a.sort((x, y) => x - y));
        for (const { n } of sources()) {
          if (!(n.d > 0.2 && n.kd == null)) continue;
          const a = ons[handOf(n)]; let lo = 0, hi = a.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] <= n.t + 0.04) lo = mid + 1; else hi = mid; }
          const gap = lo < a.length ? a[lo] - n.t : null;
          const kd = Math.round((gap != null && gap <= 3 ? Math.min(n.d, Math.max(0.15, Math.min(0.6, 0.5 * gap))) : Math.min(n.d, 1)) * 1000) / 1000;
          if (kd < n.d - 0.08) { n.kd = kd; cut++; }
        }
      });
      updateInfo(); $("eInfo").textContent += "  ·  " + cut + " long bars now show only the part where the key is held (Undo to bring them back)"; return;
    }
    e.target.value = "";
  };
  // Snap to beat: starts move to the nearest 1/4, 1/8, 1/16 or 1/32 of a beat grid built from the song's tempo (set it in Settings, or
  // tap it). Lengths round to the grid too, never shorter than one step. Selected notes only, or all when nothing is selected.
  $("eSnap").onchange = e => {
    const div = parseInt(e.target.value, 10); e.target.value = ""; if (!div) return;
    const s = song(), step = 60 / s.bpm * 4 / div, off = s.off || 0;
    const targets = sel.size ? selected() : sources();
    edit(() => { for (const { n } of targets) {
      n.t = Math.max(0, Math.round(((Math.round((n.t - off) / step) * step) + off) * 1000) / 1000);
      n.d = Math.max(step, Math.round(Math.round(n.d / step) * step * 1000) / 1000);
    } });
    $("eInfo").textContent += "  ·  snapped " + targets.length + " notes to 1/" + div;
  };
  // Change tempo: a faster or slower version of the whole song (notes and beats scaled together). A song with a video can't be changed,
  // since the video's sound would no longer match.
  $("eTempo").onchange = e => {
    const f = parseFloat(e.target.value); e.target.value = ""; if (!f) return;
    const s = song();
    if (s.video) { $("eInfo").textContent = "This song has a video, so its tempo can't be changed (the sound wouldn't match). Use the Speed slider to practise slower."; return; }
    edit(() => { for (const { n } of sources()) { n.t = Math.round(n.t / f * 1000) / 1000; n.d = Math.max(0.03, Math.round(n.d / f * 1000) / 1000); if (n.kd != null) n.kd = n.kd / f; }
                 s.bpm = Math.max(30, Math.min(240, s.bpm * f)); s.off = (s.off || 0) / f; });
    api.tempoChanged(); $("eInfo").textContent += "  ·  tempo x" + f + " (Undo to go back)";
  };
  $("eZoomIn").onclick = () => { pps = Math.min(600, pps * 1.3); clampScroll(); }; $("eZoomOut").onclick = () => { pps = Math.max(30, pps / 1.3); clampScroll(); };
  $("eSave").onclick = async () => { const b = $("eSave"); const ok = await api.save(); b.textContent = ok ? "Saved ✓" : "Nothing to save"; setTimeout(() => { b.textContent = "Save"; }, 1500); };
  $("ePlay").onclick = () => api.togglePlay();

  function updateInfo() {
    const s = song(), nSel = sel.size;
    $("eInfo").textContent = s.notes.length ? s.name + "  ·  " + s.notes.length + " notes" + (nSel ? "  ·  " + nSel + " selected" : "") + (s.layers.length ? "  ·  your recorded takes will be merged into the song when you edit" : "") : "Nothing open. Open a song from Library or Create.";
    $("eTitle").textContent = s.name || "Edit notes";
    $("eUndo").disabled = !undo.length; $("eRedo").disabled = !redo.length;
  }
  // called by the page whenever the Edit page is shown or a new song is loaded
  return {
    enter() {
      ensureIds(); undo = []; redo = []; sel = new Set(); resize(); updateInfo();
      const s = song(); if (s.notes.length) { const lo = Math.min(...s.notes.map(n => n.m)), hi = Math.max(...s.notes.map(n => n.m)); scrollY = Math.max(0, yOf((lo + hi) / 2) + scrollY - H / 2); }
      scrollX = 0; clampScroll();
    },
    refresh: updateInfo,
    setPlaying(on) { $("ePlay").textContent = on ? "Pause" : "Play"; },
  };
}
