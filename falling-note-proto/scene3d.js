// Real 3D falling-notes scene (three.js + bloom). Notes fall along -z toward a glossy 3D piano at z = 0.
import * as T from "./vendor/three.js";

const FIRST = 21, LAST = 108, ZPS = 12;            // MIDI range; world units per second of music
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const HAND = [0x4db5ff, 0xff8f4d];                  // right = blue, left = orange
const BG = 0x050508;
const isBlack = m => [1, 3, 6, 8, 10].includes(m % 12);
const lighten = (hex, k) => new T.Color(hex).lerp(new T.Color(0xffffff), k).getHex();

export function createScene(stage) {
  const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
  const el = renderer.domElement;
  el.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
  stage.insertBefore(el, stage.firstChild);

  const scene = new T.Scene();
  scene.background = new T.Color(BG);
  scene.fog = new T.Fog(BG, 55, 118);
  const camera = new T.PerspectiveCamera(38, 1, 0.5, 300);
  // soft studio reflections on the glossy keys and notes
  const pmrem = new T.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new T.RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;
  scene.add(new T.AmbientLight(0xffffff, 0.35));
  const sun = new T.DirectionalLight(0xffffff, 1.0); sun.position.set(-8, 40, 28); scene.add(sun);

  // ---------- piano ----------
  const keys = {};                                   // midi -> { x, black, mesh, mat, hand, baseY, baseColor }
  let wc = 0;
  const whiteGeo = new T.RoundedBoxGeometry(0.93, 1.2, 5.6, 3, 0.14), blackGeo = new T.RoundedBoxGeometry(0.58, 0.9, 3.4, 3, 0.11);
  // keys are kept below the bloom threshold so only the notes and lit keys glow
  const whiteMat = () => new T.MeshPhysicalMaterial({ color: 0xbdbab3, roughness: 0.38, clearcoat: 0.3, clearcoatRoughness: 0.35, emissive: 0x000000, envMapIntensity: 0.3 });
  const blackMat = () => new T.MeshPhysicalMaterial({ color: 0x0f0f13, roughness: 0.2, metalness: 0.1, clearcoat: 0.8, clearcoatRoughness: 0.12, emissive: 0x000000, envMapIntensity: 0.6 });
  for (let m = FIRST; m <= LAST; m++) {
    if (isBlack(m)) continue;
    const x = wc++ - 25.5, mat = whiteMat(), mesh = new T.Mesh(whiteGeo, mat);
    mesh.position.set(x, -0.6, 2.8); scene.add(mesh);
    keys[m] = { x, black: false, mesh, mat, hand: -1, baseY: -0.6, baseColor: 0xbdbab3 };
  }
  for (let m = FIRST; m <= LAST; m++) {
    if (!isBlack(m)) continue;
    const x = keys[m - 1].x + 0.5, mat = blackMat(), mesh = new T.Mesh(blackGeo, mat);
    mesh.position.set(x, 0.07, 1.7); scene.add(mesh);
    keys[m] = { x, black: true, mesh, mat, hand: -1, baseY: 0.07, baseColor: 0x0f0f13 };
  }
  // the dark case behind the keys, with a strip of red felt
  const caseMat = new T.MeshPhysicalMaterial({ color: 0x0a0a0d, roughness: 0.25, clearcoat: 1 });
  const cabinet = new T.Mesh(new T.BoxGeometry(54.5, 2.6, 1.4), caseMat); cabinet.position.set(0, -0.5, -0.55); scene.add(cabinet);
  const felt = new T.Mesh(new T.BoxGeometry(53, 0.08, 0.3), new T.MeshStandardMaterial({ color: 0x6d1018, roughness: 1 })); felt.position.set(0, 0.62, 0.12); scene.add(felt);

  // ---------- lane ----------
  const floor = new T.Mesh(new T.PlaneGeometry(90, 220), new T.MeshBasicMaterial({ color: 0x08090d }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, -0.02, -90); scene.add(floor);
  const lineMat = (o, c = 0xffffff) => new T.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false });
  const guideLen = 5 * ZPS + 24;
  const octMat = lineMat(0.13);
  for (let m = FIRST; m <= LAST; m++) {          // one faint guide line at every C (an octave boundary); more lines just shimmer in the distance
    if (m % 12 !== 0) continue;
    const l = new T.Mesh(new T.BoxGeometry(0.05, 0.006, guideLen), octMat);
    l.position.set(keys[m].x - 0.5, 0.003, -guideLen / 2); scene.add(l);
  }
  const hit = new T.Mesh(new T.BoxGeometry(52.6, 0.07, 0.12), new T.MeshBasicMaterial({ color: 0xffffff })); hit.position.set(0, 0.04, 0); scene.add(hit);
  const beatPool = [], beatBar = lineMat(0.2), beatMinor = lineMat(0.08), beatGeo = new T.BoxGeometry(52, 0.02, 0.06);
  for (let i = 0; i < 24; i++) { const b = new T.Mesh(beatGeo, beatMinor); b.visible = false; scene.add(b); beatPool.push(b); }
  const loopMat = new T.MeshBasicMaterial({ color: 0x6ea8ff });
  const loopMarks = [0, 1].map(() => { const b = new T.Mesh(new T.BoxGeometry(52, 0.05, 0.12), loopMat); b.visible = false; scene.add(b); return b; });

  // ---------- notes: glossy rounded "glass" bars ----------
  const geoCache = new Map();
  function noteGeo(w, len) {                     // rounded box per (width, length); length is snapped to 0.1 so the cache stays small
    const q = Math.max(0.55, Math.round(len * 10) / 10), key = w + "|" + q;
    let g = geoCache.get(key);
    if (!g) { g = new T.RoundedBoxGeometry(w, 0.5, q, 2, Math.min(0.15, w * 0.3, q * 0.4)); geoCache.set(key, g); }
    return { g, q };
  }
  const matCache = new Map();
  // Notes are calm pastel bars; only the one being played goes white-hot and blooms, so the screen stays clean.
  const noteMat = (hex, dim, hot) => {
    const k = hex + (dim ? "d" : "") + (hot ? "h" : "");
    if (!matCache.has(k)) matCache.set(k, new T.MeshPhysicalMaterial({
      color: hot ? lighten(hex, 0.7) : hex, emissive: hot ? lighten(hex, 0.25) : hex, emissiveIntensity: dim ? 0.04 : hot ? 0.85 : 0.28,
      roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.12, transparent: dim, opacity: dim ? 0.2 : 1, depthWrite: !dim }));
    return matCache.get(k);
  };
  const tailCache = new Map();                   // the pedal ring: the hand colour, see-through but easier to see than a dimmed note
  const tailMat = hex => {
    if (!tailCache.has(hex)) tailCache.set(hex, new T.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.45, depthWrite: false }));
    return tailCache.get(hex);
  };
  const spectrum = NAMES.map((_, i) => new T.Color().setHSL(i / 12, 0.85, 0.64, T.SRGBColorSpace).getHex());
  const planeGeo = new T.PlaneGeometry(1, 1), boxGeo = new T.BoxGeometry(1, 1, 1);
  const labelMats = NAMES.map(n => {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d"); g.font = "700 84px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.lineJoin = "round"; g.lineWidth = 12; g.strokeStyle = "rgba(255,255,255,.8)"; g.strokeText(n, 64, 68);
    g.fillStyle = "#0e0e14"; g.fillText(n, 64, 68);
    const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = 4;
    return new T.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false });
  });
  const pool = [];
  function slot(i) {
    if (!pool[i]) {
      const box = new T.Mesh(boxGeo, noteMat(HAND[0], false)), stripe = new T.Mesh(boxGeo, noteMat(HAND[0], false)), label = new T.Mesh(planeGeo, labelMats[0]);
      const tail = new T.Mesh(boxGeo, noteMat(HAND[0], true));        // the pedal ring after the key is let go
      label.rotation.x = -Math.PI / 2;
      for (const o of [box, stripe, label, tail]) { o.visible = false; scene.add(o); }
      pool[i] = { box, stripe, label, tail };
    }
    return pool[i];
  }

  // ---------- glow under a sounding key + sparks when a key is hit ----------
  const gc = document.createElement("canvas"); gc.width = gc.height = 128;
  { const g = gc.getContext("2d"), r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.35, "rgba(255,255,255,.35)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, 128, 128); }
  const glowTex = new T.CanvasTexture(gc);
  const mkSprite = o => { const s = new T.Sprite(new T.SpriteMaterial({ map: glowTex, blending: T.AdditiveBlending, transparent: true, depthWrite: false, opacity: o })); s.visible = false; scene.add(s); return s; };
  const glows = Array.from({ length: 24 }, () => mkSprite(0.55));
  const sparks = Array.from({ length: 160 }, () => ({ s: mkSprite(1), vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0.5 }));
  let sparkNext = 0;
  function burst(k, hand) {
    for (let i = 0; i < 7; i++) {
      const p = sparks[sparkNext++ % sparks.length];
      p.s.position.set(k.x + (Math.random() - 0.5) * 0.5, 0.8, 0.4 + Math.random() * 0.6);
      p.vx = (Math.random() - 0.5) * 2.2; p.vy = 3.5 + Math.random() * 4.5; p.vz = (Math.random() - 0.5) * 1.6;
      if (vmode === "flat") { p.vy = 1 + Math.random(); p.vz = -(2 + Math.random() * 4); }       // from above, sparks should spray up the screen
      p.life = p.max = 0.55 + Math.random() * 0.4; p.size = 0.35 + Math.random() * 0.45;
      p.s.material.color.setHex(lighten(HAND[hand] ?? HAND[0], 0.35)); p.s.visible = true;
    }
  }
  function stepSparks(dt) {
    for (const p of sparks) {
      if (p.life <= 0) { p.s.visible = false; continue; }
      p.life -= dt; p.vy -= 9 * dt;
      p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
      const f = Math.max(0, p.life / p.max); p.s.material.opacity = f; p.s.scale.setScalar(p.size * (0.5 + f));
    }
  }

  // ---------- post: bloom ----------
  const composer = new T.EffectComposer(renderer);
  composer.addPass(new T.RenderPass(scene, camera));
  const bloom = new T.UnrealBloomPass(new T.Vector2(256, 256), 0.55, 0.5, 0.9);   // strength, radius, threshold
  composer.addPass(bloom);
  composer.addPass(new T.OutputPass());

  // ---------- camera: zooms to the octaves in use, never cropping the edge keys ----------
  const view = { cx: 0, half: 28, tcx: 0, thalf: 28 };
  function setRange(lo, hi) {
    const a = keys[Math.max(FIRST, lo)], b = keys[Math.min(LAST, hi)];
    if (!a || !b) return;
    view.tcx = (a.x + b.x) / 2; view.thalf = (b.x - a.x) / 2 + 2.2;
  }
  let aspect = 1.5, vmode = "flat", zps = ZPS, laneDepth = 40;
  const F = 38, FF = 24, RAD = Math.PI / 180;   // F: field of view of the tilted view; FF: the straight-down view (narrow, so lanes stay parallel)
  function setCam(D) {
    camera.aspect = aspect;
    if (vmode === "flat") {
      // Straight down: notes fall vertically, the keyboard is seen from above at the bottom of the screen (like Synthesia).
      camera.fov = FF; camera.up.set(0, 0, -1);
      const worldH = 2 * D * Math.tan(FF * RAD / 2), zc = 6.4 - worldH / 2;     // keyboard front edge sits just above the bottom of the frame
      camera.position.set(view.cx, D, zc); camera.lookAt(view.cx, 0, zc);
      laneDepth = Math.max(8, worldH - 7);                                        // room above the keyboard for the falling notes
    } else {
      camera.fov = F; camera.up.set(0, 1, 0);
      const beta = 42 * RAD, pitch = beta - 0.33 * F * RAD, kz = 3;
      camera.position.set(view.cx, D * Math.sin(beta), kz + D * Math.cos(beta));
      camera.lookAt(view.cx, camera.position.y - Math.sin(pitch) * 100, camera.position.z - Math.cos(pitch) * 100);
    }
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  }
  // How close to the screen edge (1 = edge) a point on the keyboard's FRONT edge lands; the front looks widest.
  function frontEdge(x) {
    const e = camera.matrixWorldInverse.elements, z = 5.6;
    const vx = e[0] * x + e[8] * z + e[12], vz = e[2] * x + e[10] * z + e[14];
    return Math.abs(vx / -vz) / (Math.tan(F * RAD / 2) * aspect);
  }
  function placeCamera() {
    if (vmode === "flat") {
      const D = Math.max(12, view.half / (Math.tan(FF * RAD / 2) * aspect));
      setCam(D); scene.fog.near = D + 60; scene.fog.far = D + 400;                 // no distance fade when looking straight down
      return;
    }
    let D = Math.max(18, view.half / (Math.tan(F * RAD / 2) * aspect));
    for (let i = 0; i < 5; i++) {
      setCam(D);
      const worst = Math.max(frontEdge(view.cx - view.half), frontEdge(view.cx + view.half));
      if (worst <= 0.96) break;
      D *= worst / 0.96;
    }
    setCam(D);
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
    const g = c.getContext("2d"); g.font = "600 40px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "rgba(20,20,26,.5)"; g.fillText("C" + (m / 12 - 1), 64, 34);
    const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace;
    const lab = new T.Mesh(new T.PlaneGeometry(1.1, 0.55), new T.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false }));
    lab.rotation.x = -Math.PI / 2; lab.position.set(keys[m].x, 0.02, 5.0); scene.add(lab);
  }

  const setKey = (k, hand) => {
    if (k.hand === hand) return;
    const was = k.hand; k.hand = hand;
    if (hand < 0) { k.mat.color.setHex(k.baseColor); k.mat.emissive.setHex(0); k.mat.emissiveIntensity = 1; k.mesh.position.y = k.baseY; k.mesh.rotation.x = 0; }
    else {
      k.mat.color.setHex(lighten(HAND[hand], 0.25)); k.mat.emissive.setHex(HAND[hand]); k.mat.emissiveIntensity = 0.65;
      k.mesh.position.y = k.baseY - 0.15; k.mesh.rotation.x = 0.03;
      if (was < 0) burst(k, hand);
    }
  };

  // ---------- hands: two hands that play the song (optional) ----------
  // Built from simple shapes but with real proportions (a hand is about 18 cm: palm 10 cm, fingers 7-8 cm; a white key is 2.3 cm, here 0.93 units):
  // a shaped palm, a tapered wrist, fingers of three joints that arch and press down, a thumb of two, fingernails. Each finger goes to a key that is
  // sounding, or to the chord coming next. Which finger plays which key is a rough guess, not real fingering.
  const UP = new T.Vector3(0, 1, 0), tmpD = new T.Vector3(), tmpP = new T.Vector3(), PK = new T.Vector3(), PE = new T.Vector3(), PD = new T.Vector3(), PT = new T.Vector3();
  const PATTERN = { 1: [1], 2: [0, 2], 3: [0, 2, 4], 4: [0, 1, 2, 4], 5: [0, 1, 2, 3, 4] };       // which fingers play 1..5 keys (0 = thumb)
  // thumb, index, middle, ring, little: bone lengths, thickness, where the finger leaves the palm (kx across, kz along) for a right hand seen from above
  const FINGERS = [
    { l: [1.45, 1.1], r: 0.38, kx: -2.2, kz: 2.2 },
    { l: [1.5, 0.95, 0.8], r: 0.33, kx: -1.35, kz: 0.2 },
    { l: [1.65, 1.05, 0.85], r: 0.34, kx: -0.45, kz: 0 },
    { l: [1.5, 0.98, 0.8], r: 0.32, kx: 0.45, kz: 0.15 },
    { l: [1.2, 0.72, 0.7], r: 0.28, kx: 1.35, kz: 0.45 },
  ];
  const ZK = 4.1;                                                        // where the knuckle line of a resting hand sits (the key edge is at 0)
  const skinMats = [];                                                   // every skin material, so the tone can be changed
  let skinHex = 0xe0b08c;
  const mkSkin = (rough = 0.62) => { const m = new T.MeshStandardMaterial({ color: skinHex, roughness: rough, metalness: 0, envMapIntensity: 0.5 }); skinMats.push(m); return m; };
  function palmGeometry() {                                              // outline seen from above: x across, y toward the wrist (negative); knuckle edge at 0
    const s = new T.Shape();
    s.moveTo(-1.95, -0.1); s.quadraticCurveTo(-1.95, 0.25, -1.55, 0.25); s.lineTo(1.65, 0.25); s.quadraticCurveTo(2.1, 0.25, 2.05, -0.3);
    s.lineTo(1.75, -2.6); s.quadraticCurveTo(1.55, -4.4, 0.6, -4.6); s.lineTo(-0.7, -4.6); s.quadraticCurveTo(-1.9, -4.4, -2.1, -3.0);
    s.quadraticCurveTo(-2.7, -1.9, -2.55, -0.9); s.quadraticCurveTo(-2.35, -0.2, -1.95, -0.1);
    const g = new T.ExtrudeGeometry(s, { depth: 0.5, bevelEnabled: true, bevelThickness: 0.25, bevelSize: 0.22, bevelSegments: 5, curveSegments: 14 });
    g.rotateX(-Math.PI / 2);                                             // (x, y, z) -> (x, z, -y): the shape's negative y (toward the wrist) lands at positive world z
    return g;
  }
  const palmGeo = palmGeometry();
  const handObjs = [0, 1].map(h => {
    const g = new T.Group(); g.visible = false; scene.add(g);
    const skin = mkSkin(), nailMat = new T.MeshStandardMaterial({ color: 0xf4d9cf, roughness: 0.3, metalness: 0 });
    const palm = new T.Mesh(palmGeo, skin); g.add(palm);
    const arm = new T.Mesh(new T.CylinderGeometry(1.15, 1.4, 7, 24), skin); arm.rotation.x = Math.PI / 2; g.add(arm);                // tapered wrist and forearm along z
    const fingers = FINGERS.map(F => {
      const n = F.l.length, tipMat = mkSkin(0.55), parts = [], knuckle = new T.Mesh(new T.SphereGeometry(F.r * 1.12, 16, 12), skin);
      g.add(knuckle);
      for (let k = 0; k < n; k++) {
        const r = F.r * (1 - 0.07 * k), mesh = new T.Mesh(new T.CapsuleGeometry(r, F.l[k], 6, 14), k === n - 1 ? tipMat : skin);
        g.add(mesh); parts.push(mesh);
      }
      const nail = new T.Mesh(new T.SphereGeometry(F.r * 0.62, 12, 10), nailMat);
      nail.scale.set(0.95, 0.28, 1.15); nail.position.set(0, F.l[n - 1] / 2 - F.r * 0.1, F.r * 0.62); parts[n - 1].add(nail);          // a nail on top of the last bone
      return { parts, knuckle, tipMat, x: 0, y: 1, z: 2 };
    });
    return { g, palm, arm, fingers, cx: h ? -4 : 4, ready: false, h };
  });
  function setSkin(hex) { skinHex = new T.Color(hex).getHex(); for (const m of skinMats) m.color.setHex(skinHex); }
  function capsuleBetween(mesh, a, b) {
    tmpD.subVectors(b, a); const len = tmpD.length() || 1e-3;
    mesh.position.copy(a).addScaledVector(tmpD, 0.5); mesh.quaternion.setFromUnitVectors(UP, tmpD.multiplyScalar(1 / len));
  }
  // two bones l1 then l2 from K to T with the middle joint arched upward (a finger bends up at its middle joint, not sideways)
  function ik2(K, T3, l1, l2, E) {
    tmpD.subVectors(T3, K); let dist = tmpD.length(); dist = Math.min(l1 + l2 - 0.02, Math.max(Math.abs(l1 - l2) + 0.05, dist)); tmpD.normalize();
    const x = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist), hgt = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    tmpP.set(0, 1, 0).addScaledVector(tmpD, -tmpD.y);
    if (tmpP.lengthSq() < 1e-4) tmpP.set(0, 0, 1);
    tmpP.normalize();
    E.copy(K).addScaledVector(tmpD, x).addScaledVector(tmpP, hgt);
  }
  function updateHands(dt, act, next) {
    const k = 1 - Math.exp(-dt * 12);
    handObjs.forEach((o, h) => {
      const pressing = act[h].length > 0, sx = h ? -1 : 1;                // the left hand is the right hand mirrored
      let ks = (pressing ? act[h] : next[h].ks).slice().sort((a, b) => a - b);
      if (ks.length > 5) ks = [0, 1, 2, 3, 4].map(i => ks[Math.round(i * (ks.length - 1) / 4)]);
      if (h === 1) ks.reverse();                                            // left hand: thumb on the highest key
      let tx = o.cx; if (ks.length) tx = ks.reduce((a, m) => a + keys[m].x, 0) / ks.length;
      if (!o.ready) { o.cx = tx; o.ready = true; }
      o.cx += (tx - o.cx) * k;
      const slots = PATTERN[ks.length] || [], assigned = {}; slots.forEach((f, i) => { assigned[f] = ks[i]; });
      const yK = pressing ? 1.0 : 1.2;                                       // the hand sinks a little when playing
      o.fingers.forEach((f, i) => {
        const F = FINGERS[i], m = assigned[i], key = m != null ? keys[m] : null, down = key && pressing;
        PK.set(o.cx + sx * F.kx, yK, ZK + F.kz);                            // where this finger leaves the palm
        const restZ = ZK + F.kz - (i === 0 ? 1.7 : 2.55), tX = key ? key.x : PK.x, tY = key ? (down ? (key.black ? 0.78 : 0.42) : 1.0) : 0.8, tZ = key ? (key.black ? 1.2 : 1.7) : restZ;
        f.x += (tX - f.x) * k; f.y += (tY - f.y) * k; f.z += (tZ - f.z) * k;
        PT.set(f.x, f.y, f.z);
        f.knuckle.position.copy(PK);
        if (FINGERS[i].l.length === 2) {                                    // thumb: two bones
          ik2(PK, PT, F.l[0], F.l[1], PE);
          capsuleBetween(f.parts[0], PK, PE); capsuleBetween(f.parts[1], PE, PT);
        } else {                                                            // finger: three bones; the last two share the second bone of the arch
          ik2(PK, PT, F.l[0], F.l[1] + F.l[2], PE);
          PD.lerpVectors(PE, PT, F.l[1] / (F.l[1] + F.l[2])); PD.y -= 0.1;      // a slight curl at the last joint
          capsuleBetween(f.parts[0], PK, PE); capsuleBetween(f.parts[1], PE, PD); capsuleBetween(f.parts[2], PD, PT);
        }
        if (down) { f.tipMat.emissive.setHex(HAND[h]); f.tipMat.emissiveIntensity = 0.55; } else { f.tipMat.emissive.setHex(0); f.tipMat.emissiveIntensity = 1; }
      });
      o.palm.scale.x = sx; o.palm.position.set(o.cx, yK - 0.45, ZK + 0.35);        // the knuckle edge of the palm sits just behind the finger roots
      o.arm.position.set(o.cx, yK - 0.1, ZK + 6.7);
    });
    const gap = handObjs[0].cx - handObjs[1].cx;                            // keep the hands from sitting on top of each other
    if (gap < 4.4) { const d = (4.4 - gap) / 2; handObjs[0].cx += d; handObjs[1].cx -= d; }
  }

  let last = performance.now();
  function render(s) {
    const { p, notes, startIdx, transpose, allowed, letters, look, live, beatLen, loopA, loopB, lookAhead } = s;
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    const want = s.view === "tilt" ? "tilt" : "flat";
    if (want !== vmode) { vmode = want; placeCamera(); }
    zps = vmode === "flat" ? laneDepth / lookAhead : ZPS;           // straight down: fit the look-ahead into the screen height
    if (s.range) setRange(s.range[0], s.range[1]);
    if (Math.abs(view.tcx - view.cx) > 0.01 || Math.abs(view.thalf - view.half) > 0.01) {   // ease toward the new range
      view.cx += (view.tcx - view.cx) * 0.12; view.half += (view.thalf - view.half) * 0.12; placeCamera();
    }
    const active = new Map(), spec = look === "spectrum";
    const hAct = [[], []], hNext = [{ t: 0, ks: [] }, { t: 0, ks: [] }];       // for the hands: keys sounding now / the chord coming next
    let used = 0;
    for (let i = startIdx; i < notes.length; i++) {
      const n = notes[i]; if (n.t - p > lookAhead) break;
      const full = n.t + n.d; if (full < p) continue;
      // With the pedal view on, a note that rings on after its key was let go is two parts: the held key (solid) and the pedal ring (faint).
      // Pedal: "hide" (default) shows only the time the key is held, "ring" adds a faint tail for the pedal's sustain, "full" is one bar per note.
      const pm_ = s.pedal || "hide", split = pm_ !== "full" && n.kd != null && n.kd < n.d - 0.08, end = split ? n.t + n.kd : full;
      const pm = n.m + transpose, k = keys[pm]; if (!k) continue;
      if (s.showHands) {
        const hh = n.h === 1 ? 1 : 0;
        if (n.t <= p && end >= p) hAct[hh].push(pm);
        else if (n.t > p && n.t - p < 0.4) { const nx = hNext[hh]; if (!nx.ks.length || n.t < nx.t - 0.001) { nx.t = n.t; nx.ks = [pm]; } else if (n.t < nx.t + 0.1) nx.ks.push(pm); }
      }
      const dim = !allowed(n), w = k.black ? 0.5 : 0.84;
      const near = -Math.max(0, n.t - p) * zps, far = -Math.min(Math.max(end, p) - p, lookAhead) * zps;
      const { g, q } = noteGeo(w, Math.max(0.55, near - far)), zc = near - q / 2;
      const e = slot(used++), hex = spec ? spectrum[pm % 12] : HAND[n.h];
      e.tail.visible = false;
      if (split && pm_ === "ring") {
        const tn = -Math.max(0, end - p) * zps, tf = -Math.min(full - p, lookAhead) * zps, tl = Math.max(0.1, tn - tf);
        e.tail.visible = true; e.tail.material = tailMat(hex); e.tail.scale.set(w * 0.55, 0.3, tl); e.tail.position.set(k.x, 0.3, tn - tl / 2);
      }
      if (end < p) { e.box.visible = e.stripe.visible = e.label.visible = false; continue; }
      e.box.visible = true; e.box.geometry = g; e.box.material = noteMat(hex, dim, n.t <= p && !dim); e.box.position.set(k.x, 0.3, zc);
      e.stripe.visible = spec && !dim;
      if (e.stripe.visible) { e.stripe.material = noteMat(HAND[n.h], false); e.stripe.position.set(k.x, 0.3, zc); e.stripe.scale.set(w * 0.3, 0.54, q * 0.96); }
      e.label.visible = letters && !dim && w > 0.4;                       // every note gets its letter; on a short bar it is made smaller to fit
      if (e.label.visible) {
        const size = Math.min(0.85, w * 0.95, Math.max(0.3, q * 0.9));       // shrinks with the bar so a short note's letter stays on it
        e.label.material = labelMats[pm % 12]; e.label.scale.set(size, size, 1);
        e.label.position.set(k.x, 0.58, q > size * 1.4 ? near - size * 0.75 : zc);
      }
      if (n.t <= p && end >= p && !dim) active.set(pm, n.h);
    }
    for (let i = used; i < pool.length; i++) { const e = pool[i]; e.box.visible = e.stripe.visible = e.label.visible = e.tail.visible = false; }
    for (const [m, kk] of live) active.set(m, kk.h);
    for (const o of handObjs) o.g.visible = !!s.showHands;
    if (s.showHands) updateHands(dt, hAct, hNext);

    for (const m in keys) setKey(keys[m], active.has(+m) ? active.get(+m) : -1);
    let gi = 0;
    for (const [m, hand] of active) {
      const k = keys[m]; if (!k || gi >= glows.length) continue;
      const sp = glows[gi++]; sp.visible = true; sp.material.color.setHex(HAND[hand] ?? HAND[0]);
      sp.position.set(k.x, 0.6, 1.2); sp.scale.setScalar(k.black ? 4 : 5);
    }
    for (; gi < glows.length; gi++) glows[gi].visible = false;
    stepSparks(dt);

    const off = s.beatOff || 0, bar = s.bar || 4, b0 = Math.ceil((p - off) / beatLen - 1e-6);
    beatPool.forEach((b, j) => {
      const beat = b0 + j, d = off + beat * beatLen - p;
      b.visible = d >= 0 && d <= lookAhead && beat >= 0;
      if (b.visible) { b.position.set(0, 0, -d * zps); b.material = beat % bar === 0 ? beatBar : beatMinor; }
    });
    [loopA, loopB].forEach((t, j) => {
      const d = t == null ? -1 : t - p, m = loopMarks[j];
      m.visible = t != null && d >= 0 && d <= lookAhead; if (m.visible) m.position.set(0, 0.04, -d * zps);
    });
    composer.render();
  }

  // Hand colors are chosen by the player. Keys and sparks pick them up the next time they light.
  function setColors(r, l) {
    HAND[0] = new T.Color(r).getHex(); HAND[1] = new T.Color(l).getHex();
    for (const m in keys) keys[m].hand = -2;                 // forces each key to repaint with the new colors
  }
  return { render, resize, setColors, setSkin, dispose() { renderer.dispose(); el.remove(); } };
}
