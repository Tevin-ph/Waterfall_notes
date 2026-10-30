// Checks tempo.js on made-up songs whose true tempo is known (random tempo, swung/rhythm mixes, timing jitter, a little drift),
// against the old behaviour of always assuming 100 BPM. Run: node eval/tempo_test.mjs
import { estimateTempo } from "../tempo.js";
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
function song(bpm, jitter, drift, density) {
  const notes = []; let t = 0.3 + rnd() * 0.4;
  const beats = 70;
  for (let b = 0; b < beats; b++) {
    const period = 60 / bpm * (1 + drift * Math.sin(b / 9));
    for (const sub of [0, 0.5]) if (sub === 0 || rnd() < density) {
      if (rnd() < 0.12) continue;                                              // rests
      const m = 48 + Math.floor(rnd() * 30), v = 0.4 + rnd() * 0.5;
      notes.push({ m, t: t + sub * period + gauss() * jitter, d: period * 0.4, v });
      if (rnd() < 0.3) notes.push({ m: m + 4, t: t + sub * period + gauss() * jitter * 0.5, d: period * 0.4, v });   // chord partner
    }
    t += period;
  }
  return notes;
}
const rows = [];
for (let i = 0; i < 300; i++) {
  const bpm = 55 + rnd() * 105, jitter = 0.01 + rnd() * 0.025, drift = rnd() * 0.03, density = 0.2 + rnd() * 0.7;
  const e = estimateTempo(song(bpm, jitter, drift, density));
  rows.push({ bpm, est: e ? e.bpm : null, conf: e ? e.confidence : 0 });
}
const within = (a, b, tol) => Math.abs(a - b) / b <= tol;
const okExact = rows.filter(r => r.est && within(r.est, r.bpm, 0.03)).length;
const okOctave = rows.filter(r => r.est && [1, 2, 0.5].some(k => within(r.est * k, r.bpm, 0.03))).length;
const base = rows.filter(r => within(100, r.bpm, 0.03)).length;
console.log("300 made-up songs, true tempo 55-160 BPM, timing jitter 10-35 ms, up to 3% drift");
console.log("  old default (always 100 BPM):   right within 3%: " + (100 * base / 300).toFixed(1) + "%");
console.log("  tempo.js:                       right within 3%: " + (100 * okExact / 300).toFixed(1) + "%   (counting half/double tempo as right: " + (100 * okOctave / 300).toFixed(1) + "%)");
const hi = rows.filter(r => r.conf >= 4), lo = rows.filter(r => r.conf < 4);
const acc = a => a.length ? (100 * a.filter(r => r.est && within(r.est, r.bpm, 0.03)).length / a.length).toFixed(1) + "% of " + a.length : "n/a";
console.log("  confidence >= 4: " + acc(hi) + "   confidence < 4: " + acc(lo));
