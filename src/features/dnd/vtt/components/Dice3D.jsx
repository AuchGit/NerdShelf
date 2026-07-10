// 3D dice with REAL physics (cannon-es rigid bodies in a walled tray: gravity,
// wall/floor bounces, friction, tumbling) and NUMBERED faces.
//
// Correct results are guaranteed by PRE-SIMULATING: the whole throw is stepped
// invisibly to rest first (recording every frame), then we read which face of
// each die physically landed UP and put the rolled result's number on exactly
// that face (the remaining numbers fill the other faces). Only then is the
// recorded throw played back visibly — real physics, always a different roll
// (random spawn side / velocity / spin), and the up face always shows the true
// result.
//
// d4 exception: a tetrahedron rests apex-up (no face points up), so it keeps a
// small result chip; its faces are numbered cosmetically.
//
// three.js + cannon-es load lazily (own chunks, first roll only); any failure
// falls back to the tray's classic CSS dice via onFallback.
import { useEffect, useRef } from 'react';

const W = 324; const H = 262;            // canvas css size (fits the 362px tray widget)
const AREA_X = 3.15; const AREA_Z = 2.25; // inner wall half-extents — mehr Platz, kleinere Würfel im Bild
const MAX_SIM_STEPS = 900;               // 1/60s steps → 15s hard cap
const DIE_COLOR = { 4: '#ef5da8', 6: '#4ade80', 8: '#38bdf8', 10: '#a78bfa', 12: '#fb923c', 20: '#facc15', 100: '#f87171' };

// ── faced geometry ───────────────────────────────────────────────────────────
// A die is described as triangle clusters (one cluster = one logical face).
// `assemble` builds a BufferGeometry with one material group per cluster and
// per-face planar UVs (number texture centered on the face), plus the data the
// physics/labeling needs: each face's outward normal and its corner loop.

function assemble(THREE, clusters) {
  const positions = []; const normals = []; const uvs = [];
  const faces = []; const groups = [];
  for (const cl of clusters) {
    const n = new THREE.Vector3();
    for (const t of cl) n.add(new THREE.Vector3().subVectors(t.b, t.a).cross(new THREE.Vector3().subVectors(t.c, t.a)));
    n.normalize();
    // TRUE face centroid = average of the UNIQUE corners (a per-triangle
    // average double-counts the shared diagonal of kite/fan faces and pushes
    // the number off-centre — the exact d10 bug). Everything (centre, axes,
    // extent, UVs) is derived from the real polygon centre so the glyph sits
    // dead-centre on triangles, kites and pentagons alike.
    const uniq = [];
    for (const t of cl) for (const p of [t.a, t.b, t.c]) {
      if (!uniq.some((q) => q.distanceToSquared(p) < 1e-8)) uniq.push(p.clone());
    }
    const center = new THREE.Vector3();
    for (const p of uniq) center.add(p);
    center.divideScalar(uniq.length);
    // Normale MUSS nach AUSSEN zeigen (weg vom Solid-Zentrum bei 0). Die
    // handgebauten d10-Kites sind ALLE nach innen gewickelt → sonst werden ihre
    // Flächen per FrontSide weggecullt (dunkler/kaputter d10) UND cannon bekommt
    // falsche Kollisions-Normalen (andere Würfel fallen durch). `flip` dreht dann
    // auch die Dreiecks-Wicklung beim Ablegen um.
    const flip = n.dot(center) < 0;
    if (flip) n.multiplyScalar(-1);
    // Glyph-Ausrichtung wie auf echten Würfeln (nicht willkürlich schräg):
    //   • Kite (d10) → entlang der Symmetrieachse (cl._up)
    //   • ungerade Flächen (Dreieck/Fünfeck) → Oberkante zeigt zu einer Ecke
    //     (Basis parallel zur Gegenkante — d8/d20/d12-Look)
    //   • gerade Flächen (Quadrat/d6) → Oberkante zur Kantenmitte (achsparallel)
    let gUp;
    if (cl._up) gUp = cl._up.clone();
    else if (uniq.length % 2 === 1) gUp = new THREE.Vector3().subVectors(uniq[0], center);
    else gUp = new THREE.Vector3().addVectors(uniq[0], uniq[1]).multiplyScalar(0.5).sub(center);
    gUp.addScaledVector(n, -gUp.dot(n)); // in die Flächenebene projizieren
    if (gUp.lengthSq() < 1e-9) gUp.subVectors(uniq[0], center); // Fallback
    const v0 = gUp.normalize();
    // u0 = v0 × n  ⇒  n × u0 = v0 (gleiche Händigkeit wie zuvor → Text nicht gespiegelt)
    const u0 = new THREE.Vector3().crossVectors(v0, n).normalize();
    // Getrennte Halb-Ausdehnungen entlang u0 (Breite) und v0 (Länge).
    let extU = 0; let extV = 0;
    for (const p of uniq) {
      const d = new THREE.Vector3().subVectors(p, center);
      extU = Math.max(extU, Math.abs(d.dot(u0)));
      extV = Math.max(extV, Math.abs(d.dot(v0)));
    }
    // WICHTIG für den d10: die Kite-Fläche ist lang & schmal. Mit EINER
    // gemeinsamen (max) Ausdehnung würde die schmale u-Richtung die Zahl auf
    // einen dünnen vertikalen Streifen stauchen → genau die „zerlaufenen"
    // d10/d100-Zahlen. Beim Kite (cl._up) skalieren wir daher BEIDE Achsen mit
    // der schmalen Breite (quadratisch, mittig, unverzerrt). Alle anderen
    // Flächen sind ~gleichseitig → gemeinsame max-Ausdehnung wie bisher.
    const s = cl._up ? extU : Math.max(extU, extV);
    const start = positions.length / 3;
    for (const t of cl) {
      // Bei geflippter Normale die Wicklung mitdrehen (a, c, b), damit die
      // sichtbare Vorderseite zur (jetzt äußeren) Normale passt.
      const verts = flip ? [t.a, t.c, t.b] : [t.a, t.b, t.c];
      for (const p of verts) {
        positions.push(p.x, p.y, p.z);
        normals.push(n.x, n.y, n.z);
        const d = new THREE.Vector3().subVectors(p, center);
        uvs.push(0.5 + d.dot(u0) / (2.3 * s), 0.5 + d.dot(v0) / (2.3 * s));
      }
    }
    groups.push({ start, count: cl.length * 3, materialIndex: faces.length });
    // Per-Ecke auch die UV merken — der d4 malt an jede Ecke eine eigene Zahl.
    const cornerUV = uniq.map((p) => {
      const d = new THREE.Vector3().subVectors(p, center);
      return [0.5 + d.dot(u0) / (2.3 * s), 0.5 + d.dot(v0) / (2.3 * s)];
    });
    faces.push({ normal: n.clone(), corners: uniq, cornerUV });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  for (const g of groups) geo.addGroup(g.start, g.count, g.materialIndex);
  return { geometry: geo, faces };
}

// Extract triangles from a built-in geometry and cluster them by normal
// (convex solid → same outward normal = same logical face).
function facedFromGeometry(THREE, baseGeo) {
  const src = baseGeo.index ? baseGeo.toNonIndexed() : baseGeo;
  const pos = src.getAttribute('position');
  const tris = [];
  for (let t = 0; t < pos.count / 3; t++) {
    const a = new THREE.Vector3().fromBufferAttribute(pos, t * 3);
    const b = new THREE.Vector3().fromBufferAttribute(pos, t * 3 + 1);
    const c = new THREE.Vector3().fromBufferAttribute(pos, t * 3 + 2);
    tris.push({ a, b, c, n: new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize() });
  }
  const clusters = [];
  for (const tri of tris) {
    let cl = clusters.find((x) => x._n.dot(tri.n) > 0.999);
    if (!cl) { cl = Object.assign([], { _n: tri.n.clone() }); clusters.push(cl); }
    cl.push(tri);
  }
  return assemble(THREE, clusters);
}

// Proper d10 (pentagonal trapezohedron), built manually with EXPLICIT kite
// clusters. For a REAL trapezohedron each kite must be PLANAR — that only holds
// when the zig-zag equator height is exactly h = H·(1−cos36°)/(1+cos36°) and the
// kite's centre (outer tip) sits on the OPPOSITE side of the equator from its
// apex. Getting that sign wrong bends every face out of plane → smeared numbers
// AND a broken collision hull (other dice tunnel straight through it).
function facedD10(THREE) {
  const H = 0.78;
  const c = Math.cos(Math.PI / 5);            // cos 36°
  const h = H * (1 - c) / (1 + c);            // planar-kite equator height
  const R = 0.62;
  const apexT = new THREE.Vector3(0, H, 0);
  const apexB = new THREE.Vector3(0, -H, 0);
  const eq = [];
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5;
    // even verts (top-kite centres) sit BELOW the equator, odd verts ABOVE.
    eq.push(new THREE.Vector3(Math.cos(a) * R, (i % 2 ? h : -h), Math.sin(a) * R));
  }
  const E = (i) => eq[(i + 10) % 10];
  const clusters = [];
  // Each kite carries its symmetry axis (pole apex → outer equator tip) as
  // `_up`, so the number is drawn UPRIGHT along the kite instead of slanted.
  for (let i = 0; i < 10; i += 2) { // top kites centered on the "up" equator verts
    const cl = [{ a: apexT, b: E(i - 1), c: E(i) }, { a: apexT, b: E(i), c: E(i + 1) }];
    cl._up = E(i).clone().sub(apexT); // apex (up) → outer tip (down): glyph baseline down
    clusters.push(cl);
  }
  for (let i = 1; i < 10; i += 2) { // bottom kites centered on the "down" verts
    const cl = [{ a: apexB, b: E(i), c: E(i - 1) }, { a: apexB, b: E(i + 1), c: E(i) }];
    cl._up = E(i).clone().sub(apexB);
    clusters.push(cl);
  }
  return assemble(THREE, clusters);
}

function facedDieFor(THREE, sides) {
  switch (sides) {
    case 4: return facedFromGeometry(THREE, new THREE.TetrahedronGeometry(0.74));
    case 6: return facedFromGeometry(THREE, new THREE.BoxGeometry(0.9, 0.9, 0.9));
    case 8: return facedFromGeometry(THREE, new THREE.OctahedronGeometry(0.7));
    case 12: return facedFromGeometry(THREE, new THREE.DodecahedronGeometry(0.66));
    case 20: return facedFromGeometry(THREE, new THREE.IcosahedronGeometry(0.68));
    default: return facedD10(THREE); // d10 / d100
  }
}

// Physics hull from the geometry's raw triangles (triangles are always planar,
// so cannon's ConvexPolyhedron is happy regardless of kite planarity).
function hullFor(THREE, CANNON, geometry) {
  const pos = geometry.getAttribute('position');
  const verts = [];
  const findV = (x, y, z) => {
    for (let k = 0; k < verts.length; k++) {
      const v = verts[k];
      if ((v.x - x) ** 2 + (v.y - y) ** 2 + (v.z - z) ** 2 < 1e-6) return k;
    }
    verts.push(new CANNON.Vec3(x, y, z));
    return verts.length - 1;
  };
  const faces = [];
  for (let t = 0; t < pos.count / 3; t++) {
    const i0 = findV(pos.getX(t * 3), pos.getY(t * 3), pos.getZ(t * 3));
    const i1 = findV(pos.getX(t * 3 + 1), pos.getY(t * 3 + 1), pos.getZ(t * 3 + 1));
    const i2 = findV(pos.getX(t * 3 + 2), pos.getY(t * 3 + 2), pos.getZ(t * 3 + 2));
    if (i0 !== i1 && i1 !== i2 && i0 !== i2) faces.push([i0, i1, i2]);
  }
  return new CANNON.ConvexPolyhedron({ vertices: verts, faces });
}

// Number texture: coloured face with soft spherical shading + a defined bevel
// edge, and an ENGRAVED-looking centered number (highlight + shadow give depth
// instead of a flat painted glyph). An underline bar sits under any number that
// contains a 6 or 9 (6, 9, 16, 60, 69, 90, 96, …) so its orientation is
// unambiguous — exactly as on real dice. Cached globally per label|color.
// How much of a face a glyph may fill — smaller on faces that taper to points
// (triangles/kites) than on the roomy d6 square, so numbers never spill over
// the edges. Keyed by die sides (d100 uses the d10 body).
const GLYPH_FIT = { 4: 0.74, 6: 1.0, 8: 0.66, 10: 0.8, 12: 0.86, 20: 0.58, 100: 0.8 };

const texCache = new Map();
const SZ = 256;
function numberTexture(THREE, label, color, fit = 0.85) {
  const key = `${label}|${color}|${fit}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas'); c.width = c.height = SZ;
  const ctx = c.getContext('2d');
  // base colour
  ctx.fillStyle = color; ctx.fillRect(0, 0, SZ, SZ);
  // spherical shading: light from top-left, shadow bottom-right → curved feel.
  // NO painted rectangular border — faces are triangles/kites/pentagons, a
  // square frame would never line up; the real facet edges come from the 3D
  // EdgesGeometry overlay instead.
  const sh = ctx.createRadialGradient(SZ * 0.36, SZ * 0.32, SZ * 0.08, SZ * 0.52, SZ * 0.54, SZ * 0.78);
  sh.addColorStop(0, 'rgba(255,255,255,0.20)');
  sh.addColorStop(0.5, 'rgba(255,255,255,0.0)');
  sh.addColorStop(1, 'rgba(0,0,0,0.30)');
  ctx.fillStyle = sh; ctx.fillRect(0, 0, SZ, SZ);
  // number: bright ivory glyph with a thin dark outline + soft drop shadow →
  // high contrast on any die colour, crisp and readable, not a fat painted blob.
  const s = String(label);
  const base = s.length > 2 ? 0.40 : s.length > 1 ? 0.5 : 0.58;
  const fs = Math.round(SZ * base * fit);
  ctx.font = `600 ${fs}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const cx = SZ / 2; const cy = SZ * 0.47;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = SZ * 0.03; ctx.shadowOffsetY = SZ * 0.012;
  ctx.lineJoin = 'round';
  ctx.lineWidth = fs * 0.09;
  ctx.strokeStyle = 'rgba(20,22,28,0.85)';
  ctx.strokeText(s, cx, cy);
  ctx.restore();
  ctx.fillStyle = '#f4f1e8'; // ivory
  ctx.fillText(s, cx, cy);
  // underline for 6/9-containing labels so orientation is unambiguous
  if (/[69]/.test(s)) {
    const w = Math.min(SZ * 0.52, fs * s.length * 0.5);
    ctx.strokeStyle = 'rgba(20,22,28,0.85)';
    ctx.lineWidth = SZ * 0.02;
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, cy + fs * 0.52);
    ctx.lineTo(cx + w / 2, cy + fs * 0.52);
    ctx.stroke();
    ctx.strokeStyle = '#f4f1e8'; ctx.lineWidth = SZ * 0.012;
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, cy + fs * 0.52);
    ctx.lineTo(cx + w / 2, cy + fs * 0.52);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  // Ohne sRGB-Markierung interpretiert three die Canvas-Farben als linear
  // → überbelichtet/ausgebrannt ("brennende" Würfel).
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  texCache.set(key, tex);
  if (texCache.size > 400) texCache.delete(texCache.keys().next().value);
  return tex;
}

// d4-Fläche: KEINE zentrierte Zahl, sondern an jeder der drei Ecken eine kleine
// Zahl (wie auf echten d4). Man liest die Zahl an der Spitze, die nach dem
// Fallen oben steht. `cornerUV`/`cornerNums` sind pro Ecke ausgerichtet; jede
// Zahl steht aufrecht, wenn IHRE Ecke oben ist (Oberkante zeigt zur Flächen-
// mitte). Nicht gecacht (jede Fläche ist einzigartig).
function d4FaceTexture(THREE, cornerUV, cornerNums, color) {
  const c = document.createElement('canvas'); c.width = c.height = SZ;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color; ctx.fillRect(0, 0, SZ, SZ);
  const sh = ctx.createRadialGradient(SZ * 0.4, SZ * 0.36, SZ * 0.06, SZ * 0.5, SZ * 0.5, SZ * 0.7);
  sh.addColorStop(0, 'rgba(255,255,255,0.18)');
  sh.addColorStop(0.5, 'rgba(255,255,255,0)');
  sh.addColorStop(1, 'rgba(0,0,0,0.30)');
  ctx.fillStyle = sh; ctx.fillRect(0, 0, SZ, SZ);
  const fs = Math.round(SZ * 0.2);
  ctx.font = `700 ${fs}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i < cornerUV.length; i++) {
    const px = cornerUV[i][0] * SZ;
    const py = (1 - cornerUV[i][1]) * SZ; // CanvasTexture flipY → v gespiegelt
    // Zahl von der Ecke ~42% Richtung Flächenmitte einrücken.
    const qx = px + (SZ / 2 - px) * 0.42;
    const qy = py + (SZ / 2 - py) * 0.42;
    // Glyph-Oberkante zeigt zur ECKE (nicht zur Mitte): steht diese Spitze oben,
    // ist die Zahl richtigrum lesbar.
    const dx = px - SZ / 2; const dy = py - SZ / 2; // Mitte → Ecke
    const ang = Math.atan2(dx, -dy); // lokales „oben" (0,−1) → (dx,dy)
    ctx.save();
    ctx.translate(qx, qy); ctx.rotate(ang);
    ctx.lineJoin = 'round'; ctx.lineWidth = fs * 0.12;
    ctx.strokeStyle = 'rgba(20,22,28,0.85)';
    ctx.strokeText(String(cornerNums[i]), 0, 0);
    ctx.fillStyle = '#f4f1e8';
    ctx.fillText(String(cornerNums[i]), 0, 0);
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Full value set for a die (as display strings). Percentile dice show 00–90
// (tens) or 0–9 (units); everything else 1…N.
function valueSet(sides, faceCount, faceSet) {
  if (faceSet === 'd100tens') return [0, 10, 20, 30, 40, 50, 60, 70, 80, 90];
  if (faceSet === 'd100units') return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const out = [];
  for (let n = 1; out.length < faceCount; n++) out.push(n);
  return out;
}

// Labels for a die, arranged like a REAL die: opposite faces sum to a constant
// (d6→7, d8→9, d20→21, d10→9, percentile-tens→90). The rolled `result` is
// placed on the physically-up face (guaranteed correct reading, no final flip);
// its opposite gets the complement; the remaining value pairs fill the other
// opposite-face pairs. `faces` carries each face's outward normal so we can find
// antipodal partners. d4 has no antipodal faces → falls back to a plain fill.
function labelsFor(faces, sides, result, upFace, faceSet) {
  const N = faces.length;
  const fmt = (v) => (faceSet === 'd100tens' ? String(v).padStart(2, '0') : String(v));
  const values = valueSet(sides, N, faceSet);
  const complementSum = values[0] + values[values.length - 1]; // e.g. 7, 9, 21, 90
  const oppOf = (i) => {
    let opp = -1; let best = -0.9; // require nearly antipodal normals
    for (let j = 0; j < N; j++) {
      if (j === i) continue;
      const d = -faces[i].normal.dot(faces[j].normal);
      if (d > best) { best = d; opp = j; }
    }
    return opp;
  };
  const labels = new Array(N).fill(null);
  const remaining = values.slice();
  const take = (v) => { const k = remaining.indexOf(v); if (k >= 0) remaining.splice(k, 1); };
  const place = (face, v) => { labels[face] = v; take(v); };
  // result up + complement opposite
  place(upFace, result);
  const upOpp = oppOf(upFace);
  if (upOpp >= 0 && labels[upOpp] == null) place(upOpp, complementSum - result);
  // fill the rest, keeping opposite pairs complementary
  for (let i = 0; i < N; i++) {
    if (labels[i] != null) continue;
    const v = remaining[0];
    place(i, v);
    const opp = oppOf(i);
    if (opp >= 0 && labels[opp] == null) place(opp, complementSum - v);
  }
  return labels.map((v) => fmt(v));
}

export default function Dice3D({ dice, onFallback, onStatus, onDone }) {
  const hostRef = useRef(null);

  useEffect(() => {
    let disposed = false;
    let renderer; let raf = 0;
    // Sichtbare Diagnose: `started` = erster Frame wirklich gerendert. Bleibt
    // das aus, meldet der Watchdog sichtbar WO es hängt (statt still nichts).
    let started = false;
    let watchdog = 0;
    const host = hostRef.current;
    if (!host || !dice.length) return undefined;

    // Sofortiger WebGL-Probe-Check VOR den schweren Imports: wenn die
    // WebView kein WebGL2 hergibt (Grafiktreiber/HW-Beschleunigung aus),
    // fallen wir ohne 8s-Wartezeit sichtbar begründet zurück.
    try {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2') || probe.getContext('webgl');
      if (!gl) { onFallback?.('WebGL nicht verfügbar (Grafiktreiber / Hardware-Beschleunigung?)'); return undefined; }
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    } catch (e) { onFallback?.('WebGL-Check fehlgeschlagen: ' + (e?.message || e)); return undefined; }

    onStatus?.('Lade 3D-Module…');
    watchdog = setTimeout(() => {
      if (disposed || started) return;
      console.error('[vtt] 3D-Watchdog: kein Frame nach 12s');
      onStatus?.(null);
      onFallback?.('3D startet nicht (Watchdog 12s) — Stufe: siehe Statuszeile davor');
    }, 12000);
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('3D-Module laden nicht (Timeout nach 8s — Dev-Server neu starten?)')), 8000));
    Promise.race([Promise.all([import('three'), import('cannon-es')]), timeout]).then(([THREE, CANNON]) => {
      if (disposed || !hostRef.current) return;
      onStatus?.('Initialisiere Szene…');
      try {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      } catch (e) { console.error('[vtt] WebGL für 3D-Würfel nicht verfügbar', e); onFallback?.('WebGL-Kontext fehlgeschlagen: ' + (e?.message || e)); return; }
      try {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(W, H);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.92; // etwas dunkler → keine ausgebrannten Flächen
      renderer.domElement.style.display = 'block';
      host.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(36, W / H, 0.1, 50);
      camera.position.set(0, 7.6, 3.1); // etwas weiter weg → Würfel kleiner, mehr Tray sichtbar
      camera.lookAt(0, 0, 0.05);

      // ── lighting: soft sky/ground + warm key (shadow) + cool fill + rim ──
      scene.add(new THREE.HemisphereLight(0x9fb4d8, 0x151820, 0.5));
      scene.add(new THREE.AmbientLight(0xffffff, 0.24));
      const keyL = new THREE.DirectionalLight(0xfff2df, 0.9);
      keyL.position.set(-3.2, 8.5, 4);
      keyL.castShadow = true;
      keyL.shadow.mapSize.set(1024, 1024);
      keyL.shadow.bias = -0.0007;
      keyL.shadow.camera.near = 1; keyL.shadow.camera.far = 24;
      keyL.shadow.camera.left = -5.2; keyL.shadow.camera.right = 5.2;
      keyL.shadow.camera.top = 5.2; keyL.shadow.camera.bottom = -5.2;
      scene.add(keyL);
      const fillL = new THREE.DirectionalLight(0x8fbcff, 0.3);
      fillL.position.set(4, 3.5, 5);
      scene.add(fillL);
      const rimL = new THREE.DirectionalLight(0xffffff, 0.35);
      rimL.position.set(0, 3, -6); // backlight → crisp edges on the up faces
      scene.add(rimL);

      // ── 3D tray model: felt floor + wooden rim (real geometry, casts/receives
      // shadows) so the dice sit in a proper little tray instead of empty space.
      const feltMat = new THREE.MeshStandardMaterial({ color: 0x1b2130, roughness: 0.98, metalness: 0.0 });
      const felt = new THREE.Mesh(new THREE.PlaneGeometry(2 * (AREA_X + 0.18), 2 * (AREA_Z + 0.18)), feltMat);
      felt.rotation.x = -Math.PI / 2; felt.position.y = 0.001; felt.receiveShadow = true;
      scene.add(felt);
      const rimMat = new THREE.MeshStandardMaterial({ color: 0x3b3128, roughness: 0.55, metalness: 0.18 });
      const t = 0.22; // rim thickness
      const addRim = (w, h, d, x, z) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), rimMat);
        m.position.set(x, h / 2, z); m.castShadow = true; m.receiveShadow = true;
        scene.add(m);
      };
      const sideH = 0.72; const frontH = 0.44; // höhere Holzränder, Front-Lippe bleibt niedriger
      addRim(t, sideH, 2 * AREA_Z + 2 * t, -AREA_X - t / 2, 0);          // left
      addRim(t, sideH, 2 * AREA_Z + 2 * t, AREA_X + t / 2, 0);           // right
      addRim(2 * AREA_X + 2 * t, sideH, t, 0, -AREA_Z - t / 2);          // back
      addRim(2 * AREA_X + 2 * t, frontH, t, 0, AREA_Z + t / 2);          // front (low)

      // Kamera-Distanz automatisch so wählen, dass das GANZE Tray (inkl.
      // aller Holzränder) mit etwas Rand im Canvas liegt — die handgetunte
      // Distanz oben ist nur der Startwert; je nach Seitenverhältnis wurden
      // sonst Ränder beschnitten.
      {
        const lookTarget = new THREE.Vector3(0, 0, 0.05);
        const dir = camera.position.clone().normalize();
        const corners = [];
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [0, sideH]) {
          corners.push(new THREE.Vector3(sx * (AREA_X + t), y, sz * (AREA_Z + t)));
        }
        for (let d = camera.position.length(); d < 30; d += 0.1) {
          camera.position.copy(dir).multiplyScalar(d);
          camera.lookAt(lookTarget);
          camera.updateMatrixWorld(true);
          const fits = corners.every((c) => {
            const p = c.clone().project(camera);
            return Math.abs(p.x) <= 0.94 && Math.abs(p.y) <= 0.94;
          });
          if (fits) break;
        }
      }

      // ── physics world: floor + 4 walls (dice bounce off the tray edges) ──
      const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -26, 0) });
      world.allowSleep = true;
      // Mehr Solver-Iterationen → tiefe Durchdringungen werden sauber
      // aufgelöst, Würfel fallen nicht mehr ineinander.
      world.solver.iterations = 24;
      world.solver.tolerance = 0.001;
      const matDie = new CANNON.Material('die');
      const matWorld = new CANNON.Material('world');
      world.addContactMaterial(new CANNON.ContactMaterial(matDie, matWorld, { restitution: 0.3, friction: 0.32 }));
      // Sehr GLATTER Würfel-zu-Würfel-Kontakt: ein Würfel, der auf einem anderen
      // landet, rutscht wieder herunter statt oben liegen zu bleiben (keine
      // physikalisch unsinnigen Stapel).
      world.addContactMaterial(new CANNON.ContactMaterial(matDie, matDie, { restitution: 0.2, friction: 0.02 }));
      const addPlane = (nx, ny, nz, px, py, pz) => {
        const b = new CANNON.Body({ type: CANNON.Body.STATIC, shape: new CANNON.Plane(), material: matWorld });
        b.quaternion.setFromVectors(new CANNON.Vec3(0, 0, 1), new CANNON.Vec3(nx, ny, nz));
        b.position.set(px, py, pz);
        world.addBody(b);
      };
      addPlane(0, 1, 0, 0, 0, 0);        // floor
      addPlane(1, 0, 0, -AREA_X, 0, 0);  // left wall
      addPlane(-1, 0, 0, AREA_X, 0, 0);  // right wall
      addPlane(0, 0, 1, 0, 0, -AREA_Z);  // back wall
      addPlane(0, 0, -1, 0, 0, AREA_Z);  // front wall

      // ── dice bodies with a fresh random throw every roll ──
      const shown = dice.slice(0, 12);
      const bodies = shown.map((d, i) => {
        const { geometry, faces } = facedDieFor(THREE, d.sides);
        const shape = hullFor(THREE, CANNON, geometry);
        // Spawn spread over the tray on an even ring (no two dice at the same
        // spot) and clearly STACKED in height, so nothing starts interpenetrated
        // — then hurl each across the tray to tumble. Different every time.
        const ang = (i / Math.max(1, shown.length)) * Math.PI * 2 + Math.random() * 0.6;
        const sx = Math.cos(ang) * (AREA_X - 0.7);
        const sz = Math.sin(ang) * (AREA_Z - 0.55);
        const body = new CANNON.Body({
          mass: 1, shape, material: matDie, allowSleep: true,
          sleepSpeedLimit: 0.5, sleepTimeLimit: 0.3,
          position: new CANNON.Vec3(sx, 1.4 + i * 0.85, sz), // big Y-gap → no overlap
          velocity: new CANNON.Vec3(
            -sx * (1.6 + Math.random() * 1.6) + (Math.random() - 0.5) * 3,
            1 + Math.random() * 2.5,
            -sz * (1.6 + Math.random() * 1.6) + (Math.random() - 0.5) * 3,
          ),
          angularVelocity: new CANNON.Vec3((Math.random() - 0.5) * 28, (Math.random() - 0.5) * 28, (Math.random() - 0.5) * 28),
        });
        body.quaternion.setFromEuler(Math.random() * 6, Math.random() * 6, Math.random() * 6);
        world.addBody(body);
        return { die: d, body, geometry, faces, frames: [] };
      });

      // ── PRE-SIMULATE to rest, recording every frame ──
      let steps = 0;
      while (steps < MAX_SIM_STEPS) {
        world.step(1 / 60);
        steps += 1;
        let calm = true;
        for (const b of bodies) {
          b.frames.push([
            b.body.position.x, b.body.position.y, b.body.position.z,
            b.body.quaternion.x, b.body.quaternion.y, b.body.quaternion.z, b.body.quaternion.w,
          ]);
          // Liegt ein Würfel zu HOCH (Mitte > 0.8), ruht er vermutlich auf einem
          // anderen → wach halten und NICHT als „ruhig" zählen, damit er (mit dem
          // glatten Würfel-Kontakt) herunterrutscht statt oben liegen zu bleiben.
          if (b.body.position.y > 0.8) { b.body.wakeUp?.(); calm = false; continue; }
          if (b.body.sleepState !== CANNON.Body.SLEEPING
            && (b.body.velocity.length() > 0.08 || b.body.angularVelocity.length() > 0.08)) calm = false;
        }
        if (calm && steps > 60) break; // etwas länger simulieren → wirklich flach ausgerollt
      }

      // ── read each die's physical up-face and label it with the true result ──
      const up = new THREE.Vector3(0, 1, 0);
      for (const b of bodies) {
        let fq = b.frames[b.frames.length - 1];
        const quat = new THREE.Quaternion(fq[3], fq[4], fq[5], fq[6]);
        let bestFace = 0; let bestDot = -2;
        b.faces.forEach((f, i) => {
          const dot = f.normal.clone().applyQuaternion(quat).dot(up);
          if (dot > bestDot) { bestDot = dot; bestFace = i; }
        });
        // Liegt der Würfel nicht sauber flach (>~25° gekippt, an Wand/Würfel
        // angelehnt)? → die Ergebnis-Fläche rollt SANFT flach nach oben
        // (ease-in-out über ~0,5s, sieht aus wie natürliches Aussetzen, kein
        // hartes Snappen). d4 ruht mit Spitze oben.
        if (b.die.sides !== 4 && bestDot < 0.9) {
          const worldN = b.faces[bestFace].normal.clone().applyQuaternion(quat);
          const qFlat = new THREE.Quaternion().setFromUnitVectors(worldN, up).multiply(quat);
          const posAttr = b.geometry.getAttribute('position');
          let minY = Infinity;
          const v = new THREE.Vector3();
          for (let k = 0; k < posAttr.count; k++) {
            v.fromBufferAttribute(posAttr, k).applyQuaternion(qFlat);
            if (v.y < minY) minY = v.y;
          }
          const yFlat = -minY + 0.005;
          const qFrom = quat.clone();
          const K = 32; // langsamer, sanfter Kipp statt hartem Snap
          for (let k = 1; k <= K; k++) {
            const t = k / K;
            const e = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2; // ease-in-out
            const q = qFrom.clone().slerp(qFlat, e);
            b.frames.push([fq[0], fq[1] + (yFlat - fq[1]) * e, fq[2], q.x, q.y, q.z, q.w]);
          }
          fq = b.frames[b.frames.length - 1];
        }
        // Verworfener Würfel (Vorteil/Nachteil: der nicht gewertete d20) → grau.
        const color = b.die.dropped ? '#6b7280'
          : b.die.faceSet ? DIE_COLOR[100] : (DIE_COLOR[b.die.sides] || '#8899ff');
        // Mattere Beschichtung (weniger Clearcoat) → keine ausgebrannten
        // Glanz-Hotspots mehr ("brennende" Flächen).
        const matOf = (map) => new THREE.MeshPhysicalMaterial({
          map, roughness: 0.5, metalness: 0.0, clearcoat: 0.28, clearcoatRoughness: 0.45,
        });
        if (b.die.sides === 4) {
          // d4: an jede Ecke jeder Fläche eine Zahl; die Zahl an der oben
          // stehenden SPITZE ist das Ergebnis. Vier Eckwerte, Ergebnis auf die
          // nach dem Fallen oben liegende Ecke.
          const V4 = [];
          for (const f of b.faces) for (const cc of f.corners) {
            if (!V4.some((q) => q.distanceToSquared(cc) < 1e-6)) V4.push(cc.clone());
          }
          const qNow = new THREE.Quaternion(fq[3], fq[4], fq[5], fq[6]);
          let upV = 0; let upY = -Infinity;
          V4.forEach((vv, i) => { const y = vv.clone().applyQuaternion(qNow).y; if (y > upY) { upY = y; upV = i; } });
          const nums = new Array(V4.length);
          nums[upV] = b.die.result;
          const pool = [1, 2, 3, 4].filter((nn) => nn !== b.die.result);
          let pj = 0;
          for (let i = 0; i < V4.length; i++) if (i !== upV) nums[i] = pool[pj++];
          const idxOf = (p) => { let bi = 0; let bd = Infinity; V4.forEach((q, i) => { const dd = q.distanceToSquared(p); if (dd < bd) { bd = dd; bi = i; } }); return bi; };
          b.mesh = new THREE.Mesh(b.geometry, b.faces.map((f) => matOf(
            d4FaceTexture(THREE, f.cornerUV, f.corners.map((cc) => nums[idxOf(cc)]), color),
          )));
        } else {
          const fit = GLYPH_FIT[b.die.sides] ?? 0.82;
          const labels = labelsFor(b.faces, b.die.sides, b.die.result, bestFace, b.die.faceSet);
          b.mesh = new THREE.Mesh(b.geometry, labels.map((l) => matOf(numberTexture(THREE, l, color, fit))));
        }
        b.mesh.castShadow = true; b.mesh.receiveShadow = true;
        // Dark edge lines make the facet boundaries clearly readable.
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(b.geometry, 12),
          new THREE.LineBasicMaterial({ color: 0x0a0c10, transparent: true, opacity: 0.7 }),
        );
        b.mesh.add(edges);
        scene.add(b.mesh);
      }

      // ── visible playback of the recorded throw ──
      // t0 = Timestamp des ERSTEN Ticks (nicht performance.now() bei der
      // Registrierung): rAF-Timestamps können in der WebView davor liegen,
      // ft wurde dann negativ → frames[-1] = undefined → Crash im ersten
      // Frame (genau der "keine Animation"-Bug).
      let t0 = null;
      const qa = new THREE.Quaternion(); const qb = new THREE.Quaternion();
      const tick = (now) => {
        if (disposed) return;
        try {
        if (t0 == null) t0 = now;
        const ft = Math.max(0, ((now - t0) / 1000) * 60);
        let done = true;
        for (const b of bodies) {
          const last = b.frames.length - 1;
          const i0 = Math.max(0, Math.min(last, Math.floor(ft)));
          const i1 = Math.min(last, i0 + 1);
          if (i1 < last) done = false;
          const a = b.frames[i0]; const c = b.frames[i1];
          if (!a || !c) continue;
          const t = Math.min(1, ft - i0);
          b.mesh.position.set(a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t);
          qa.set(a[3], a[4], a[5], a[6]); qb.set(c[3], c[4], c[5], c[6]);
          b.mesh.quaternion.copy(qa.slerp(qb, t));
        }
        renderer.render(scene, camera);
        if (!started) {
          // Erster Frame ist raus → Watchdog aus; kurze Bestätigung anzeigen,
          // damit "rendert, aber unsichtbar" von "rendert nie" unterscheidbar ist.
          started = true;
          clearTimeout(watchdog);
          onStatus?.('3D läuft…');
          setTimeout(() => { if (!disposed) onStatus?.(null); }, 1500);
        }
        if (!done) raf = requestAnimationFrame(tick);
        else onDone?.(); // Animation fertig → Tray darf das Gesamtergebnis zeigen
        } catch (e) {
          console.error('[vtt] 3D-Playback-Fehler', e);
          onStatus?.(null);
          onFallback?.('3D-Playback-Fehler: ' + (e?.message || e));
        }
      };
      raf = requestAnimationFrame(tick);
      } catch (e) {
        // Jede Init-Panne (Geometrie/Physik/Material) fällt sichtbar geloggt auf
        // die klassischen Würfel zurück statt stumm nichts zu zeigen.
        console.error('[vtt] 3D-Würfel-Init fehlgeschlagen', e);
        onFallback?.('3D-Init fehlgeschlagen: ' + (e?.message || e));
      }
    }).catch((e) => { console.error('[vtt] 3D-Würfel laden fehlgeschlagen', e); if (!disposed) onFallback?.(e?.message || String(e)); });

    return () => {
      disposed = true;
      clearTimeout(watchdog);
      onStatus?.(null);
      cancelAnimationFrame(raf);
      if (renderer) {
        renderer.dispose();
        // Each roll remounts the scene → actively release the WebGL context,
        // otherwise repeated rolls exhaust the browser's ~16-context limit.
        try { renderer.forceContextLoss(); } catch { /* ignore */ }
        renderer.domElement?.remove();
      }
    };
    // A roll is immutable — the component is remounted per roll via `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div style={{ position: 'relative', width: W, height: H, margin: '0 auto' }} ref={hostRef} />;
}
