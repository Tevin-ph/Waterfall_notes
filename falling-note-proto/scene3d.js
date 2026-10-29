// Real 3D falling-notes scene (three.js + bloom). Notes fall along -z toward a 3D piano keyboard at z = 0.
import * as T from "./vendor/three.js";

const FIRST = 21, LAST = 108, ZPS = 12;           // MIDI range; world units per second of music
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const HAND = [0x7cc4ff, 0xffa970];                  // right = blue, left = orange
const BG = 0x050507;
const isBlack = m => [1, 3, 6, 8, 10].includes(m % 12);

export function createScene(stage) {
  const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.85;
  const el = renderer.domElement;
  el.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
  stage.insertBefore(el, stage.firstChild);

  const scene = new T.Scene();
  scene.background = new T.Color(BG);
  scene.fog = new T.Fog(BG, 55, 118);
  const camera = new T.PerspectiveCamera(55, 1, 0.5, 300);
  camera.position.set(0, 15, 22);
  camera.lookAt(0, 2, -26);
  scene.add(new T.AmbientLight(0xffffff, 0.7));
  const sun = new T.DirectionalLight(0xffffff, 1.0); sun.position.set(-10, 40, 25); scene.add(sun);

  // ---- keyboard ----
  const keys = {};                                   // midi -> { x, black, mesh, mat, hand }
  let wc = 0;
  const whiteGeo = new T.BoxGeometry(0.94, 1.2, 5.6), blackGeo = new T.BoxGeometry(0.6, 0.9, 3.5);
  for (let m = FIRST; m <= LAST; m++) {
    if (isBlack(m)) continue;
    const x = wc++ - 25.5, mat = new T.MeshStandardMaterial({ color: 0xf1efe9, roughness: 0.35, emissive: 0x55544f });
    const mesh = new T.Mesh(whiteGeo, mat); mesh.position.set(x, -0.6, 2.8); scene.add(mesh);
    keys[m] = { x, black: false, mesh, mat, hand: -1, baseY: -0.6, baseColor: 0xf1efe9 };
  }
  for (let m = FIRST; m <= LAST; m++) {
    if (!isBlack(m)) continue;
    const x = keys[m - 1].x + 0.5, mat = new T.MeshStandardMaterial({ color: 0x16161b, roughness: 0.25, metalness: 0.2, emissive: 0x000000 });
    const mesh = new T.Mesh(blackGeo, mat); mesh.position.set(x, 0.05, 1.75); scene.add(mesh);
    keys[m] = { x, black: true, mesh, mat, hand: -1, baseY: 0.05, baseColor: 0x16161b };
  }

  // ---- floor, guides, hit line ----
  const floor = new T.Mesh(new T.PlaneGeometry(80, 200), new T.MeshBasicMaterial({ color: 0x0a0a0e }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, -0.02, -80); scene.add(floor);
  const lineMat = (o) => new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: o, depthWrite: false });
  const guideLen = 5 * ZPS + 20;
  for (let m = FIRST; m <= LAST; m++) {
    if (m % 12 !== 0 || isBlack(m)) continue;
    const g = new T.Mesh(new T.BoxGeometry(0.04, 0.02, guideLen), lineMat(0.09)); g.position.set(keys[m].x - 0.5, 0, -guideLen / 2); scene.add(g);
  }
  const hit = new T.Mesh(new T.BoxGeometry(52.6, 0.07, 0.14), new T.MeshBasicMaterial({ color: 0xffffff })); hit.position.set(0, 0.03, 0); scene.add(hit);
  const beatPool = [], beatBar = lineMat(0.22), beatMinor = lineMat(0.07), beatGeo = new T.BoxGeometry(52, 0.02, 0.06);
  for (let i = 0; i < 24; i++) { const b = new T.Mesh(beatGeo, beatMinor); b.visible = false; scene.add(b); beatPool.push(b); }
  const loopMat = new T.MeshBasicMaterial({ color: 0x6ea8ff });
  const loopMarks = [0, 1].map(() => { const b = new T.Mesh(new T.BoxGeometry(52, 0.05, 0.12), loopMat); b.visible = false; scene.add(b); return b; });

  // ---- note pool ----
  const boxGeo = new T.BoxGeometry(1, 1, 1), planeGeo = new T.PlaneGeometry(1, 1);
  const matCache = new Map();
  const noteMat = (hex, dim) => {
    const k = hex + (dim ? "d" : "");
    if (!matCache.has(k)) matCache.set(k, new T.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: dim ? 0.05 : 0.6, roughness: 0.45, transparent: dim, opacity: dim ? 0.22 : 1, depthWrite: !dim }));
    return matCache.get(k);
  };
  const spectrum = NAMES.map((_, i) => new T.Color().setHSL(i / 12, 0.9, 0.68, T.SRGBColorSpace).getHex());
  const labelMats = NAMES.map(n => {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d"); g.font = "700 84px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.lineJoin = "round"; g.lineWidth = 12; g.strokeStyle = "rgba(255,255,255,.75)"; g.strokeText(n, 64, 68);
    g.fillStyle = "#101015"; g.fillText(n, 64, 68);
    const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 4;
    return new T.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false });
  });
  const pool = [];
  function slot(i) {
    if (!pool[i]) {
      const box = new T.Mesh(boxGeo, noteMat(HAND[0], false)), stripe = new T.Mesh(boxGeo, noteMat(HAND[0], false)), label = new T.Mesh(planeGeo, labelMats[0]);
      label.rotation.x = -Math.PI / 2;
      for (const o of [box, stripe, label]) { o.visible = false; scene.add(o); }
      pool[i] = { box, stripe, label };
    }
    return pool[i];
  }

  // ---- key glow sprites ----
  const gc = document.createElement("canvas"); gc.width = gc.height = 128;
  { const g = gc.getContext("2d"), r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.35, "rgba(255,255,255,.35)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, 128, 128); }
  const glowTex = new T.CanvasTexture(gc), sprites = [];
  for (let i = 0; i < 24; i++) {
    const s = new T.Sprite(new T.SpriteMaterial({ map: glowTex, blending: T.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.8 }));
    s.visible = false; scene.add(s); sprites.push(s);
  }

  // ---- post: bloom ----
  const composer = new T.EffectComposer(renderer);
  composer.addPass(new T.RenderPass(scene, camera));
  const bloom = new T.UnrealBloomPass(new T.Vector2(256, 256), 0.55, 0.5, 0.92);   // strength, radius, threshold: only bright emissive things glow
  composer.addPass(bloom);
  composer.addPass(new T.OutputPass());

  // The view zooms to the part of the keyboard the song uses (like Falling Note), easing between ranges.
  const view = { cx: 0, half: 28, tcx: 0, thalf: 28 };
  function setRange(lo, hi) {
    const a = keys[Math.max(FIRST, lo)], b = keys[Math.min(LAST, hi)];
    if (!a || !b) return;
    view.tcx = (a.x + b.x) / 2; view.thalf = (b.x - a.x) / 2 + 2.6;
  }
  let aspect = 1.5;
  function placeCamera() {
    // Fixed vertical field of view. Back the camera off just far enough that the visible keys fit the width,
    // then tilt it so the keyboard sits near the bottom of the frame and the lane recedes above it.
    const F = 38, rad = Math.PI / 180;
    camera.aspect = aspect; camera.fov = F;
    const D = Math.max(18, view.half / (Math.tan(F * rad / 2) * aspect));    // distance to the keyboard centre
    const beta = 42 * rad, pitch = beta - 0.2 * F * rad, kz = 3;
    camera.position.set(view.cx, D * Math.sin(beta), kz + D * Math.cos(beta));
    const ty = camera.position.y - Math.sin(pitch) * 100, tz = camera.position.z - Math.cos(pitch) * 100;
    camera.lookAt(view.cx, ty, tz);
    camera.updateProjectionMatrix();
    scene.fog.near = D + 12; scene.fog.far = D + 80;
  }
  function resize(w, h) {
    if (!w || !h) return;
    renderer.setSize(w, h, false); composer.setSize(w, h); bloom.resolution.set(w, h);
    aspect = w / h; view.cx = view.tcx; view.half = view.thalf; placeCamera();
  }

  // octave labels (C3, C4 ...) on the front edge of every C key
  for (let m = FIRST; m <= LAST; m++) {
    if (m % 12 !== 0) continue;
    const c = document.createElement("canvas"); c.width = 128; c.height = 64;
    const g = c.getContext("2d"); g.font = "600 40px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "rgba(20,20,26,.55)"; g.fillText("C" + (m / 12 - 1), 64, 34);
    const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace;
    const lab = new T.Mesh(new T.PlaneGeometry(1.1, 0.55), new T.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false }));
    lab.rotation.x = -Math.PI / 2; lab.position.set(keys[m].x, 0.01, 5.0); scene.add(lab);
  }

  const setKey = (k, hand) => {
    if (k.hand === hand) return; k.hand = hand;
    if (hand < 0) { k.mat.color.setHex(k.baseColor); k.mat.emissive.setHex(k.black ? 0 : 0x55544f); k.mat.emissiveIntensity = 1; k.mesh.position.y = k.baseY; }
    else { k.mat.color.setHex(HAND[hand]); k.mat.emissive.setHex(HAND[hand]); k.mat.emissiveIntensity = 0.7; k.mesh.position.y = k.baseY - 0.12; }
  };

  function render(s) {
    const { p, notes, startIdx, transpose, allowed, letters, look, live, beatLen, loopA, loopB, lookAhead } = s;
    if (s.range) setRange(s.range[0], s.range[1]);
    if (Math.abs(view.tcx - view.cx) > 0.01 || Math.abs(view.thalf - view.half) > 0.01) {   // ease toward the new range
      view.cx += (view.tcx - view.cx) * 0.12; view.half += (view.thalf - view.half) * 0.12; placeCamera();
    }
    const active = new Map(), spec = look === "spectrum";
    let used = 0;
    for (let i = startIdx; i < notes.length; i++) {
      const n = notes[i]; if (n.t - p > lookAhead) break;
      const end = n.t + n.d; if (end < p) continue;
      const pm = n.m + transpose, k = keys[pm]; if (!k) continue;
      const dim = !allowed(n), w = k.black ? 0.5 : 0.84;
      const near = -Math.max(0, n.t - p) * ZPS, far = -Math.min(end - p, lookAhead) * ZPS;
      const len = Math.max(0.3, near - far), zc = near - len / 2;
      const e = slot(used++), hex = spec ? spectrum[pm % 12] : HAND[n.h];
      e.box.visible = true; e.box.material = noteMat(hex, dim); e.box.position.set(k.x, 0.3, zc); e.box.scale.set(w, 0.5, len);
      e.stripe.visible = spec && !dim;
      if (e.stripe.visible) { e.stripe.material = noteMat(HAND[n.h], false); e.stripe.position.set(k.x, 0.3, zc); e.stripe.scale.set(w * 0.3, 0.54, len * 0.98); }
      e.label.visible = letters && !dim && w > 0.4;
      if (e.label.visible) {
        const size = Math.min(0.85, w * 0.95);
        e.label.material = labelMats[pm % 12]; e.label.scale.set(size, size, 1);
        e.label.position.set(k.x, 0.58, len > size * 1.4 ? near - size * 0.75 : zc);
      }
      if (n.t <= p && end >= p && !dim) active.set(pm, n.h);
    }
    for (let i = used; i < pool.length; i++) { const e = pool[i]; e.box.visible = e.stripe.visible = e.label.visible = false; }
    for (const [m, kk] of live) active.set(m, kk.h);

    for (const m in keys) setKey(keys[m], active.has(+m) ? active.get(+m) : -1);
    let si = 0;
    for (const [m, hand] of active) {
      const k = keys[m]; if (!k || si >= sprites.length) continue;
      const sp = sprites[si++]; sp.visible = true; sp.material.color.setHex(HAND[hand] ?? HAND[0]); sp.material.opacity = 0.55;
      sp.position.set(k.x, 0.6, 1.2); sp.scale.setScalar(k.black ? 4 : 5);
    }
    for (; si < sprites.length; si++) sprites[si].visible = false;

    const b0 = Math.ceil(p / beatLen - 1e-6);
    beatPool.forEach((b, j) => {
      const beat = b0 + j, dt = beat * beatLen - p;
      b.visible = dt >= 0 && dt <= lookAhead;
      if (b.visible) { b.position.set(0, 0, -dt * ZPS); b.material = beat % 4 === 0 ? beatBar : beatMinor; }
    });
    [loopA, loopB].forEach((t, j) => {
      const dt = t == null ? -1 : t - p, m = loopMarks[j];
      m.visible = t != null && dt >= 0 && dt <= lookAhead; if (m.visible) m.position.set(0, 0.04, -dt * ZPS);
    });
    composer.render();
  }

  return { render, resize, dispose() { renderer.dispose(); el.remove(); } };
}
