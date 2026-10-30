import { estimateTempo } from "../tempo.js";
let seed = 777; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
function song(bpm, jitter, drift, density) { const notes = []; let t = 0.3 + rnd() * 0.4; for (let b = 0; b < 70; b++) { const period = 60 / bpm * (1 + drift * Math.sin(b / 9)); for (const sub of [0, 0.5]) if (sub === 0 || rnd() < density) { if (rnd() < 0.12) continue; const m = 48 + Math.floor(rnd() * 30), v = 0.4 + rnd() * 0.5; notes.push({ m, t: t + sub * period + gauss() * jitter, d: period * 0.4, v }); if (rnd() < 0.3) notes.push({ m: m + 4, t: t + sub * period + gauss() * jitter * 0.5, d: period * 0.4, v }); } t += period; } return notes; }
// steady songs with increasing timing looseness (jitter = how far real players drift from a grid), and fully random timing
const rows = [];
for (const [label, jit, drift] of [["steady (10-35 ms)", null, 0.015], ["looser (60 ms)", 0.06, 0.03], ["loose (100 ms)", 0.10, 0.05], ["random timing", -1, 0]]) {
  const fits = [], ok = [];
  for (let i = 0; i < 60; i++) {
    const bpm = 60 + rnd() * 90; let notes;
    if (jit === -1) { notes = []; let t = 0.4; for (let k = 0; k < 150; k++) { t += 0.15 + rnd() * 0.5; notes.push({ m: 60, t, d: 0.2, v: 0.6 }); } }
    else notes = song(bpm, jit == null ? 0.01 + rnd() * 0.025 : jit, drift, 0.2 + rnd() * 0.7);
    const e = estimateTempo(notes); fits.push(e.fit); ok.push(jit === -1 ? false : Math.abs(e.bpm - bpm) / bpm <= 0.03);
  }
  fits.sort((a, b) => a - b);
  console.log("%s  fit: min %s median %s max %s   tempo right: %s%%", label.padEnd(20), fits[0], fits[30], fits[59], Math.round(100 * ok.filter(Boolean).length / ok.length));
}
