// Finds the tempo (BPM) and where the beats fall, from the note start times alone (works for any song already turned into notes).
// Idea: lay a regular beat grid over the notes and keep the tempo and phase where the most (and loudest) note starts sit on a beat
// or on its half or quarter. A mild preference for tempos around 80 BPM (spread of 0.6 octave) settles half/double-tempo ties; these values were tuned on made-up songs and checked on a separate set (83% exact versus 61% before). A guess from the notes, so it can be wrong
// on rubato or very sparse music. `fit` (0 = no better than random note timing, 1 = every note on the grid) is the honest reliability number: steady made-up songs
// scored 0.27-0.49, random timing 0.11-0.18, and real expressive piano (three MAESTRO pieces) lower than that, so callers should ignore results below about 0.2.
export function estimateTempo(notes, opts = {}) {
  const lo = opts.min || 50, hi = opts.max || 180, sigma = opts.sigma || 0.035;
  const center = opts.center || 80, psig = opts.psig || 0.6, halfW = opts.halfW || 0.75, qW = opts.qW || 0.2, pw = opts.pw == null ? 0.4 : opts.pw;
  // chords count once: starts within 30 ms are one onset, weighted by loudness
  const sorted = notes.map(n => ({ t: n.t, w: 0.4 + (n.v == null ? 0.6 : n.v) })).sort((a, b) => a.t - b.t);
  const ons = [];
  for (const n of sorted) {
    const last = ons[ons.length - 1];
    if (last && n.t - last.t < 0.03) last.w = Math.min(2, last.w + 0.3 * n.w); else ons.push({ t: n.t, w: n.w });
  }
  if (ons.length < 8) return null;
  // very long songs: the first 3 minutes are plenty and keep this fast
  const end = ons[0].t + 180, use = ons.filter(o => o.t <= end);
  const T = new Float64Array(use.length), W = new Float64Array(use.length);
  use.forEach((o, i) => { T[i] = o.t; W[i] = o.w; });
  const inv2s2 = 1 / (2 * sigma * sigma);
  let wsum = 0; for (let i = 0; i < W.length; i++) wsum += W[i];
  // how much of a beat the grid 'covers': random timing scores about this share of the total weight, and a fast grid covers more, so it
  // would win by chance on dense playing unless the score is measured against it
  const coverage = period => { let c = 0; const n = 200; for (let k = 0; k < n; k++) { const x = k / n, dB = Math.min(x, 1 - x) * period, dH = Math.abs(x - 0.5) * period, dQ = Math.min(Math.abs(x - 0.25), Math.abs(x - 0.75)) * period; c += Math.max(Math.exp(-dB * dB * inv2s2), halfW * Math.exp(-dH * dH * inv2s2), qW * Math.exp(-dQ * dQ * inv2s2)); } return c / n; };
  let best = null, sum = 0, sum2 = 0, cnt = 0;
  for (let bpm = lo; bpm <= hi; bpm += 0.25) {
    const period = 60 / bpm, steps = 36, prior = Math.exp(-Math.pow(Math.log2(bpm / center), 2) / (2 * psig * psig));
    let bestPhase = 0, bestScore = -1;
    for (let k = 0; k < steps; k++) {
      const phase = period * k / steps; let s = 0;
      for (let i = 0; i < T.length; i++) {
        const x = ((T[i] - phase) % period + period) % period / period;       // 0..1 position inside the beat
        const dBeat = Math.min(x, 1 - x) * period, dHalf = Math.abs(x - 0.5) * period, dQ = Math.min(Math.abs(x - 0.25), Math.abs(x - 0.75)) * period;
        s += W[i] * Math.max(Math.exp(-dBeat * dBeat * inv2s2), halfW * Math.exp(-dHalf * dHalf * inv2s2), qW * Math.exp(-dQ * dQ * inv2s2));
      }
      if (s > bestScore) { bestScore = s; bestPhase = phase; }
    }
    const chance = wsum * coverage(period), fit = Math.max(0, (bestScore - chance) / (wsum - chance + 1e-9));       // 0 = no better than random, 1 = every note on the grid
    const score = fit * ((1 - pw) + pw * prior);
    sum += score; sum2 += score * score; cnt++;
    if (!best || score > best.score) best = { bpm, phase: bestPhase, score, fit };
  }
  const mean = sum / cnt, sd = Math.sqrt(Math.max(1e-9, sum2 / cnt - mean * mean));
  // beat 0 is the first grid point at or after the first note (so the metronome starts with the music)
  const period = 60 / best.bpm; let off = best.phase; while (off - period >= ons[0].t - 0.02) off -= period; while (off < ons[0].t - period + 0.02) off += period;
  return { bpm: Math.round(best.bpm * 10) / 10, off: Math.max(0, Math.round(off * 1000) / 1000), confidence: (best.score - mean) / sd, fit: Math.round(best.fit * 100) / 100, onsets: use.length };
}
