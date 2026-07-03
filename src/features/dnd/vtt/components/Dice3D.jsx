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
import { useEffect, useRef, useState } from 'react';

const W = 214; const H = 150;            // canvas css size (tray inner width)
const AREA_X = 3.1; const AREA_Z = 2.05; // inner wall half-extents (world units)
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
    const center = new THREE.Vector3();
    const cornersRaw = [];
    for (const t of cl) for (const p of [t.a, t.b, t.c]) { center.add(p); cornersRaw.push(p); }
    center.divideScalar(cl.length * 3);
    const u0 = new THREE.Vector3().subVectors(cl[0].a, center).normalize();
    const v0 = new THREE.Vector3().crossVectors(n, u0).normalize();
    let ext = 0;
    for (const p of cornersRaw) {
      const d = new THREE.Vector3().subVectors(p, center);
      ext = Math.max(ext, Math.abs(d.dot(u0)), Math.abs(d.dot(v0)));
    }
    const start = positions.length / 3;
    for (const t of cl) {
      for (const p of [t.a, t.b, t.c]) {
        positions.push(p.x, p.y, p.z);
        normals.push(n.x, n.y, n.z);
        const d = new THREE.Vector3().subVectors(p, center);
        uvs.push(0.5 + d.dot(u0) / (2.3 * ext), 0.5 + d.dot(v0) / (2.3 * ext));
      }
    }
    groups.push({ start, count: cl.length * 3, materialIndex: faces.length });
    // unique corners ordered around the face center (for reference/debug; the
    // physics hull uses raw triangles, which are always planar)
    const uniq = [];
    for (const p of cornersRaw) if (!uniq.some((q) => q.distanceToSquared(p) < 1e-6)) uniq.push(p.clone());
    faces.push({ normal: n.clone(), corners: uniq });
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
// clusters — the sphere-normalisation of PolyhedronGeometry would bend the
// kites out of plane and break both clustering and labeling.
function facedD10(THREE) {
  const apexT = new THREE.Vector3(0, 0.74, 0);
  const apexB = new THREE.Vector3(0, -0.74, 0);
  const eq = [];
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5;
    eq.push(new THREE.Vector3(Math.cos(a) * 0.62, i % 2 ? -0.078 : 0.078, Math.sin(a) * 0.62));
  }
  const E = (i) => eq[(i + 10) % 10];
  const clusters = [];
  for (let i = 0; i < 10; i += 2) { // top kites centered on the "up" equator verts
    clusters.push([
      { a: apexT, b: E(i - 1), c: E(i) },
      { a: apexT, b: E(i), c: E(i + 1) },
    ]);
  }
  for (let i = 1; i < 10; i += 2) { // bottom kites centered on the "down" verts
    clusters.push([
      { a: apexB, b: E(i), c: E(i - 1) },
      { a: apexB, b: E(i + 1), c: E(i) },
    ]);
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

// Number texture: die-coloured background, dark centered number (underlined for
// 6/9 so orientation is readable). Cached globally per label|color.
const texCache = new Map();
function numberTexture(THREE, label, color) {
  const key = `${label}|${color}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color; ctx.fillRect(0, 0, 128, 128);
  const grad = ctx.createRadialGradient(64, 64, 30, 64, 64, 92);
  grad.addColorStop(0, 'rgba(255,255,255,0.10)');
  grad.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 128, 128);
  const s = String(label);
  ctx.fillStyle = '#181b22';
  ctx.font = `800 ${s.length > 2 ? 40 : s.length > 1 ? 52 : 62}px system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(s, 64, 64);
  if (s === '6' || s === '9') ctx.fillRect(46, 94, 36, 6);
  const tex = new THREE.CanvasTexture(c);
  // Ohne sRGB-Markierung interpretiert three die Canvas-Farben als linear
  // → überbelichtet/ausgebrannt ("brennende" Würfel).
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  texCache.set(key, tex);
  if (texCache.size > 300) texCache.delete(texCache.keys().next().value);
  return tex;
}

// Labels for a die: the rolled result goes on `upFace`; the rest of the number
// set fills the remaining faces in order (d100 shows multiples of 10).
function labelsFor(sides, faceCount, result, upFace) {
  const pool = [];
  for (let n = 1; pool.length < faceCount; n++) {
    const val = sides === 100 ? Math.min(100, n * 10) : n;
    if (val !== result) pool.push(val);
  }
  const labels = new Array(faceCount);
  labels[upFace] = result;
  let j = 0;
  for (let i = 0; i < faceCount; i++) if (i !== upFace) labels[i] = pool[j++];
  return labels;
}

export default function Dice3D({ dice, onFallback, onStatus }) {
  const hostRef = useRef(null);
  const [chips, setChips] = useState([]); // d4 result chips only

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
      renderer.domElement.style.display = 'block';
      host.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 50);
      camera.position.set(0, 6.6, 3.6); // steep-ish so the up faces read well
      camera.lookAt(0, 0, 0.1);
      scene.add(new THREE.AmbientLight(0xffffff, 0.75));
      const keyL = new THREE.DirectionalLight(0xffffff, 1.15);
      keyL.position.set(-2, 7, 3);
      scene.add(keyL);

      // ── physics world: floor + 4 walls (dice bounce off the tray edges) ──
      const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -26, 0) });
      world.allowSleep = true;
      const matDie = new CANNON.Material('die');
      const matWorld = new CANNON.Material('world');
      world.addContactMaterial(new CANNON.ContactMaterial(matDie, matWorld, { restitution: 0.42, friction: 0.22 }));
      world.addContactMaterial(new CANNON.ContactMaterial(matDie, matDie, { restitution: 0.35, friction: 0.15 }));
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
        // Spawn on a random side of the tray, hurled across it: dice fly, hit
        // the opposite wall, bounce and tumble — different every time.
        const ang = Math.random() * Math.PI * 2;
        const sx = Math.cos(ang) * (AREA_X - 0.7);
        const sz = Math.sin(ang) * (AREA_Z - 0.6);
        const body = new CANNON.Body({
          mass: 1, shape, material: matDie, allowSleep: true,
          sleepSpeedLimit: 0.55, sleepTimeLimit: 0.28,
          position: new CANNON.Vec3(sx, 1.6 + Math.random() * 1.6 + i * 0.4, sz),
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
          if (b.body.sleepState !== CANNON.Body.SLEEPING
            && (b.body.velocity.length() > 0.12 || b.body.angularVelocity.length() > 0.12)) calm = false;
        }
        if (calm && steps > 45) break;
      }

      // ── read each die's physical up-face and label it with the true result ──
      const up = new THREE.Vector3(0, 1, 0);
      const shadowGeo = new THREE.CircleGeometry(0.5, 24);
      const d4Chips = [];
      for (const b of bodies) {
        let fq = b.frames[b.frames.length - 1];
        const quat = new THREE.Quaternion(fq[3], fq[4], fq[5], fq[6]);
        let bestFace = 0; let bestDot = -2;
        b.faces.forEach((f, i) => {
          const dot = f.normal.clone().applyQuaternion(quat).dot(up);
          if (dot > bestDot) { bestDot = dot; bestFace = i; }
        });
        // Schräg liegengeblieben (an Wand/Würfel angelehnt oder gekippt
        // eingeschlafen)? → kurzer Kipp-Nachlauf ans Ende der Aufzeichnung:
        // der Würfel kippt sichtbar flach (beste Fläche exakt nach oben,
        // Grundhöhe auf dem Boden). d4 ausgenommen — der ruht mit Spitze
        // nach oben, da ist "keine Fläche oben" der Normalzustand.
        if (b.die.sides !== 4 && bestDot < 0.985) {
          const worldN = b.faces[bestFace].normal.clone().applyQuaternion(quat);
          const qFlat = new THREE.Quaternion().setFromUnitVectors(worldN, up).multiply(quat);
          // Ruhehöhe der flachen Pose: tiefster Geometrie-Punkt auf den Boden.
          const posAttr = b.geometry.getAttribute('position');
          let minY = Infinity;
          const v = new THREE.Vector3();
          for (let k = 0; k < posAttr.count; k++) {
            v.fromBufferAttribute(posAttr, k).applyQuaternion(qFlat);
            if (v.y < minY) minY = v.y;
          }
          const yFlat = -minY + 0.005;
          const qFrom = quat.clone();
          const K = 22;
          for (let k = 1; k <= K; k++) {
            const t = k / K;
            const e = 1 - (1 - t) * (1 - t); // ease-out
            const q = qFrom.clone().slerp(qFlat, e);
            b.frames.push([fq[0], fq[1] + (yFlat - fq[1]) * e, fq[2], q.x, q.y, q.z, q.w]);
          }
          fq = b.frames[b.frames.length - 1];
        }
        const color = DIE_COLOR[b.die.sides] || '#8899ff';
        const labels = labelsFor(b.die.sides, b.faces.length, b.die.result, bestFace);
        b.mesh = new THREE.Mesh(b.geometry, labels.map((l) => new THREE.MeshStandardMaterial({
          map: numberTexture(THREE, l, color), roughness: 0.32, metalness: 0.1,
        })));
        scene.add(b.mesh);
        b.shadow = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 }));
        b.shadow.rotation.x = -Math.PI / 2;
        b.shadow.position.y = 0.01;
        scene.add(b.shadow);
        if (b.die.sides === 4) {
          const v = new THREE.Vector3(fq[0], fq[1] + 0.5, fq[2]).project(camera);
          d4Chips.push({ x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H - 14, result: b.die.result, sides: 4 });
        }
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
          const hgt = Math.max(0, b.mesh.position.y - 0.4);
          b.shadow.position.x = b.mesh.position.x;
          b.shadow.position.z = b.mesh.position.z;
          const sc = Math.max(0.35, 1 - hgt * 0.18);
          b.shadow.scale.set(sc, sc, 1);
          b.shadow.material.opacity = 0.3 * sc;
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
        else if (d4Chips.length) setChips(d4Chips);
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

  return (
    <div style={{ position: 'relative', width: W, height: H, margin: '0 auto' }} ref={hostRef}>
      {chips.map((c, i) => (
        <span key={i} style={{ ...S.chip, left: c.x, top: c.y }}>
          {c.result}
          <span style={S.chipLabel}>d{c.sides}</span>
        </span>
      ))}
    </div>
  );
}

const S = {
  chip: {
    position: 'absolute', transform: 'translate(-50%, -100%)', padding: '1px 7px',
    background: 'color-mix(in srgb, var(--color-bg-elevated) 92%, transparent)',
    border: '1px solid var(--color-border)', borderRadius: 999,
    fontWeight: 800, fontSize: 14, color: 'var(--color-text)', pointerEvents: 'none',
    boxShadow: '0 2px 8px #0008', whiteSpace: 'nowrap',
  },
  chipLabel: { fontSize: 8, fontWeight: 600, color: 'var(--color-text-muted)', marginLeft: 3 },
};
