// Works out which hand plays each note (h: 0 = right, 1 = left) from the notes alone. The old rule was "below middle C is left", which is wrong
// whenever the left hand plays above C4 or the right below it. This models what a pair of hands can physically do:
//  * notes that start together form a group; within a group the left hand takes the lower notes and the right the higher ones, so the only
//    decision per group is WHERE to split it (a beam search keeps the best few histories, and picks the cheapest over the whole piece);
//  * a hand can't stretch much more than an octave and can't hold more than five keys (counting keys it is still holding from earlier);
//  * a hand moves at a limited speed, so jumping far away quickly is costly, and the hands rarely cross;
//  * a weak prior keeps low notes in the left hand and high notes in the right (breaks ties and covers the start of a piece).
// Parameters were tuned on part of the ASAP piano scores and scored on the rest (see eval/eval_hands.mjs); they are a model of piano playing,
// not a measurement of any one player.
export const DEFAULTS = { spanOk: 7, wSpan: 2, wCount: 6, move: 20, free: 4, wMove: 0.2, wPrior: 1.5, wCross: 0.6, beam: 40, group: 0.05 };

export function assignHands(notes, opts = {}) {
  const P = { ...DEFAULTS, ...opts };
  if (!notes.length) return notes;
  const order = notes.map((n, i) => i).sort((a, b) => notes[a].t - notes[b].t || notes[a].m - notes[b].m);
  // groups of notes starting together, each sorted low to high
  const groups = [];
  for (const i of order) {
    const g = groups[groups.length - 1];
    if (g && notes[i].t - g.t <= P.group) g.idx.push(i); else groups.push({ t: notes[i].t, idx: [i] });
  }
  for (const g of groups) g.idx.sort((a, b) => notes[a].m - notes[b].m);
  const hold = n => n.t + Math.max(0.05, n.kd != null ? n.kd : n.d);          // when the key comes up: the held length when known
  let beam = [{ cost: 0, pos: [null, null], at: [-9, -9], held: [], prev: null, s: 0 }];
  const nextBeam = [];
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi], n = g.idx.length, t = g.t;
    nextBeam.length = 0;
    for (const st of beam) {
      const held = st.held.filter(h => h.end > t + 0.03);                        // keys that hand is still holding down
      for (let s = 0; s <= n; s++) {                                             // lower s notes to the left hand, the rest to the right
        let cost = st.cost; const pos = st.pos.slice(), at = st.at.slice();
        for (const H of [1, 0]) {
          const mine = H === 1 ? g.idx.slice(0, s) : g.idx.slice(s);
          if (!mine.length) continue;
          const ps = mine.map(i => notes[i].m), heldH = held.filter(h => h.hand === H).map(h => h.m), all = ps.concat(heldH);
          const span = Math.max(...all) - Math.min(...all);
          cost += P.wSpan * Math.max(0, span - P.spanOk) ** 2;
          cost += P.wCount * Math.max(0, new Set(all).size - 5);
          const center = ps.reduce((a, b) => a + b, 0) / ps.length;
          if (pos[H] != null) cost += P.wMove * Math.max(0, Math.abs(center - pos[H]) - (P.free + P.move * Math.max(0, t - at[H])));
          for (const m of ps) cost += P.wPrior * (H === 0 ? Math.max(0, 56 - m) : Math.max(0, m - 66)) / 12;
          const other = pos[1 - H];                                              // the hands rarely cross
          if (other != null && t - at[1 - H] < 0.6) cost += P.wCross * Math.max(0, H === 0 ? other - center : center - other) / 4;
          pos[H] = center; at[H] = t;
        }
        const nh = held.slice();
        for (let k = 0; k < n; k++) nh.push({ m: notes[g.idx[k]].m, end: hold(notes[g.idx[k]]), hand: k < s ? 1 : 0 });
        nextBeam.push({ cost, pos, at, held: nh, prev: st, s });
      }
    }
    nextBeam.sort((a, b) => a.cost - b.cost);
    // states that look the same to the future (same positions rounded, same held keys) keep only their cheapest
    const seen = new Set(), keep = [];
    for (const st of nextBeam) {
      const key = st.pos.map(p => (p == null ? "-" : Math.round(p / 2))).join(",") + "|" + st.held.map(h => h.hand + ":" + h.m + ":" + Math.round(h.end * 4)).join(",");
      if (seen.has(key)) continue; seen.add(key); keep.push(st); if (keep.length >= P.beam) break;
    }
    beam = keep;
  }
  // walk back from the cheapest final state
  let st = beam[0]; const splits = new Array(groups.length);
  for (let gi = groups.length - 1; gi >= 0; gi--) { splits[gi] = st.s; st = st.prev; }
  groups.forEach((g, gi) => g.idx.forEach((i, k) => { notes[i].h = k < splits[gi] ? 1 : 0; }));
  return notes;
}
