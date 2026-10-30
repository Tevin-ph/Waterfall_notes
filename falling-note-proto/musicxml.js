// Turns the song's notes into written music (MusicXML) so the "View sheet music" page can draw them. It is an approximation, and says so on the page:
//  * time is cut into sixteenths of a bar's beat using the song's tempo and first beat (set them in Settings: Auto or Tap), so a steady performance
//    reads cleanly and a loose one reads messy;
//  * each hand is one voice (right = treble staff, left = bass staff): notes that start together are a chord, and a chord lasts until the next
//    chord in that hand (or its own held length, whichever is shorter), then a rest, so notes held under moving ones are shown short;
//  * the key signature is guessed from the notes (Krumhansl-Schmuckler profiles) and notes are spelled with sharps or flats to match it.
const STEP_NAMES = ["C", "D", "E", "F", "G", "A", "B"];
const KEY_ALTER = (fifths) => {                                        // alteration the key signature gives each step
  const sharps = ["F", "C", "G", "D", "A", "E", "B"], flats = ["B", "E", "A", "D", "G", "C", "F"], a = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  if (fifths > 0) for (let i = 0; i < fifths; i++) a[sharps[i]] = 1; else for (let i = 0; i < -fifths; i++) a[flats[i]] = -1;
  return a;
};
const SHARP_SPELL = [["C", 0], ["C", 1], ["D", 0], ["D", 1], ["E", 0], ["F", 0], ["F", 1], ["G", 0], ["G", 1], ["A", 0], ["A", 1], ["B", 0]];
const FLAT_SPELL = [["C", 0], ["D", -1], ["D", 0], ["E", -1], ["E", 0], ["F", 0], ["G", -1], ["G", 0], ["A", -1], ["A", 0], ["B", -1], ["B", 0]];
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88], MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const MAJOR_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];        // major key with tonic pitch class 0..11 -> sharps (+) or flats (-)

export function guessKey(notes) {
  const h = new Array(12).fill(0); for (const n of notes) h[n.m % 12] += Math.min(2, Math.max(0.1, n.kd != null ? n.kd : n.d));
  let best = null;
  for (let tonic = 0; tonic < 12; tonic++) for (const [prof, minor] of [[MAJOR, false], [MINOR, true]]) {
    const mean = h.reduce((a, b) => a + b, 0) / 12, pm = prof.reduce((a, b) => a + b, 0) / 12; let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < 12; i++) { const x = h[(tonic + i) % 12] - mean, y = prof[i] - pm; num += x * y; dx += x * x; dy += y * y; }
    const r = num / Math.sqrt(dx * dy + 1e-9);
    if (!best || r > best.r) best = { r, tonic, minor };
  }
  const relMajor = best.minor ? (best.tonic + 3) % 12 : best.tonic;
  return { fifths: MAJOR_FIFTHS[relMajor], minor: best.minor, tonic: best.tonic };
}

const NOTE_TYPES = { 16: ["whole", 0], 12: ["half", 1], 8: ["half", 0], 6: ["quarter", 1], 4: ["quarter", 0], 3: ["eighth", 1], 2: ["eighth", 0], 1: ["16th", 0] };
const PIECES = [16, 12, 8, 6, 4, 3, 2, 1];
const splitLength = len => { const out = []; while (len > 0) { const p = PIECES.find(x => x <= len); out.push(p); len -= p; } return out; };   // 5 -> 4+1, 7 -> 6+1 ...

// notes: [{m,t,d,kd?,h}]. opts: {bpm, off, beats, title}. Returns {measures: [{staff1: [...], staff2: [...]}], key, header(opts), xml(from, to)}.
export function buildScore(notes, opts = {}) {
  const bpm = opts.bpm || 100, beatSec = 60 / bpm, beats = opts.beats || 4, bar = beats * 4;       // a bar in sixteenths
  const usable = notes.filter(n => n.m >= 21 && n.m <= 108);
  if (!usable.length) return null;
  const first = Math.min(...usable.map(n => n.t)), off = opts.off != null ? opts.off : first;
  const barSec = beats * beatSec, origin = off - Math.ceil(Math.max(0, off - first) / barSec) * barSec;
  const key = guessKey(usable), spell = key.fifths >= 0 ? SHARP_SPELL : FLAT_SPELL, keyAlter = KEY_ALTER(key.fifths);
  const unit = beatSec / 4;
  // quantised events per staff: {start, len, midis[]}
  const staffs = [[], []];
  for (const n of usable) {
    const held = Math.max(0.05, n.kd != null ? n.kd : n.d), s = Math.max(0, Math.round((n.t - origin) / unit)), len = Math.max(1, Math.round(held / unit));
    staffs[n.h === 1 ? 1 : 0].push({ s, len, m: n.m });
  }
  const perStaff = staffs.map(list => {
    list.sort((a, b) => a.s - b.s || a.m - b.m);
    const chords = [];
    for (const x of list) { const c = chords[chords.length - 1]; if (c && c.s === x.s) { if (!c.ms.includes(x.m)) c.ms.push(x.m); c.len = Math.max(c.len, x.len); } else chords.push({ s: x.s, len: x.len, ms: [x.m] }); }
    for (let i = 0; i < chords.length; i++) { const next = chords[i + 1]; if (next) chords[i].len = Math.min(chords[i].len, next.s - chords[i].s); }
    return chords;
  });
  const total = Math.max(1, ...perStaff.map(c => (c.length ? c[c.length - 1].s + c[c.length - 1].len : 0)));
  const nBars = Math.ceil(total / bar);
  // lay each staff into bars: rests fill gaps, anything crossing a bar line is split and tied
  const measures = Array.from({ length: nBars }, () => [[], []]);
  perStaff.forEach((chords, si) => {
    let pos = 0;
    const put = (from, len, ms) => {          // one event, cut at bar lines
      while (len > 0) {
        const b = Math.floor(from / bar), room = (b + 1) * bar - from, take = Math.min(len, room);
        const parts = splitLength(take);
        parts.forEach((p, k) => measures[b][si].push({ len: p, ms, tieStart: ms && (k < parts.length - 1 || take < len), tieStop: ms && (k > 0 || from !== chordStart) }));
        from += take; len -= take;
      }
    };
    let chordStart = 0;
    for (const c of chords) {
      if (c.s > pos) { chordStart = pos; put(pos, c.s - pos, null); }
      chordStart = c.s; put(c.s, c.len, c.ms); pos = c.s + c.len;
    }
    if (pos < nBars * bar) { chordStart = pos; put(pos, nBars * bar - pos, null); }
  });
  const alterOf = m => { const [step, alter] = spell[m % 12]; return { step, alter, oct: Math.floor(m / 12) - 1 }; };
  function measureXml(i, withAttrs) {
    let x = `<measure number="${i + 1}">`;
    if (withAttrs) x += `<attributes><divisions>4</divisions><key><fifths>${key.fifths}</fifths></key><time><beats>${beats}</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>`;
    if (i === 0) x += `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(bpm)}</per-minute></metronome></direction-type><sound tempo="${Math.round(bpm)}"/></direction>`;
    for (let si = 0; si < 2; si++) {
      const staff = si + 1, acc = {};            // accidentals already shown in this bar for a step+octave
      const evs = measures[i][si], empty = evs.every(e => !e.ms);
      if (empty) { x += `<note><rest measure="yes"/><duration>${bar}</duration><voice>${staff}</voice><staff>${staff}</staff></note>`; }
      else for (const e of evs) {
        const [type, dots] = NOTE_TYPES[e.len];
        if (!e.ms) { x += `<note><rest/><duration>${e.len}</duration><voice>${staff}</voice><type>${type}</type>${dots ? "<dot/>" : ""}<staff>${staff}</staff></note>`; continue; }
        e.ms.slice().sort((a, b) => a - b).forEach((m, k) => {
          const p = alterOf(m), id = p.step + p.oct, now = id in acc ? acc[id] : keyAlter[p.step];
          let accidental = ""; if (p.alter !== now) accidental = p.alter === 1 ? "sharp" : p.alter === -1 ? "flat" : "natural"; acc[id] = p.alter;
          x += `<note>${k ? "<chord/>" : ""}<pitch><step>${p.step}</step>${p.alter ? `<alter>${p.alter}</alter>` : ""}<octave>${p.oct}</octave></pitch><duration>${e.len}</duration>` +
            `${e.tieStop ? '<tie type="stop"/>' : ""}${e.tieStart ? '<tie type="start"/>' : ""}<voice>${staff}</voice><type>${type}</type>${dots ? "<dot/>" : ""}${accidental ? `<accidental>${accidental}</accidental>` : ""}<staff>${staff}</staff>` +
            `${e.tieStop || e.tieStart ? `<notations>${e.tieStop ? '<tied type="stop"/>' : ""}${e.tieStart ? '<tied type="start"/>' : ""}</notations>` : ""}</note>`;
        });
      }
      if (si === 0) x += `<backup><duration>${bar}</duration></backup>`;
    }
    return x + "</measure>";
  }
  const esc = s => String(s).replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]);
  return {
    measures: nBars, key, beats, origin,
    // MusicXML for bars [from, to): the first bar of the range carries the clef/key/time again so any page stands on its own
    xml(from = 0, to = nBars) {
      let x = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><work><work-title>${esc(opts.title || "Song")}</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">`;
      for (let i = from; i < Math.min(to, nBars); i++) x += measureXml(i, i === from);
      return x + "</part></score-partwise>";
    },
  };
}
