// The hand model on imperfect input: timing jitter, missed and false notes, and bars stretched like pedal-extended lengths.
import fs from "node:fs"; import path from "node:path"; import { assignHands } from "../hands.js";
const dir = process.argv[2] || "_test/asap_json";
const songs = fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort().map(f => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296, gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
function variant(notes, o) {
  let out = notes.filter(() => rnd() >= (o.drop || 0)).map(n => ({ ...n, t: n.t + gauss() * (o.jitter || 0), d: n.d * (o.stretch || 1) }));
  const extra = Math.round(notes.length * (o.fake || 0)); for (let i = 0; i < extra; i++) { const b = notes[Math.floor(rnd() * notes.length)]; out.push({ m: Math.max(30, Math.min(100, b.m + Math.round(gauss() * 12))), t: b.t + rnd() * 0.3, d: 0.1, v: 0.4, h: null, fake: true }); }
  return out;
}
function score(o) { let ok = 0, tot = 0, c4 = 0; for (const s of songs) { const v = variant(s, o); const copy = v.map(n => ({ ...n, h: undefined })); assignHands(copy); copy.forEach((n, i) => { if (v[i].fake) return; tot++; ok += n.h === v[i].h; c4 += (v[i].m < 60 ? 1 : 0) === v[i].h; }); } return [100 * ok / tot, 100 * c4 / tot]; }
for (const [label, o] of [["exact timing (like a score)", {}], ["timing jitter 20 ms", { jitter: 0.02 }], ["jitter 40 ms", { jitter: 0.04 }], ["3% notes missed, 3% false notes", { drop: 0.03, fake: 0.03 }], ["8% missed, 8% false (phone-style audio)", { drop: 0.08, fake: 0.08 }], ["bars 3x longer (pedal-extended, no key-hold fix)", { stretch: 3 }], ["jitter 30 ms + 5% missed/false + 2x bars", { jitter: 0.03, drop: 0.05, fake: 0.05, stretch: 2 }]]) { const [m, c] = score(o); console.log(label.padEnd(54), "model %s%%   C4 split %s%%", m.toFixed(1), c.toFixed(1)); }
