// Reel export (9:16): animated themed backgrounds, drawn here with canvas 2D from plain shapes (no pictures or sounds from anywhere),
// plus the title and the foreground effects. The 3D scene puts `bg` behind the falling notes and `fg` over them (scene3d.js setReel).
// Every theme listens to the music: bass notes heave the sea and call the thunder, busy playing speeds up the stars, and each note
// that starts throws sparks from its own key (f.keyX / f.hitY say where that key is on the screen).
//
// Themes draw in a fixed 720 x 1280 space; the canvases are scaled to it. A theme is make() -> { update?(f), bg(ctx, f), fg(ctx, f) }.
// f = { t, dt, clock, prog, low, mid, high, hit, boom, density, pitch, events: [{ m, v, h }], keyX(midi) -> 0..1, hitY -> 0..1 }

const LW = 720, LH = 1280, TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mixc = (a, b, k) => `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], k))).join(",")})`;
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const mk = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };

// ---------- what the music is doing right now ----------
export class Energy {
  constructor(notes, from = 0, to = 1) { this.notes = notes; this.from = from; this.to = Math.max(to, from + 1); this.reset(from); }
  first(t) { let lo = 0, hi = this.notes.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (this.notes[mid].t < t - 1e-6) lo = mid + 1; else hi = mid; } return lo; }
  reset(p) { this.i = this.first(p - 0.02); this.p = p; this.clock = 0; this.low = this.mid = this.high = this.hit = this.boom = this.dens = 0; this.pitch = 0.5; }
  // p: song time, dt: seconds since the last call, tr: transpose, proj: { keyX, hitY } from the scene
  step(p, dt, tr, proj) {
    dt = clamp(dt, 0, 0.1);
    if (p < this.p - 0.05 || p > this.p + 1.5) this.i = this.first(p);                    // jumped: skip what lies between
    this.p = p; this.clock += dt;
    const ev = [], notes = this.notes;
    while (this.i < notes.length && notes[this.i].t <= p) { const n = notes[this.i++]; if (ev.length < 14) ev.push({ m: n.m + tr, v: n.v > 1 ? n.v / 127 : (n.v ?? 0.7), h: n.h || 0 }); }
    const k = tau => Math.exp(-dt / tau);
    this.low *= k(0.5); this.mid *= k(0.35); this.high *= k(0.22); this.hit *= k(0.18); this.boom *= k(0.45); this.dens *= k(1.2);
    for (const e of ev) {
      const b = e.m < 50 ? "low" : e.m < 72 ? "mid" : "high";
      this[b] = Math.min(1, this[b] + 0.35 + 0.5 * e.v); this.hit = Math.min(1, this.hit + 0.2 + 0.3 * e.v); this.dens += 1;
      if (e.m < 55 && e.v > 0.5) this.boom = Math.min(1, this.boom + e.v);
      this.pitch = lerp(this.pitch, clamp((e.m - 24) / 72), 0.15);
    }
    return { t: p, dt, clock: this.clock, prog: clamp((p - this.from) / (this.to - this.from)), low: this.low, mid: this.mid, high: this.high, hit: this.hit, boom: this.boom,
             density: clamp(this.dens / 6), pitch: this.pitch, events: ev, keyX: proj.keyX, hitY: proj.hitY };
  }
}
// Where keys land across the width when there is no 3D scene to ask (the preview in the dialog): the octaves lo..hi spread over the picture.
export function previewProj(lo, hi) {
  const IDX = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6], BLK = [1, 3, 6, 8, 10];
  const pos = m => Math.floor(m / 12) * 7 + IDX[m % 12] + (BLK.includes(m % 12) ? 0.5 : 0);
  const a = pos(lo), b = pos(hi) + 1;
  return { keyX: m => clamp((pos(clamp(m, 21, 108)) - a + 0.5) / (b - a), 0.02, 0.98), hitY: 0.74 };
}

// ---------- drawing helpers ----------
const sprites = new Map();
function sprite(c) {                              // a soft round dot of one colour; drawn with 'lighter' for sparks and lights
  const key = c.join(); let s = sprites.get(key); if (s) return s;
  s = mk(64, 64); const g = s.getContext("2d"), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, rgba(c.map(v => lerp(v, 255, 0.55)), 1)); r.addColorStop(0.3, rgba(c, 0.55)); r.addColorStop(1, rgba(c, 0));
  g.fillStyle = r; g.fillRect(0, 0, 64, 64); sprites.set(key, s); return s;
}
function glow(ctx, x, y, r, c, a) { const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, rgba(c, a)); g.addColorStop(1, rgba(c, 0)); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
function vignette(ctx, c, a) { const g = ctx.createRadialGradient(LW / 2, LH / 2, 330, LW / 2, LH / 2, 860); g.addColorStop(0, rgba(c, 0)); g.addColorStop(1, rgba(c, a)); ctx.fillStyle = g; ctx.fillRect(0, 0, LW, LH); }
function ridge(seed, sharp = 0) {                 // a skyline: x -> 0..1 height
  const R = rng(seed), f = [0, 1, 2].map(i => (0.004 + R() * 0.006) * (1 + i * 1.9)), p = f.map(() => R() * TAU), w = [0.55, 0.3, 0.15];
  return x => { let s = 0; for (let i = 0; i < 3; i++) { const v = Math.sin(x * f[i] + p[i]); s += w[i] * (sharp ? 1 - 2 * Math.abs(v) : v); } return clamp(0.5 + 0.5 * s); };
}
function fillRidge(ctx, fn, base, amp, style) {
  ctx.beginPath(); ctx.moveTo(0, LH); for (let x = 0; x <= LW; x += 10) ctx.lineTo(x, base - amp * fn(x)); ctx.lineTo(LW, LH); ctx.closePath(); ctx.fillStyle = style; ctx.fill();
}
function bezier(p0, p1, p2, p3, u) { const v = 1 - u; return [v * v * v * p0[0] + 3 * v * v * u * p1[0] + 3 * v * u * u * p2[0] + u * u * u * p3[0], v * v * v * p0[1] + 3 * v * v * u * p1[1] + 3 * v * u * u * p2[1] + u * u * u * p3[1]]; }

// particles: { x, y, vx, vy, life, size, col, g (gravity), drag, kind: dot | cross | ring | petal, add: false for normal blending, a }
class Parts {
  constructor(max) { this.a = []; this.max = max; }
  add(p) { if (this.a.length >= this.max) this.a.shift(); p.max = p.life; this.a.push(p); }
  step(dt) {
    for (let i = this.a.length - 1; i >= 0; i--) {
      const p = this.a[i]; p.life -= dt; if (p.life <= 0) { this.a.splice(i, 1); continue; }
      p.vy += (p.g || 0) * dt; const d = Math.exp(-(p.drag || 0) * dt); p.vx *= d; p.vy *= d; p.x += p.vx * dt; p.y += p.vy * dt; if (p.vr) p.rot += p.vr * dt;
    }
  }
  draw(ctx) {
    for (const p of this.a) {
      const k = p.life / p.max; ctx.globalAlpha = clamp(k * 1.6) * (p.a ?? 1); ctx.globalCompositeOperation = p.add === false ? "source-over" : "lighter";
      if (p.kind === "ring") { ctx.strokeStyle = rgba(p.col, 1); ctx.lineWidth = 2 + 3 * k; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 + (1 - k) * 5), 0, TAU); ctx.stroke(); continue; }
      if (p.kind === "petal") { petal(ctx, p); continue; }
      const s = p.size * (p.shrink === false ? 1 : 0.4 + 0.6 * k);
      ctx.drawImage(sprite(p.col), p.x - s, p.y - s, s * 2, s * 2);
      if (p.kind === "cross") { ctx.fillStyle = rgba(p.col.map(v => lerp(v, 255, 0.6)), 0.9); ctx.fillRect(p.x - s * 1.6, p.y - 0.8, s * 3.2, 1.6); ctx.fillRect(p.x - 0.8, p.y - s * 1.6, 1.6, s * 3.2); }
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  }
}
function petal(ctx, p) {
  ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, 0.5 + 0.5 * Math.abs(Math.cos(p.rot * 1.7 + p.ph))); const s = p.size;
  ctx.beginPath(); ctx.moveTo(0, -s); ctx.bezierCurveTo(s * 0.95, -s * 0.8, s * 0.9, s * 0.6, 0, s); ctx.bezierCurveTo(-s * 0.9, s * 0.6, -s * 0.95, -s * 0.8, 0, -s);
  ctx.fillStyle = rgba(p.col, 0.92); ctx.fill(); ctx.fillStyle = "rgba(255,255,255,.28)"; ctx.beginPath(); ctx.ellipse(0, -s * 0.2, s * 0.35, s * 0.55, 0, 0, TAU); ctx.fill(); ctx.restore();
}
// sparks thrown from the key of every note that starts
function keySparks(P, f, col, n = 3, o = {}) {
  for (const e of f.events) for (let i = 0; i < n; i++) P.add({
    x: f.keyX(e.m) * LW + (Math.random() - 0.5) * 12, y: f.hitY * LH - 8, vx: (Math.random() - 0.5) * 140, vy: -(140 + Math.random() * 280) * (0.55 + e.v), g: o.g ?? 420, drag: 0.5,
    life: 0.5 + Math.random() * 0.7, size: (o.size ?? 7) * (0.6 + Math.random() * 0.8), col: col(e), kind: o.kind });
}

// ---------- themes ----------
function pirate() {
  const R = rng(7), HOR = 790, MX = 548, MY = 440;
  const stars = Array.from({ length: 70 }, () => ({ x: R() * LW, y: R() * 600, r: 0.6 + R() * 1.3, ph: R() * TAU }));
  const clouds = Array.from({ length: 9 }, () => ({ x: R() * LW * 1.4 - 150, y: 300 + R() * 360, w: 240 + R() * 240, s: 7 + R() * 13, a: 0.4 + R() * 0.3 }));
  const waves = Array.from({ length: 6 }, (_, j) => ({ ph: R() * 200, y: HOR + 10 + j * 76, amp: 5 + j * 6, len: 150 + j * 55, sp: 18 + j * 15 }));
  const drops = Array.from({ length: 130 }, () => ({ x: R() * (LW + 220), y: R() * LH, v: 900 + R() * 600, l: 22 + R() * 26 }));
  const mist = Array.from({ length: 5 }, () => ({ x: R() * LW, y: HOR - 20 + R() * 430, w: 300 + R() * 260, s: 8 + R() * 14 }));
  const P = new Parts(220), st = { clock: 0, flash: 0, again: 0, bolt: null, life: 0, last: -9, next: 5, kick: 0, ph: 0 };
  const makeBolt = () => {
    let x = 120 + Math.random() * 480, y = -10; const main = [[x, y]], branches = [];
    while (y < HOR) {
      y += 40 + Math.random() * 50; x += (Math.random() - 0.5) * 90; main.push([x, y]);
      if (Math.random() < 0.3) { const b = [[x, y]], dir = Math.random() < 0.5 ? -1 : 1; let bx = x, by = y; for (let i = 0; i < 4; i++) { bx += dir * (15 + Math.random() * 35); by += 25 + Math.random() * 30; b.push([bx, by]); } branches.push(b); }
    }
    return [main, ...branches];
  };
  const sail = (ctx, cx, top, h, w, bil) => {                // a tattered square sail, bellied by the wind
    ctx.beginPath(); ctx.moveTo(cx - w, top); ctx.lineTo(cx + w, top); ctx.quadraticCurveTo(cx + w + bil, top + h * 0.5, cx + w * 0.9, top + h);
    for (let k = 1; k <= 7; k++) ctx.lineTo(cx + w * 0.9 - (k / 7) * w * 1.8, top + h + (k % 2 ? 11 : -3) + Math.sin(k * 2.7 + cx) * 4);
    ctx.quadraticCurveTo(cx - w - bil, top + h * 0.5, cx - w, top); ctx.fill(); ctx.stroke();
  };
  const ship = (ctx, x, y, rot, fl, f) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(1.25, 1.25);
    ctx.fillStyle = "#04080c"; ctx.strokeStyle = rgba([170, 215, 225], 0.1 + fl * 0.5); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-130, -40); ctx.lineTo(-112, -50); ctx.lineTo(-100, -34); ctx.lineTo(60, -34); ctx.lineTo(140, -52); ctx.lineTo(190, -68); ctx.lineTo(150, -34);
    ctx.quadraticCurveTo(120, 14, 40, 14); ctx.lineTo(-70, 14); ctx.quadraticCurveTo(-118, 10, -130, -40); ctx.fill(); ctx.stroke();
    for (const [mx, top] of [[-72, -150], [0, -210], [80, -170]]) ctx.fillRect(mx - 2.5, top, 5, -top - 30);
    const bil = 8 + 5 * Math.sin(f.clock * 1.4) + f.low * 10;
    sail(ctx, 0, -205, 68, 46, bil); sail(ctx, 0, -132, 80, 60, bil); sail(ctx, 80, -165, 58, 38, bil); sail(ctx, 80, -102, 58, 46, bil); sail(ctx, -72, -146, 55, 33, bil);
    ctx.beginPath(); ctx.moveTo(88, -152); ctx.lineTo(184, -68); ctx.lineTo(96, -46); ctx.quadraticCurveTo(110, -100, 88, -152); ctx.fill(); ctx.stroke();
    ctx.beginPath(); const fl2 = Math.sin(f.clock * 7) * 4; ctx.moveTo(0, -212); ctx.lineTo(30, -204 + fl2); ctx.lineTo(18, -199); ctx.lineTo(40, -194 + fl2); ctx.lineTo(0, -188); ctx.fill();   // a tattered flag
    ctx.globalCompositeOperation = "lighter"; glow(ctx, -108, -36, 46, [90, 255, 220], 0.3 + f.hit * 0.5 + Math.sin(f.clock * 9) * 0.05);                                                   // ghost lantern
    ctx.restore();
  };
  return {
    update(f) {
      const dt = f.dt; st.clock += dt; st.flash *= Math.exp(-dt / 0.11); st.kick *= Math.exp(-dt / 0.4); st.life -= dt; st.ph += dt * (0.9 + f.density * 0.6);
      if (st.again && st.clock > st.again) { st.flash = 0.75; st.again = 0; }
      if ((f.boom > 0.5 && st.clock - st.last > 1.6) || st.clock > st.next) {       // loud low notes call the thunder; in quiet parts one comes now and then
        st.last = st.clock; st.next = st.clock + 7 + Math.random() * 7; st.flash = 1; st.again = st.clock + 0.14; st.life = 0.3; st.bolt = makeBolt(); st.kick = 1;
      }
      for (const w of waves) w.ph += dt * w.sp * (1 + f.density * 1.2);
    },
    bg(ctx, f) {
      const fl = st.flash, t = f.clock;
      let g = ctx.createLinearGradient(0, 0, 0, HOR); g.addColorStop(0, mixc([5, 12, 22], [120, 150, 190], fl * 0.6)); g.addColorStop(0.55, mixc([16, 44, 58], [150, 180, 215], fl * 0.7)); g.addColorStop(1, mixc([58, 102, 112], [200, 225, 245], fl * 0.7));
      ctx.fillStyle = g; ctx.fillRect(0, 0, LW, LH);
      for (const s of stars) { ctx.fillStyle = rgba([220, 235, 255], (0.35 + 0.35 * Math.sin(t * 1.5 + s.ph)) * (1 - fl)); ctx.fillRect(s.x, s.y, s.r, s.r); }
      glow(ctx, MX, MY, 330, [150, 205, 215], 0.3 + fl * 0.2);
      ctx.fillStyle = "#e8f2ee"; ctx.beginPath(); ctx.arc(MX, MY, 54, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(90,120,130,.16)"; for (const [dx, dy, r] of [[-16, -12, 13], [14, 10, 17], [-6, 24, 8], [20, -22, 7]]) { ctx.beginPath(); ctx.arc(MX + dx, MY + dy, r, 0, TAU); ctx.fill(); }
      for (const c of clouds) {
        c.x += c.s * f.dt; if (c.x > LW + c.w) c.x = -c.w;
        for (let i = 0; i < 4; i++) {
          const px = c.x + (i - 1.5) * c.w * 0.3, py = c.y + Math.sin(i * 2.1 + c.w) * 16, r = c.w * (0.26 + 0.05 * Math.sin(i + c.s)), gg = ctx.createRadialGradient(px, py, 0, px, py, r);
          const lit = fl * 0.9 + 0.08; gg.addColorStop(0, rgba([lerp(14, 200, lit), lerp(26, 215, lit), lerp(36, 235, lit)], c.a)); gg.addColorStop(1, rgba([14, 26, 36], 0));
          ctx.fillStyle = gg; ctx.fillRect(px - r, py - r, r * 2, r * 2);
        }
      }
      glow(ctx, LW / 2, HOR, 420, [120, 175, 190], 0.18 + fl * 0.2);
      ship(ctx, 330 + Math.sin(st.ph * 0.25) * 30, HOR + 6 + Math.sin(st.ph * 1.3) * 5 + f.low * 6, Math.sin(st.ph * 0.9) * 0.03 + st.kick * 0.03, fl, f);
      waves.forEach((w, j) => {
        const amp = w.amp * (1 + f.low * 1.3 + st.kick * 0.8), top = [];
        ctx.beginPath(); ctx.moveTo(0, LH);
        for (let x = 0; x <= LW; x += 12) { const y = w.y + Math.sin((x + w.ph) / w.len * TAU) * amp + Math.sin((x * 1.7 - w.ph * 0.6) / w.len * TAU) * amp * 0.4; top.push([x, y]); ctx.lineTo(x, y); }
        ctx.lineTo(LW, LH); ctx.closePath(); ctx.fillStyle = mixc([lerp(18, 2, j / 5), lerp(48, 6, j / 5), lerp(60, 10, j / 5)], [120, 150, 170], fl * 0.25); ctx.fill();
        ctx.beginPath(); top.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.strokeStyle = rgba([170, 225, 235], 0.1 + f.hit * 0.15 + fl * 0.4); ctx.lineWidth = 1.5; ctx.stroke();
        ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = rgba([210, 240, 235], 0.1 + 0.12 * Math.sin(t * 2.4 + j));       // the moon's path on the water
        for (let k = 0; k < 6; k++) { const wd = 14 + ((k * 37 + j * 11) % 40); ctx.fillRect(MX + Math.sin(k * 5.3 + j + t * 0.6) * (20 + j * 22) - wd / 2, w.y + 6 + k * 3, wd, 2); }
        ctx.globalCompositeOperation = "source-over";
      });
    },
    fg(ctx, f) {
      for (const m of mist) { m.x += m.s * f.dt; if (m.x > LW + m.w) m.x = -m.w; ctx.save(); ctx.translate(m.x, m.y); ctx.scale(1, 0.22); glow(ctx, 0, 0, m.w, [150, 190, 200], 0.1); ctx.restore(); }
      ctx.strokeStyle = rgba([200, 225, 240], 0.2 + f.density * 0.12); ctx.lineWidth = 1.4; ctx.beginPath();
      for (const d of drops) { d.y += d.v * f.dt; d.x -= d.v * 0.28 * f.dt; if (d.y > LH + 30 || d.x < -60) { d.y = -30; d.x = Math.random() * (LW + 260); } ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + d.l * 0.28, d.y - d.l); }
      ctx.stroke();
      if (st.life > 0 && st.bolt) {
        ctx.globalCompositeOperation = "lighter"; ctx.lineJoin = "round";
        for (const [w, a, c] of [[11, 0.2, "rgb(120,170,255)"], [3.5, 0.95, "rgb(235,245,255)"]]) { ctx.lineWidth = w; ctx.strokeStyle = c; ctx.globalAlpha = a * clamp(st.life / 0.2); for (const line of st.bolt) { ctx.beginPath(); line.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); } }
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
      }
      if (st.flash > 0.01) { ctx.fillStyle = rgba([190, 215, 255], st.flash * 0.26); ctx.fillRect(0, 0, LW, LH); }
      keySparks(P, f, e => e.h ? [127, 227, 255] : [255, 211, 122], 3, { g: 520 }); P.step(f.dt); P.draw(ctx);
      vignette(ctx, [0, 4, 8], 0.55);
    },
  };
}

function space() {
  const R = rng(11), P = new Parts(260), shoot = [];
  const stars = Array.from({ length: 170 }, () => ({ x: R() * LW, y: R() * LH, z: 0.2 + R() * 0.8, ph: R() * TAU }));
  const st = { warp: 0, rot: 0 }, CX = 560, CY = 560, PR = 105;
  return {
    update(f) {
      st.warp = lerp(st.warp, f.density * 0.9 + f.hit * 0.5, 1 - Math.exp(-f.dt * 3)); st.rot += f.dt * 0.05;
      for (const s of stars) { s.y += (14 + 520 * st.warp) * s.z * f.dt; if (s.y > LH + 10) { s.y = -10; s.x = R() * LW; } }
      for (const e of f.events) if (e.m >= 72 && shoot.length < 6) shoot.push({ x: LW * 0.35 + Math.random() * LW * 0.7, y: -20, life: 1 });
      for (let i = shoot.length - 1; i >= 0; i--) { const s = shoot[i]; s.life -= f.dt * 1.1; s.x -= 560 * f.dt; s.y += 800 * f.dt; if (s.life <= 0) shoot.splice(i, 1); }
    },
    bg(ctx, f) {
      const t = f.clock; let g = ctx.createLinearGradient(0, 0, 0, LH); g.addColorStop(0, "#05010f"); g.addColorStop(0.55, "#10063a"); g.addColorStop(1, "#020008"); ctx.fillStyle = g; ctx.fillRect(0, 0, LW, LH);
      ctx.globalCompositeOperation = "lighter";
      [[200, 380, 420, [130, 60, 200]], [520, 720, 440, [40, 110, 230]], [300, 1000, 460, [220, 60, 160]]].forEach(([x, y, r, c], i) => glow(ctx, x + Math.sin(t * 0.07 + i * 2) * 60, y + Math.cos(t * 0.05 + i) * 50, r, c, 0.16 + f.mid * 0.16 + f.hit * 0.04));
      for (const s of stars) {
        const w = 0.8 + 1.8 * s.z, len = st.warp * 42 * s.z; ctx.fillStyle = rgba([220, 230, 255], (0.3 + 0.7 * s.z) * (0.7 + 0.3 * Math.sin(t * 2 + s.ph)));
        ctx.fillRect(s.x, s.y - len, w, len + w);
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = "rgba(190,175,230,.35)"; ctx.lineWidth = 16;                                         // the planet: ring behind, globe, ring in front
      ctx.beginPath(); ctx.ellipse(CX, CY, PR * 1.9, PR * 0.45, -0.35, Math.PI, TAU); ctx.stroke();
      g = ctx.createRadialGradient(CX - 40, CY - 50, 10, CX, CY, PR * 1.05); g.addColorStop(0, "#a9dcff"); g.addColorStop(0.5, "#3f63c8"); g.addColorStop(1, "#0b0f3a"); ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(CX, CY, PR, 0, TAU); ctx.fill();
      ctx.save(); ctx.clip(); ctx.fillStyle = "rgba(255,255,255,.07)"; for (let i = 0; i < 9; i++) ctx.fillRect(CX - PR, CY - PR + i * PR * 0.23 + Math.sin(t * 0.2 + i) * 4, PR * 2, PR * 0.08); ctx.restore();
      ctx.strokeStyle = rgba([150, 190, 255], 0.35 + f.boom * 0.5); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(CX, CY, PR + 1, -2.6, -0.4); ctx.stroke();
      ctx.strokeStyle = "rgba(210,195,245,.5)"; ctx.lineWidth = 16; ctx.beginPath(); ctx.ellipse(CX, CY, PR * 1.9, PR * 0.45, -0.35, 0, Math.PI); ctx.stroke();
    },
    fg(ctx, f) {
      ctx.globalCompositeOperation = "lighter";
      for (const s of shoot) { const g = ctx.createLinearGradient(s.x, s.y, s.x + 140, s.y - 200); g.addColorStop(0, rgba([255, 255, 255], 0.9 * s.life)); g.addColorStop(1, rgba([160, 190, 255], 0)); ctx.strokeStyle = g; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + 140, s.y - 200); ctx.stroke(); }
      ctx.globalCompositeOperation = "source-over";
      keySparks(P, f, e => e.m > 72 ? [200, 220, 255] : e.h ? [190, 140, 255] : [120, 200, 255], 2, { g: -30, kind: "cross", size: 7 }); P.step(f.dt); P.draw(ctx);
      vignette(ctx, [2, 0, 12], 0.5);
    },
  };
}

function synth() {
  const R = rng(5), HOR = 800, P = new Parts(220), st = { grid: 0 };
  const stars = Array.from({ length: 90 }, () => ({ x: R() * LW, y: R() * 620, r: 0.7 + R() * 1.4, ph: R() * TAU }));
  const far = ridge(21, 1), near = ridge(44, 1);
  let scan = null;
  return {
    update(f) { st.grid = (st.grid + f.dt * (0.18 + f.density * 1.1 + f.hit * 0.6)) % 1; },
    bg(ctx, f) {
      const t = f.clock; const sky = ctx.createLinearGradient(0, 0, 0, HOR); sky.addColorStop(0, "#0d0221"); sky.addColorStop(0.5, "#4a0e6e"); sky.addColorStop(1, "#ff2e88");
      ctx.fillStyle = sky; ctx.fillRect(0, 0, LW, HOR + 2);
      for (const s of stars) { ctx.fillStyle = rgba([255, 255, 255], (1 - s.y / 640) * (0.5 + 0.5 * Math.sin(t * 2 + s.ph))); ctx.fillRect(s.x, s.y, s.r, s.r); }
      const cy = 640, r = 210 * (1 + f.low * 0.06 + f.hit * 0.015), sun = ctx.createLinearGradient(0, cy - r, 0, cy + r); sun.addColorStop(0, "#ffe45e"); sun.addColorStop(0.5, "#ff7a3d"); sun.addColorStop(1, "#ff2e88");
      ctx.globalCompositeOperation = "lighter"; glow(ctx, LW / 2, cy, r * 1.9, [255, 60, 150], 0.22 + f.low * 0.2); ctx.globalCompositeOperation = "source-over";
      ctx.save(); ctx.beginPath(); ctx.arc(LW / 2, cy, r, 0, TAU); ctx.clip(); ctx.fillStyle = sun; ctx.fillRect(0, 0, LW, LH);
      ctx.fillStyle = sky; for (let k = 0; k < 7; k++) { const u = (k + st.grid) / 7, y = cy - r * 0.05 + u * r * 1.1; ctx.fillRect(LW / 2 - r, y, r * 2, 2 + u * 20); }          // the cuts slide down the sun
      ctx.restore();
      fillRidge(ctx, far, HOR - 6, 130, "#1c0540"); fillRidge(ctx, near, HOR + 4, 80, "#0d0122");
      ctx.strokeStyle = rgba([0, 240, 255], 0.55); ctx.lineWidth = 2; ctx.beginPath(); for (let x = 0; x <= LW; x += 10) { const y = HOR - 6 - 130 * far(x); x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
      const fl = ctx.createLinearGradient(0, HOR, 0, LH); fl.addColorStop(0, "#1d0243"); fl.addColorStop(1, "#05000f"); ctx.fillStyle = fl; ctx.fillRect(0, HOR, LW, LH - HOR);
      ctx.globalCompositeOperation = "lighter"; ctx.strokeStyle = rgba([255, 60, 200], 0.5 + f.low * 0.4);
      for (let i = -16; i <= 16; i++) { ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(LW / 2 + i * 12, HOR); ctx.lineTo(LW / 2 + i * 105, LH); ctx.stroke(); }
      for (let k = 0; k < 16; k++) { const u = (k + st.grid) / 16, y = HOR + (LH - HOR) * Math.pow(u, 2.2); ctx.strokeStyle = rgba([0, 230, 255], 0.15 + u * 0.55); ctx.lineWidth = 1 + u * 3; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(LW, y); ctx.stroke(); }
      glow(ctx, LW / 2, HOR, 360, [255, 50, 140], 0.25); ctx.globalCompositeOperation = "source-over";
    },
    fg(ctx, f) {
      ctx.globalCompositeOperation = "lighter";
      for (const e of f.events) P.add({ x: f.keyX(e.m) * LW, y: f.hitY * LH - 6, vx: 0, vy: -60, life: 0.7, size: 16, col: e.m > 66 ? [255, 70, 200] : [0, 230, 255], kind: "ring" });
      ctx.globalCompositeOperation = "source-over";
      keySparks(P, f, e => e.m > 66 ? [255, 90, 210] : [60, 240, 255], 2, { g: 200, kind: "cross", size: 6 }); P.step(f.dt); P.draw(ctx);
      if (!scan) { const c = mk(4, 4); const g = c.getContext("2d"); g.fillStyle = "rgba(0,0,0,.09)"; g.fillRect(0, 0, 4, 2); scan = ctx.createPattern(c, "repeat"); }
      ctx.fillStyle = scan; ctx.fillRect(0, 0, LW, LH); vignette(ctx, [10, 0, 30], 0.5);
    },
  };
}

function sakura() {
  const R = rng(3), HOR = 840, P = new Parts(120), st = { wind: 0, clock: 0 };
  const PINK = [[255, 183, 208], [255, 205, 222], [250, 160, 195]];
  const petals = Array.from({ length: 60 }, () => ({ x: R() * LW, y: R() * LH, size: 7 + R() * 9, rot: R() * TAU, vr: (R() - 0.5) * 3, vy: 40 + R() * 50, ph: R() * TAU, col: PINK[(R() * 3) | 0], kind: "petal" }));
  const rid = [ridge(2), ridge(9), ridge(17)];
  const branch = (sx) => ({ p: [[sx * -20, 380], [sx * 90, 350], [sx * 150, 500], [sx * 250, 540]].map(([x, y]) => [sx < 0 ? LW + x : x, y]), seeds: Array.from({ length: 34 }, () => ({ u: R(), dx: (R() - 0.5) * 60, dy: (R() - 0.5) * 50, r: 7 + R() * 9, ph: R() * TAU })) });
  const br = [branch(1), branch(-1)];
  return {
    update(f) {
      st.clock += f.dt; st.wind = lerp(st.wind, 40 + 200 * f.mid + 260 * f.hit, 1 - Math.exp(-f.dt * 2.5));
      for (const p of petals) {
        p.y += p.vy * f.dt; p.x += (st.wind * (0.5 + p.size / 20) + Math.sin(st.clock * 1.3 + p.ph) * 30) * f.dt; p.rot += p.vr * f.dt * (1 + st.wind / 120);
        if (p.y > LH + 20) { p.y = -20; p.x = R() * LW; } if (p.x > LW + 30) p.x = -30;
      }
    },
    bg(ctx, f) {
      const t = f.clock; let g = ctx.createLinearGradient(0, 0, 0, HOR); g.addColorStop(0, "#3b3f7a"); g.addColorStop(0.45, "#b9739c"); g.addColorStop(1, "#ffc89a"); ctx.fillStyle = g; ctx.fillRect(0, 0, LW, LH);
      ctx.globalCompositeOperation = "lighter"; glow(ctx, 390, 760, 460, [255, 200, 170], 0.38 + f.high * 0.1); ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#fff1d6"; ctx.beginPath(); ctx.arc(390, 770, 110, 0, TAU); ctx.fill();
      [["#c58aa8", 170, 90], ["#8e5f9a", 40, 130], ["#4a3270", 0, 150]].forEach(([c, dy, amp], i) => {
        fillRidge(ctx, rid[i], HOR + 30 + i * 30 + dy * 0.2, amp, c); const m = ctx.createLinearGradient(0, HOR - amp, 0, HOR + 40 + i * 30); m.addColorStop(0, "rgba(255,230,240,0)"); m.addColorStop(1, "rgba(255,230,240,.22)"); ctx.fillStyle = m; ctx.fillRect(0, HOR - amp, LW, amp + 70 + i * 30);
      });
      g = ctx.createLinearGradient(0, HOR + 80, 0, LH); g.addColorStop(0, "#4a3270"); g.addColorStop(1, "#1d1236"); ctx.fillStyle = g; ctx.fillRect(0, HOR + 80, LW, LH);
      for (const b of br) {                                                                               // blossom branches from both sides
        const [p0, p1, p2, p3] = b.p, sway = Math.sin(t * 0.6) * 4; ctx.strokeStyle = "#24102f"; ctx.lineCap = "round";
        ctx.lineWidth = 13; ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.bezierCurveTo(p1[0], p1[1] + sway, p2[0], p2[1] + sway, p3[0], p3[1]); ctx.stroke();
        for (const s of b.seeds) { const [x, y] = bezier(p0, p1, p2, p3, s.u); ctx.fillStyle = rgba(PINK[(s.ph * 3 | 0) % 3], 0.88); ctx.beginPath(); ctx.arc(x + s.dx + Math.sin(t * 0.8 + s.ph) * 3, y + s.dy + sway, s.r, 0, TAU); ctx.fill(); }
      }
    },
    fg(ctx, f) {
      for (const e of f.events) for (let i = 0; i < 2; i++) P.add({ x: f.keyX(e.m) * LW, y: f.hitY * LH - 10, vx: (Math.random() - 0.3) * 160, vy: -(140 + Math.random() * 200), g: 130, drag: 0.7, life: 1.6 + Math.random(), size: 7 + Math.random() * 6, col: PINK[(Math.random() * 3) | 0], kind: "petal", add: false, rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 5, ph: Math.random() * TAU, shrink: false });
      P.step(f.dt); for (const p of petals) petal(ctx, p); P.draw(ctx);
      ctx.globalCompositeOperation = "lighter"; glow(ctx, 390, 770, 520, [255, 200, 160], 0.08 + f.low * 0.08); ctx.globalCompositeOperation = "source-over"; vignette(ctx, [40, 10, 40], 0.4);
    },
  };
}

function embers() {
  const R = rng(9), P = new Parts(200), st = { clock: 0 };
  const sparks = Array.from({ length: 150 }, () => ({ x: R() * LW, y: R() * LH, v: 40 + R() * 120, r: 2 + R() * 4, ph: R() * TAU, hot: R() }));
  const smoke = Array.from({ length: 6 }, () => ({ x: R() * LW, y: R() * 700, r: 160 + R() * 160, s: 10 + R() * 14 }));
  return {
    update(f) {
      st.clock += f.dt;
      for (const s of sparks) { s.y -= s.v * (1 + f.density * 1.5) * f.dt; s.x += Math.sin(st.clock * 1.7 + s.ph) * 26 * f.dt; if (s.y < -10) { s.y = LH + 10; s.x = R() * LW; } }
      for (const m of smoke) { m.y -= m.s * f.dt; if (m.y < -m.r) m.y = LH * 0.7; }
    },
    bg(ctx, f) {
      const t = f.clock; const g = ctx.createLinearGradient(0, 0, 0, LH); g.addColorStop(0, "#0d0202"); g.addColorStop(0.6, "#3a0a05"); g.addColorStop(1, "#b3290a"); ctx.fillStyle = g; ctx.fillRect(0, 0, LW, LH);
      for (const m of smoke) glow(ctx, m.x, m.y, m.r, [10, 4, 4], 0.45);
      ctx.globalCompositeOperation = "lighter"; glow(ctx, LW / 2, LH, 620, [255, 90, 20], 0.35 + f.low * 0.4 + f.hit * 0.1);
      [[640, [255, 70, 15]], [500, [255, 130, 30]], [370, [255, 190, 70]], [240, [255, 235, 160]]].forEach(([base, c], i) => {      // the flames rise behind the keyboard
        const hgt = base * (1 + f.low * 0.6 + f.hit * 0.2); ctx.beginPath(); ctx.moveTo(0, LH);
        for (let x = 0; x <= LW; x += 8) { const n = Math.sin(x * 0.018 + t * 2.6 + i * 1.7) * 0.5 + Math.sin(x * 0.041 - t * 3.7 + i) * 0.3 + Math.sin(x * 0.09 + t * 6.1) * 0.2; ctx.lineTo(x, LH - hgt * (0.35 + 0.65 * Math.pow(n * 0.5 + 0.5, 1.5)) * (0.7 + 0.3 * Math.sin(x * 0.004 + i))); }
        ctx.lineTo(LW, LH); ctx.closePath(); const fg = ctx.createLinearGradient(0, LH - hgt, 0, LH); fg.addColorStop(0, rgba(c, 0)); fg.addColorStop(1, rgba(c, 0.42)); ctx.fillStyle = fg; ctx.fill();
      });
      ctx.globalCompositeOperation = "source-over";
    },
    fg(ctx, f) {
      ctx.globalCompositeOperation = "lighter";
      for (const s of sparks) { const a = 0.5 + 0.5 * Math.sin(st.clock * 6 + s.ph), c = s.hot > 0.6 ? [255, 210, 120] : [255, 100, 30], r = s.r * (1 + f.hit * 0.5); ctx.globalAlpha = a * (0.4 + 0.6 * s.y / LH); ctx.drawImage(sprite(c), s.x - r, s.y - r, r * 2, r * 2); }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
      keySparks(P, f, e => e.v > 0.7 ? [255, 230, 150] : [255, 140, 50], 4, { g: -90, size: 8 }); P.step(f.dt); P.draw(ctx); vignette(ctx, [30, 0, 0], 0.55);
    },
  };
}

function plain() {
  const P = new Parts(160);
  return {
    bg(ctx, f) { const g = ctx.createLinearGradient(0, 0, 0, LH); g.addColorStop(0, "#07070b"); g.addColorStop(1, "#14141e"); ctx.fillStyle = g; ctx.fillRect(0, 0, LW, LH); },
    fg(ctx, f) {
      for (const e of f.events) P.add({ x: f.keyX(e.m) * LW, y: f.hitY * LH - 10, vx: 0, vy: -30, life: 0.9, size: 70, col: e.h ? [255, 143, 77] : [77, 181, 255], a: 0.35, shrink: false });
      keySparks(P, f, e => e.h ? [255, 170, 110] : [120, 200, 255], 2, { size: 5 }); P.step(f.dt); P.draw(ctx);
    },
  };
}

// A video clip (or picture) of the person's own behind the notes: it covers the screen, pushes in a little with every note, shudders and flashes on
// loud low notes, and can carry another theme's effects over it (rain and lightning, petals, embers ...). fx: that theme's id; dark: 0..0.8.
function media({ media: m, fx, dark, hand }) {
  const P = new Parts(160), motes = Array.from({ length: 50 }, (_, i) => ({ x: (i * 97) % LW, y: (i * 211) % LH, v: 10 + (i % 7) * 6, r: 1.5 + (i % 4), ph: i }));
  const over = fx && fx !== "media" && THEMES.find(t => t.id === fx) ? THEMES.find(t => t.id === fx).make({}) : null, d = dark ?? 0.35;
  return {
    update(f) { if (over && over.update) over.update(f); },
    bg(ctx, f) {
      ctx.fillStyle = "#050507"; ctx.fillRect(0, 0, LW, LH);
      const el = m && m.el, iw = el && (el.videoWidth || el.naturalWidth || el.width), ih = el && (el.videoHeight || el.naturalHeight || el.height);
      if (iw && ih && (el.readyState === undefined || el.readyState >= 2)) {
        const s = Math.max(LW / iw, LH / ih) * (1.05 + 0.02 * Math.sin(f.clock * 0.12) + f.hit * 0.02), sh = f.boom * 7;       // a push-in on every note, a shudder on loud low ones
        ctx.drawImage(el, (LW - iw * s) / 2 + (Math.random() - 0.5) * sh, (LH - ih * s) / 2 + (Math.random() - 0.5) * sh, iw * s, ih * s);
      }
      const g = ctx.createLinearGradient(0, 0, 0, LH); g.addColorStop(0, rgba([0, 0, 0], d)); g.addColorStop(0.5, rgba([0, 0, 0], d * 0.35)); g.addColorStop(1, rgba([0, 0, 0], Math.min(0.9, d * 1.4))); ctx.fillStyle = g; ctx.fillRect(0, 0, LW, LH);
      ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = rgba([255, 255, 255], f.boom * 0.09); ctx.fillRect(0, 0, LW, LH); ctx.globalCompositeOperation = "source-over";
    },
    fg(ctx, f) {
      if (over) { over.fg(ctx, f); return; }
      ctx.globalCompositeOperation = "lighter";
      for (const q of motes) { q.y -= q.v * f.dt; q.x += Math.sin(f.clock + q.ph) * 8 * f.dt; if (q.y < -5) q.y = LH + 5; ctx.globalAlpha = 0.25 + 0.2 * Math.sin(f.clock * 2 + q.ph); ctx.drawImage(sprite([255, 240, 210]), q.x - q.r * 2, q.y - q.r * 2, q.r * 4, q.r * 4); }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
      keySparks(P, f, e => hand ? hand[e.h ? 1 : 0] : e.h ? [255, 190, 120] : [255, 225, 150], 3, { size: 6 }); P.step(f.dt); P.draw(ctx); vignette(ctx, [0, 0, 0], 0.5);
    },
  };
}

const SANS = '800 {px}px Inter, system-ui, "Segoe UI", sans-serif';
export const THEMES = [
  { id: "pirate", keys: ["#ffd37a", "#7fe3ff"], name: "Pirate seas", blurb: "A ghost ship in a thunderstorm. Bass notes heave the waves and call the lightning.", sw: ["#06101a", "#2d6572", "#f3d9a0"], scrim: [4, 10, 18],
    title: { font: 'italic 700 {px}px "Palatino Linotype", Palatino, Georgia, serif', c: ["#fbe9b8", "#e0a94a"], glow: "rgba(255,170,60,.55)" }, make: pirate },
  { id: "space", keys: ["#9fc0ff", "#e0a3ff"], name: "Deep space", blurb: "Nebulae and a ringed planet. Busy playing sends the stars into warp; high notes bring shooting stars.", sw: ["#05010f", "#3f63c8", "#c3a5ff"], scrim: [5, 1, 15],
    title: { font: SANS, c: ["#ffffff", "#b9c8ff"], glow: "rgba(140,160,255,.7)", caps: true }, make: space },
  { id: "synth", keys: ["#00f0ff", "#ff5fb0"], name: "Synthwave", blurb: "A neon sun over a moving grid. The grid speeds up with the music and the keys send out rings.", sw: ["#0d0221", "#ff2e88", "#00e6ff"], scrim: [13, 2, 33],
    title: { font: SANS, c: ["#ffe45e", "#ff4fa8"], glow: "rgba(255,60,170,.75)", caps: true }, make: synth },
  { id: "sakura", keys: ["#6fd8ff", "#ffe27a"], name: "Cherry blossom", blurb: "A pink dawn over the mountains with petals on the wind. Every note blows petals up from its key.", sw: ["#3b3f7a", "#ffb7d0", "#ffc89a"], scrim: [40, 38, 100],
    title: { font: 'italic 600 {px}px Georgia, "Times New Roman", serif', c: ["#fff7fa", "#ffd0e0"], glow: "rgba(255,150,190,.7)" }, make: sakura },
  { id: "embers", keys: ["#9fe0ff", "#ffe27a"], name: "Fire and embers", blurb: "Flames that roar with the low notes, with embers rising. For big, dramatic pieces.", sw: ["#0d0202", "#b3290a", "#ffd37a"], scrim: [13, 2, 2],
    title: { font: SANS, c: ["#fff0c8", "#ff9a3c"], glow: "rgba(255,90,20,.8)", caps: true }, make: embers },
  { id: "media", keys: ["#7fd8ff", "#ffc46b"], name: "My video clip", blurb: "Your own video (or picture) behind the notes, with the storm, petals, embers or neon effects over it if you like. Use only footage you have the rights to.", sw: ["#1c1c22", "#555563", "#e8e8ee"], scrim: [5, 5, 7],
    title: { font: SANS, c: ["#ffffff", "#e0e0ea"], glow: "rgba(0,0,0,.8)", caps: true }, make: media },
  { id: "plain", keys: ["#4db5ff", "#ff8f4d"], name: "Plain dark", blurb: "Just the notes on dark, with soft light under each key.", sw: ["#07070b", "#14141e", "#4db5ff"], scrim: [7, 7, 11],
    title: { font: SANS, c: ["#ffffff", "#d8d8e4"], glow: "rgba(77,181,255,.5)", caps: true }, make: plain },
];

// ---------- title ----------
function wrap(ctx, text, maxW) {
  const lines = []; let cur = "";
  for (const w of text.split(/\s+/).filter(Boolean)) { const t = cur ? cur + " " + w : w; if (cur && ctx.measureText(t).width > maxW) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); return lines;
}
function layoutTitle(ctx, th, title, sub) {
  if (!title.trim() && !sub.trim()) return null;
  const caps = th.title.caps, text = caps ? title.toUpperCase() : title, maxW = 600; let size = 62, lines = [];
  for (; size >= 28; size -= 3) { ctx.font = th.title.font.replace("{px}", size); lines = wrap(ctx, text, maxW); if (lines.length <= 2 && lines.every(l => ctx.measureText(l).width <= maxW)) break; }
  const top = 205, lh = size * 1.12, bottom = top + (text.trim() ? lines.length * lh : 0) + (sub.trim() ? 44 : 0);
  return { size, lines: text.trim() ? lines : [], top, lh, bottom, sub: caps ? sub.toUpperCase() : sub };
}
function drawTitle(ctx, th, L) {
  if (!L) return;
  ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.font = th.title.font.replace("{px}", L.size);
  const g = ctx.createLinearGradient(0, L.top, 0, L.top + L.lines.length * L.lh); g.addColorStop(0, th.title.c[0]); g.addColorStop(1, th.title.c[1]);
  L.lines.forEach((l, i) => {
    const y = L.top + L.size * 0.85 + i * L.lh; ctx.shadowColor = th.title.glow; ctx.shadowBlur = 22; ctx.fillStyle = g; ctx.fillText(l, LW / 2, y);
    ctx.shadowBlur = 0; ctx.fillText(l, LW / 2, y);
  });
  if (L.sub.trim()) { ctx.font = "600 25px Inter, system-ui, sans-serif"; if ("letterSpacing" in ctx) ctx.letterSpacing = "4px"; ctx.shadowColor = "rgba(0,0,0,.8)"; ctx.shadowBlur = 8; ctx.fillStyle = "rgba(255,255,255,.88)"; ctx.fillText(L.sub, LW / 2, L.bottom - 10); }
  ctx.restore();
}

// ---------- one reel ----------
// w, h: size of the picture in pixels (9:16). Draw with reel.draw(f) once per frame, then hand reel.bg / reel.fg to the scene.
export function createReel({ theme, title = "", subtitle = "", w, h, media: m, fx, dark, hand }) {
  const base = THEMES.find(t => t.id === theme) || THEMES[0], inst = base.make({ media: m, fx, dark, hand });
  const th = base.id === "media" && fx && THEMES.find(t => t.id === fx) || base;           // a clip with storm effects over it gets the storm's title style too
  const bgW = Math.min(LW, w), bg = mk(bgW, Math.round(bgW * LH / LW)), fg = mk(w, h), b = bg.getContext("2d"), g = fg.getContext("2d");
  g.setTransform(w / LW, 0, 0, h / LH, 0, 0); const L = layoutTitle(g, th, title, subtitle);
  return {
    bg, fg, theme: base,
    draw(f) {
      b.setTransform(bg.width / LW, 0, 0, bg.height / LH, 0, 0); if (inst.update) inst.update(f); inst.bg(b, f);
      g.setTransform(w / LW, 0, 0, h / LH, 0, 0); g.clearRect(0, 0, LW, LH);
      const bottom = L ? L.bottom + 90 : 160, s = g.createLinearGradient(0, 0, 0, bottom);
      s.addColorStop(0, rgba(th.scrim, 0.95)); s.addColorStop(0.7, rgba(th.scrim, 0.8)); s.addColorStop(1, rgba(th.scrim, 0)); g.fillStyle = s; g.fillRect(0, 0, LW, bottom);
      inst.fg(g, f); drawTitle(g, th, L);
    },
  };
}
// The dialog's preview: the background, falling bars drawn from the real notes, a keyboard strip, and the foreground.
export function drawPreview(ctx, reel, f, notes, en, colors = ["#4db5ff", "#ff8f4d"], lookAhead = 4) {
  const W = ctx.canvas.width, H = ctx.canvas.height, hy = f.hitY * H;
  ctx.drawImage(reel.bg, 0, 0, W, H);
  for (let i = en.first(f.t - 8); i < notes.length && notes[i].t < f.t + lookAhead; i++) {
    const n = notes[i], bot = hy - (n.t - f.t) / lookAhead * hy, top = bot - Math.max(3, n.d / lookAhead * hy); if (bot < 0 || top > hy) continue;
    const x = f.keyX(n.m + (f.tr || 0)) * W; ctx.fillStyle = colors[n.h ? 1 : 0]; ctx.fillRect(x - 3, Math.max(0, top), 6, Math.min(hy, bot) - Math.max(0, top));
  }
  ctx.fillStyle = "rgba(230,228,222,.92)"; ctx.fillRect(0, hy, W, H * 0.06);
  ctx.drawImage(reel.fg, 0, 0, W, H);
}

// ---------- suggestions: what suits this song and this clip ----------
// There is no way to know what a picture shows, so these go by what can be measured: the words in the title and the clip's name, the clip's colours
// and brightness, and how the music behaves (low or high, busy or calm, major or minor).
const hd = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
function hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0;
  if (d) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, mx ? d / mx : 0, mx];
}
export const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
function hslHex(h, s, l) {
  const a = s * Math.min(l, 1 - l), f = n => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return "#" + [f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, "0")).join("");
}
// Looks at a handful of frames of a clip (a separate hidden video, so the one playing is not disturbed). -> { lum, sat, hue, hist, bright } or null
export async function analyzeClip(m) {
  const el = m && m.el; if (!el) return null;
  const W = 48, H = 85, c = mk(W, H), g = c.getContext("2d", { willReadFrequently: true }), frames = [];
  const grab = src => { g.drawImage(src, 0, 0, W, H); frames.push(g.getImageData(0, 0, W, H).data); };
  if (el.tagName === "VIDEO") {
    const v = document.createElement("video"); v.muted = true; v.preload = "auto"; v.src = el.src;
    await new Promise(r => { v.onloadeddata = r; v.onerror = r; setTimeout(r, 4000); });
    const dur = isFinite(v.duration) ? v.duration : 0;
    for (const k of dur ? [0.08, 0.28, 0.48, 0.68, 0.88] : [0]) { if (dur) { v.currentTime = Math.min(dur * k, 180); await new Promise(r => { v.onseeked = r; setTimeout(r, 2000); }); } try { grab(v); } catch (e) {} }
    v.removeAttribute("src"); v.load();
  } else { try { grab(el); } catch (e) {} }
  if (!frames.length) return null;
  let n = 0, sl = 0, ss = 0, bright = 0, hs = 0; const hist = new Array(36).fill(0);
  for (const d of frames) for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255, [h, s, v] = hsv(r, gg, b), L = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
    n++; sl += L; ss += s * v; if (L > 0.8) bright++; if (v > 0.12) { hist[Math.floor(h / 10) % 36] += s * v; hs += s * v; }
  }
  const norm = hs > 0 ? hist.map(x => x / hs) : hist, top = norm.indexOf(Math.max(...norm));
  return { lum: sl / n, sat: ss / n, hue: top * 10 + 5, hist: norm, bright: bright / n };
}
// Two note colours (right hand, left hand) and how much to darken the picture, so the notes stand out. Each hue is made as light as it has to be to
// reach a contrast of 5 against the picture as it will look (darkened, under the lane's veil); grey or dark pictures take a clear cyan and amber, and a
// colourful picture gets the hues least like its own.
const relLum = hex => { const [r, g, b] = hexRgb(hex).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export function suggestColors(st, veil = 0.5) {
  const dark = st ? clamp((st.lum - 0.18) * 1.3 + 0.25, 0.2, 0.8) : 0.35;
  const bgL = st ? Math.pow(st.lum, 2.2) * (1 - 0.92 * dark) * (1 - veil) : 0.02;                  // about how bright it looks behind the notes
  const make = h => { let hex = "#fff"; for (const L of [0.62, 0.7, 0.78, 0.86]) { hex = hslHex(h, 0.95, L); if ((relLum(hex) + 0.05) / (bgL + 0.05) >= 5) return { hex, L }; } return { hex, L: 0.86 }; };
  const hues = Array.from({ length: 36 }, (_, i) => i * 10), made = hues.map(make);
  const near = h => st && st.sat >= 0.12 ? st.hist.reduce((a, w, b) => a + w * Math.exp(-Math.pow(hd(h, b * 10 + 5) / 30, 2)), 0) : 0;
  const like = h => Math.min(hd(h, 195), hd(h, 45)) / 180 * 0.5;                                      // between equally good hues, lean to cyan and gold
  const cost = h => near(h) * 10 + like(h) + (made[h / 10].L - 0.62) * 2;                              // far from the picture's hues, and not needing to be washed out
  const rh = hues.reduce((b, h) => cost(h) < cost(b) ? h : b, 190);
  const rest = hues.filter(h => hd(h, rh) >= 100), lcost = h => cost(h) + Math.abs(hd(h, rh) - 140) / 180, lh = rest.reduce((b, h) => lcost(h) < lcost(b) ? h : b, rest[0]);
  return { right: made[rh / 10].hex, left: made[lh / 10].hex, dark };
}
// How the music feels: energy 0..1 (busy and loud), dark 0..1 (low, heavy, minor), minor (best-fitting key is minor)
export function musicMood(notes, from = 0, to = 1e9) {
  const ns = notes.filter(n => n.t >= from && n.t < to); if (!ns.length) return { energy: 0.4, dark: 0.4, minor: false };
  const span = Math.max(1, Math.min(to, ns[ns.length - 1].t + 1) - from), pc = new Array(12).fill(0); let vel = 0, low = 0, pitch = 0;
  for (const n of ns) { pc[n.m % 12] += n.d || 0.1; vel += n.v > 1 ? n.v / 127 : (n.v ?? 0.7); if (n.m < 48) low++; pitch += n.m; }
  const MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88], MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const corr = (a, b) => { const ma = a.reduce((x, y) => x + y) / 12, mb = b.reduce((x, y) => x + y) / 12; let s = 0, sa = 0, sb = 0; for (let i = 0; i < 12; i++) { s += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; } return s / Math.sqrt(sa * sb || 1); };
  let best = -2, minor = false;
  for (let k = 0; k < 12; k++) { const r = pc.map((_, i) => pc[(i + k) % 12]); for (const [prof, isMin] of [[MAJ, false], [MIN, true]]) { const c = corr(r, prof); if (c > best) { best = c; minor = isMin; } } }
  const density = ns.length / span, meanVel = vel / ns.length, lowShare = low / ns.length;
  return { energy: clamp(density / 7) * 0.6 + clamp(meanVel) * 0.4, dark: clamp(0.4 * minor + lowShare + 0.25 * (1 - clamp((pitch / ns.length - 36) / 50))), minor };
}
const KEYWORDS = [
  ["pirate", /pirat|potc|pirates?|caribb|jack sparrow|davy jones|black pearl|\bship|\bsea\b|ocean|sail|voyage|storm|thunder|treasure|kraken|hornpipe/i, "the title or clip name suggests the sea and storms"],
  ["space", /\bspace|star|galax|cosmo|interstellar|planet|moon|night sky|nebula|astro|orbit|cosmic|clair de lune/i, "the title or clip name suggests space and night"],
  ["synth", /neon|synth|retro|\b80s|cyber|outrun|vapor|arcade|tron/i, "the title or clip name suggests neon and retro"],
  ["sakura", /sakura|cherry|blossom|spring|ghibli|totoro|spirited|howl|ponyo|kiki|summer|flower|rose|garden/i, "the title or clip name suggests blossoms and spring"],
  ["embers", /\bfire|flame|burn|dragon|inferno|rage|\bhell|lava|phoenix|vampire|blood|metal|thunderstruck/i, "the title or clip name suggests fire"],
];
// -> { id, why }: the theme (or, over a clip, the effects) that fits best. Words win; then the clip's colours; then the music.
export function suggestTheme({ text = "", stats = null, mood = null }) {
  for (const [id, re, why] of KEYWORDS) if (re.test(text)) return { id, why };
  if (stats) {
    const h = stats.hue, warm = h <= 50 || h >= 345;
    if (stats.sat > 0.3 && warm) return { id: "embers", why: "the clip is warm, red and orange" };
    if (stats.sat > 0.3 && h >= 270 && h < 345) return stats.lum > 0.5 ? { id: "sakura", why: "the clip is soft pink and purple" } : { id: "synth", why: "the clip is neon pink and purple" };
    if (stats.lum < 0.2 && stats.bright > 0.004) return { id: "space", why: "the clip is dark with bright points" };
    if (stats.lum < 0.4 && ((h >= 170 && h <= 260) || stats.sat < 0.2)) return { id: "pirate", why: "the clip is dark and blue-grey, like night at sea" };
  }
  if (mood) {
    if (mood.dark > 0.55 && mood.energy > 0.45) return { id: "pirate", why: "the music is low and dramatic" };
    if (mood.energy > 0.62) return { id: "embers", why: "the music is fast and loud" };
    if (mood.dark < 0.35 && mood.energy < 0.5) return { id: "sakura", why: "the music is gentle and bright" };
    return { id: "space", why: "the music is calm" };
  }
  return { id: "space", why: "" };
}
