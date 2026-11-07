// The Splitter page: pick a song, the local helper splits it into instruments (vocals, drums, bass, guitar, piano, other), and a mixer plays them together
// with a volume, mute and solo for each. Everything here runs in the page; the splitting itself is done by the helper (split_worker.py, see scan_server.py
// /split). Loaded the first time the page is opened.
const STEMS = {   // order on screen, colour, label
  vocals: { color: "#8b8cf0", label: "Vocals" }, drums: { color: "#e8628a", label: "Drums" }, bass: { color: "#e7d93f", label: "Bass" },
  guitar: { color: "#f49a45", label: "Guitar" }, piano: { color: "#55c8f5", label: "Piano" }, other: { color: "#3ee69a", label: "Everything else" },
};
const ORDER = ["vocals", "drums", "bass", "guitar", "piano", "other"];
const $ = id => document.getElementById(id);
const H = { "X-WN": "1" };                                   // the helper only answers this page
const fmt = s => { s = Math.max(0, s); return Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0") + "." + Math.floor((s % 1) * 10); };

function wavBlob(buf) {                                      // 16-bit stereo WAV from an AudioBuffer
  const n = buf.length, ch = Math.min(2, buf.numberOfChannels), out = new ArrayBuffer(44 + n * 4), v = new DataView(out);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + n * 4, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, buf.sampleRate, true); v.setUint32(28, buf.sampleRate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 4, true);
  const L = buf.getChannelData(0), R = ch > 1 ? buf.getChannelData(1) : L;
  for (let i = 0, o = 44; i < n; i++, o += 4) {
    v.setInt16(o, Math.max(-1, Math.min(1, L[i])) * 32767, true); v.setInt16(o + 2, Math.max(-1, Math.min(1, R[i])) * 32767, true);
  }
  return new Blob([out], { type: "audio/wav" });
}
function save(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }

export function initSplitter() {
  const S = { ac: null, master: null, tracks: {}, name: "song", dur: 0, playing: false, t0: 0, off: 0, raf: 0, solo: new Set(), busy: false };
  const ctx = () => S.ac || (S.ac = new AudioContext({ sampleRate: 44100 }));
  let info = null;

  async function checkHelper() {
    try {
      info = await (await fetch("/split/ready", { headers: H })).json();
    } catch (e) { info = null; $("spState").textContent = "Start the helper to split songs: python falling-note-proto/scan_server.py"; return; }
    if (!info.ready) { $("spState").textContent = info.message || "The splitter is not set up."; return; }
    $("spEngine").innerHTML = info.models.map(m => `<option value="${m.id}">${m.label}</option>`).join("");
    const best = info.models.find(m => m.id === "bsroformer_sw");
    if (best && info.gpu) $("spEngine").value = best.id;               // the better model when there is a graphics card to run it
    $("spState").textContent = info.gpu ? "Ready, using your graphics card" : "Ready, using the processor (slower)";
  }

  // ----- decode the chosen file and send it to the helper as a WAV -----
  async function start(file) {
    if (S.busy) return;
    if (!info || !info.ready) { await checkHelper(); if (!info || !info.ready) return; }
    S.busy = true; stop(); $("spMixer").hidden = true; setMsg("Reading the file…", 0);
    try {
      const dec = await ctx().decodeAudioData(await file.arrayBuffer());
      if (dec.duration > 15 * 60) throw new Error("Songs over 15 minutes are too long to split here.");
      S.name = file.name.replace(/\.[^.]+$/, "") || "song";
      setMsg("Sending the song to the splitter…", 0);
      const wav = wavBlob(dec);
      const r = await fetch("/split?model=" + encodeURIComponent($("spEngine").value), { method: "POST", headers: H, body: wav });
      if (!r.ok) throw new Error((await r.text()).split("\n")[0]);
      const { id } = await r.json();
      const t0 = Date.now(); let job;
      for (;;) {
        await new Promise(res => setTimeout(res, 1000));
        job = await (await fetch("/split/status?id=" + id, { headers: H })).json();
        const el = Math.round((Date.now() - t0) / 1000);
        if (job.state === "error") throw new Error(job.message);
        if (job.state === "done") break;
        setMsg((job.message || "Working…") + (job.device ? " (" + (job.device === "cuda" ? "graphics card" : "processor") + ")" : "") + "  " + Math.floor(el / 60) + ":" + String(el % 60).padStart(2, "0") + ". Keep this page open.", job.state === "running" ? job.progress : 0);
      }
      setMsg("Loading the instruments…", 1);
      await load(id, job);
      setMsg("", null);
    } catch (e) { setMsg("Could not split that song: " + (e.message || e), null, true); }
    S.busy = false;
  }
  function setMsg(text, p, err) {
    const m = $("spMsg"); m.textContent = text; m.classList.toggle("err", !!err);
    $("spBar").hidden = p == null; if (p != null) $("spBar").firstElementChild.style.width = Math.round(p * 100) + "%";
  }

  // ----- the stems: decode, draw, wire the mixer -----
  async function load(id, job) {
    const ac = ctx(); S.tracks = {}; S.solo.clear();
    if (S.master) S.master.disconnect();
    S.master = ac.createGain(); S.master.connect(ac.destination);
    const names = ORDER.filter(n => job.stems.some(s => s.name === n));
    for (const n of names) {
      const meta = job.stems.find(s => s.name === n);
      const buf = await ac.decodeAudioData(await (await fetch(`/split/stem?id=${id}&name=${n}`, { headers: H })).arrayBuffer());
      const gain = ac.createGain(); gain.connect(S.master);
      S.tracks[n] = { name: n, buf, gain, vol: 1, mute: false, present: meta.present, share: meta.share, peaks: peaksOf(buf, 1400), src: null };
    }
    S.dur = Math.max(...Object.values(S.tracks).map(t => t.buf.duration)); S.off = 0;
    let top = 0; for (const t of Object.values(S.tracks)) for (const x of t.peaks) top = Math.max(top, x);
    for (const t of Object.values(S.tracks)) t.peaks = t.peaks.map(x => Math.sqrt(x / (top || 1)));   // one shared scale (a silent stem looks silent); square root so a quiet instrument is still visible
    buildMixer(); $("spMixer").hidden = false; drawAll(); tick(); applyGains(true);
    $("spKey").textContent = job.key ? job.key.name : "…"; $("spKeyAlt").textContent = job.key && job.key.alt ? "or " + job.key.alt : ""; $("spBpm").textContent = job.bpm ? job.bpm.toFixed(1) : "…";
  }
  function peaksOf(buf, n) {
    const a = buf.getChannelData(0), b = buf.numberOfChannels > 1 ? buf.getChannelData(1) : a, step = Math.max(1, Math.floor(a.length / n)), out = new Float32Array(n);
    for (let i = 0; i < n; i++) { let m = 0; for (let j = i * step, e = Math.min(a.length, j + step); j < e; j += 8) m = Math.max(m, Math.abs(a[j]), Math.abs(b[j])); out[i] = m; }
    return out;
  }

  function buildMixer() {
    const host = $("spTracks"); host.innerHTML = "";
    for (const t of Object.values(S.tracks)) {
      const def = STEMS[t.name], row = document.createElement("div");
      row.className = "spRow" + (t.present ? "" : " absent"); row.dataset.n = t.name; row.style.setProperty("--c", def.color);
      row.innerHTML = `<div class="spHead"><div class="spName">${def.label}</div><div class="spTag">${t.present ? "" : "probably not in this song"}</div>
        <div class="spCtl"><input type="range" min="0" max="100" value="100" aria-label="${def.label} volume"><button class="spM" title="Mute">M</button><button class="spS" title="Solo (hear only this)">S</button>
        <button class="spD" title="Download ${def.label} as a WAV file">↓</button></div></div><div class="spWaveBox"><canvas class="spWave" aria-label="${def.label} waveform"></canvas></div>`;
      row.querySelector("input").oninput = e => { t.vol = e.target.value / 100; applyGains(); };
      row.querySelector(".spM").onclick = () => { t.mute = !t.mute; applyGains(); };
      row.querySelector(".spS").onclick = () => { S.solo.has(t.name) ? S.solo.delete(t.name) : S.solo.add(t.name); applyGains(); };
      row.querySelector(".spD").onclick = () => save(wavBlob(t.buf), `${S.name} - ${def.label}.wav`);
      row.querySelector("canvas").onpointerdown = e => { const r = e.currentTarget.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * S.dur); };
      host.appendChild(row); t.row = row; t.cv = row.querySelector("canvas");
    }
  }
  function gainOf(t) { return t.mute ? 0 : S.solo.size && !S.solo.has(t.name) ? 0 : t.vol; }
  function applyGains(now) {
    for (const t of Object.values(S.tracks)) {
      const g = gainOf(t); now ? (t.gain.gain.value = g) : t.gain.gain.setTargetAtTime(g, S.ac.currentTime, 0.015);
      if (t.row) { t.row.classList.toggle("off", g === 0); t.row.querySelector(".spM").classList.toggle("on", t.mute); t.row.querySelector(".spS").classList.toggle("on", S.solo.has(t.name)); }
    }
  }
  function drawAll() {
    const dpr = devicePixelRatio || 1;
    for (const t of Object.values(S.tracks)) {
      const cv = t.cv, w = cv.clientWidth, h = cv.clientHeight; if (!w) continue;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      const g = cv.getContext("2d"); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
      g.fillStyle = STEMS[t.name].color; const n = t.peaks.length, mid = h / 2;
      for (let x = 0; x < w; x += 2) { const p = t.peaks[Math.min(n - 1, Math.floor(x / w * n))], a = Math.max(1, p * (h / 2 - 3)); g.fillRect(x, mid - a, 1.4, a * 2); }
    }
    placeHead();
  }

  // ----- playing -----
  const pos = () => S.playing ? Math.min(S.dur, S.ac.currentTime - S.t0) : S.off;
  function play() {
    if (!Object.keys(S.tracks).length) return;
    const ac = ctx(); if (ac.state === "suspended") ac.resume();
    if (S.off >= S.dur - 0.05) S.off = 0;
    for (const t of Object.values(S.tracks)) { const s = ac.createBufferSource(); s.buffer = t.buf; s.connect(t.gain); s.start(0, S.off); t.src = s; }
    S.t0 = ac.currentTime - S.off; S.playing = true; $("spPlay").textContent = "Pause"; loop();
  }
  function stop() {
    if (S.playing) S.off = pos();
    for (const t of Object.values(S.tracks)) if (t.src) { try { t.src.stop(); } catch (e) {} t.src = null; }
    S.playing = false; if ($("spPlay")) $("spPlay").textContent = "Play"; cancelAnimationFrame(S.raf);
  }
  function seek(sec) { const was = S.playing; stop(); S.off = Math.max(0, Math.min(S.dur, sec)); tick(); if (was) play(); }
  function loop() { tick(); if (S.playing) { if (pos() >= S.dur) { stop(); S.off = 0; tick(); return; } S.raf = requestAnimationFrame(loop); } }
  function placeHead() { const p = pos() / (S.dur || 1); for (const t of Object.values(S.tracks)) if (t.row) t.row.style.setProperty("--p", (p * 100).toFixed(3) + "%"); }
  function tick() { $("spTime").textContent = fmt(pos()) + " / " + fmt(S.dur); placeHead(); }

  // ----- wiring -----
  $("spFile").onchange = e => { const f = e.target.files[0]; e.target.value = ""; if (f) start(f); };
  const drop = $("spDrop");
  drop.onclick = () => $("spFile").click();
  drop.ondragover = e => { e.preventDefault(); drop.classList.add("drag"); }; drop.ondragleave = () => drop.classList.remove("drag");
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove("drag"); const f = e.dataTransfer.files[0]; if (f) start(f); };
  $("spPlay").onclick = () => (S.playing ? stop() : play());
  const preset = fn => { for (const t of Object.values(S.tracks)) { t.mute = false; } S.solo.clear(); fn(); applyGains(); };
  $("spAll").onclick = () => preset(() => {});
  $("spKaraoke").onclick = () => preset(() => { if (S.tracks.vocals) S.tracks.vocals.mute = true; });
  $("spVocalsOnly").onclick = () => preset(() => { if (S.tracks.vocals) S.solo.add("vocals"); });
  $("spNoDrums").onclick = () => preset(() => { if (S.tracks.drums) S.tracks.drums.mute = true; });
  $("spMixDl").onclick = async () => {                                          // what you hear now, as one file
    const tr = Object.values(S.tracks); if (!tr.length) return;
    const off = new OfflineAudioContext(2, Math.ceil(S.dur * 44100), 44100);
    for (const t of tr) { const g = off.createGain(); g.gain.value = gainOf(t); g.connect(off.destination); const s = off.createBufferSource(); s.buffer = t.buf; s.connect(g); s.start(); }
    save(wavBlob(await off.startRendering()), `${S.name} - mix.wav`);
  };
  addEventListener("resize", () => { if (!$("spMixer").hidden) drawAll(); });
  addEventListener("keydown", e => { if (e.code === "Space" && $("v-split").classList.contains("show") && !$("spMixer").hidden && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); S.playing ? stop() : play(); } });
  checkHelper();
  return { enter() { checkHelper(); if (!$("spMixer").hidden) requestAnimationFrame(drawAll); }, leave() { stop(); } };
}
