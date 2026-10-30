// Scores left/right hand assignment against the true hands in piano scores (ASAP MusicXML converted by asap_to_json.py: staff 1 = right,
// staff 2 = left; a proxy for who plays what, since a few passages cross staves).  node eval/eval_hands.mjs <folder of .json> [tune]
import fs from "node:fs"; import path from "node:path";
import { assignHands, DEFAULTS } from "../hands.js";
const dir = process.argv[2] || "_test/asap_json", tune = process.argv.includes("tune");
const files = fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort();
const songs = files.map(f => ({ f, notes: JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) }));
const acc = (notes, pred) => notes.reduce((a, n, i) => a + (pred[i] === n.h ? 1 : 0), 0) / notes.length;
const c4 = s => acc(s.notes, s.notes.map(n => (n.m < 60 ? 1 : 0)));
function model(s, opts) { const copy = s.notes.map(n => ({ ...n, h: undefined })); assignHands(copy, opts); return acc(s.notes, copy.map(n => n.h)); }
const weighted = (list, fn) => { let ok = 0, tot = 0; for (const s of list) { ok += fn(s) * s.notes.length; tot += s.notes.length; } return ok / tot; };
// the best a single fixed split pitch could do, chosen per song (an upper bound for any "left of X is left" rule)
const bestSplit = s => { let best = 0; for (let p = 40; p <= 80; p++) best = Math.max(best, acc(s.notes, s.notes.map(n => (n.m < p ? 1 : 0)))); return best; };
let seed = 42; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const train = songs.filter((_, i) => i % 2 === 0), test = songs.filter((_, i) => i % 2 === 1);
let opts = { ...DEFAULTS };
if (tune) {
  const space = process.argv.includes('local') ? { wLoc: [0.5, 1, 2, 4, 8], locT: [1.5, 3, 5, 8], locQ: [0.35, 0.45, 0.5, 0.55, 0.65], wPrior: [0.2, 0.5, 1.5] } : { spanOk: [7, 8, 9, 10, 11], wSpan: [0.4, 0.8, 1.2, 2], wCount: [2, 6, 12], move: [20, 36, 60], free: [4, 7, 10], wMove: [0.2, 0.5, 1, 2], wPrior: [0.2, 0.5, 0.8, 1.5, 2.5], wCross: [0, 0.6, 1.5], priorLo: [50, 54, 56, 58, 60], priorHi: [62, 64, 66, 70, 72], wReg: [0, 0.1, 0.25, 0.5, 1], regW: [6, 10, 14], tau: [1.5, 3, 6] };
  let best = weighted(train, s => model(s, opts));
  for (let it = 0; it < 160; it++) {
    const k = Object.keys(space)[Math.floor(rnd() * Object.keys(space).length)], v = space[k][Math.floor(rnd() * space[k].length)];
    const trial = { ...opts, [k]: v }, sc = weighted(train, s => model(s, trial));
    if (sc > best + 1e-4) { best = sc; opts = trial; console.log("  tuned on train: %s -> %s=%s", (100 * sc).toFixed(2) + "%", k, v); }
  }
  console.log("chosen parameters:", JSON.stringify(opts));
}
console.log("piece".padEnd(48), "notes", "C4 split", "best fixed split", "two-hand model");
for (const s of songs) console.log(s.f.replace(".json", "").slice(0, 47).padEnd(48), String(s.notes.length).padStart(5), (100 * c4(s)).toFixed(1).padStart(7) + "%", (100 * bestSplit(s)).toFixed(1).padStart(14) + "%", (100 * model(s, opts)).toFixed(1).padStart(13) + "%");
for (const [label, list] of [["all pieces", songs], ["train half", train], ["TEST half (not used for tuning)", test]]) console.log(label.padEnd(36), "C4 %s%%   best fixed split %s%%   model %s%%", (100 * weighted(list, c4)).toFixed(1), (100 * weighted(list, bestSplit)).toFixed(1), (100 * weighted(list, s => model(s, opts))).toFixed(1));
