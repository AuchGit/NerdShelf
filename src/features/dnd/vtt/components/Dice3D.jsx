// 3D dice for the dice tray: real polyhedra (d4…d20) tumble, bounce and settle
// in a mini three.js scene. Purely COSMETIC — the results come from the tray's
// existing RNG; once a die comes to rest its number fades in as a DOM chip
// projected over the die (no face-texture mapping → a wrong face can never show).
// three.js is imported LAZILY so it lives in its own chunk and only loads on the
// first 3D roll; if the import/WebGL fails the tray falls back to the CSS dice.
import { useEffect, useRef, useState } from 'react';

const W = 214;   // canvas css size — matches the tray inner width
const H = 132;
const FLOOR_X = 3.4; // half-extent of the visible floor in world units
const FLOOR_Z = 1.7;

// Colours per die type (same palette as the classic tray dice).
const DIE_COLOR = { 4: 0xef5da8, 6: 0x4ade80, 8: 0x38bdf8, 10: 0xa78bfa, 12: 0xfb923c, 20: 0xfacc15, 100: 0xf87171 };

// Pentagonal trapezohedron (d10): two apexes + 10 alternating equator vertices;
// each kite face split into two triangles. Built once per three instance.
function d10Geometry(THREE) {
  const verts = [0, 1.05, 0, 0, -1.05, 0];
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5;
    verts.push(Math.cos(a) * 0.9, i % 2 ? -0.14 : 0.14, Math.sin(a) * 0.9);
  }
  const eq = (i) => 2 + ((i + 10) % 10);
  const faces = [];
  for (let i = 0; i < 10; i += 2) { // even equator verts sit "up" → top kites
    faces.push(0, eq(i - 1), eq(i), 0, eq(i), eq(i + 1));
  }
  for (let i = 1; i < 10; i += 2) { // odd verts sit "down" → bottom kites
    faces.push(1, eq(i), eq(i - 1), 1, eq(i + 1), eq(i));
  }
  const g = new THREE.PolyhedronGeometry(verts, faces, 0.62, 0);
  return g;
}

function geometryFor(THREE, sides) {
  switch (sides) {
    case 4: return new THREE.TetrahedronGeometry(0.72);
    case 6: return new THREE.BoxGeometry(0.92, 0.92, 0.92);
    case 8: return new THREE.OctahedronGeometry(0.68);
    case 12: return new THREE.DodecahedronGeometry(0.64);
    case 20: return new THREE.IcosahedronGeometry(0.66);
    default: return d10Geometry(THREE); // d10 + d100 (percentile shape)
  }
}

// Rest spots in a grid across the floor so multiple dice don't stack.
function restSpot(i, n) {
  const cols = Math.min(5, Math.max(1, n));
  const rows = Math.ceil(n / cols);
  const col = i % cols; const row = Math.floor(i / cols);
  const x = cols === 1 ? 0 : -FLOOR_X * 0.78 + (col / (cols - 1)) * FLOOR_X * 1.56;
  const z = rows === 1 ? 0.2 : -FLOOR_Z * 0.55 + (row / (rows - 1)) * FLOOR_Z * 1.1;
  return { x, z };
}

export default function Dice3D({ dice, onFallback }) {
  const hostRef = useRef(null);
  const [chips, setChips] = useState([]); // settled numbers: {x, y, result, sides}

  useEffect(() => {
    let disposed = false;
    let renderer; let raf = 0;
    const host = hostRef.current;
    if (!host || !dice.length) return undefined;

    import('three').then((THREE) => {
      if (disposed || !hostRef.current) return;
      try {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      } catch { onFallback?.(); return; }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(W, H);
      renderer.domElement.style.display = 'block';
      host.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 50);
      camera.position.set(0, 5.6, 5.2);
      camera.lookAt(0, 0, 0);
      scene.add(new THREE.AmbientLight(0xffffff, 0.75));
      const key = new THREE.DirectionalLight(0xffffff, 1.6);
      key.position.set(-2, 6, 3);
      scene.add(key);

      // Cheap contact shadows: a dark disc under each die, scaled by height.
      const shadowGeo = new THREE.CircleGeometry(0.5, 24);
      const mkShadow = () => {
        const m = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 }));
        m.rotation.x = -Math.PI / 2;
        m.position.y = 0.01;
        scene.add(m);
        return m;
      };

      const bodies = dice.slice(0, 12).map((d, i) => {
        const geo = geometryFor(THREE, d.sides);
        const mat = new THREE.MeshStandardMaterial({
          color: DIE_COLOR[d.sides] ?? 0x8899ff, roughness: 0.35, metalness: 0.15,
          flatShading: true,
        });
        const mesh = new THREE.Mesh(geo, mat);
        const spot = restSpot(i, Math.min(dice.length, 12));
        mesh.position.set(spot.x + (Math.random() - 0.5) * 1.2, 4.5 + Math.random() * 2 + i * 0.3, spot.z + (Math.random() - 0.5) * 0.8);
        mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
        scene.add(mesh);
        return {
          die: d, mesh, spot, shadow: mkShadow(),
          vy: -2 - Math.random() * 2,
          av: { x: (Math.random() - 0.5) * 14, y: (Math.random() - 0.5) * 14, z: (Math.random() - 0.5) * 14 },
          bounces: 0, settled: false, rest: 0.52,
        };
      });

      const G = -21;
      let last = performance.now();
      const settledChips = [];

      const tick = (now) => {
        if (disposed) return;
        const dt = Math.min(0.033, (now - last) / 1000);
        last = now;
        let allSettled = true;
        for (const b of bodies) {
          if (b.settled) continue;
          allSettled = false;
          // fall + bounce
          b.vy += G * dt;
          b.mesh.position.y += b.vy * dt;
          // glide toward the rest spot while airborne
          b.mesh.position.x += (b.spot.x - b.mesh.position.x) * 1.8 * dt;
          b.mesh.position.z += (b.spot.z - b.mesh.position.z) * 1.8 * dt;
          // tumble (decays with each bounce)
          b.mesh.rotation.x += b.av.x * dt;
          b.mesh.rotation.y += b.av.y * dt;
          b.mesh.rotation.z += b.av.z * dt;
          if (b.mesh.position.y <= b.rest && b.vy < 0) {
            b.mesh.position.y = b.rest;
            b.bounces += 1;
            b.vy = -b.vy * 0.42;
            b.av.x *= 0.45; b.av.y *= 0.45; b.av.z *= 0.45;
            if (b.bounces >= 3 || Math.abs(b.vy) < 1.2) {
              b.settled = true;
              b.mesh.position.y = b.rest;
              // project the die to canvas px for the number chip
              const v = b.mesh.position.clone().project(camera);
              settledChips.push({
                x: (v.x * 0.5 + 0.5) * W,
                y: (-v.y * 0.5 + 0.5) * H - 16,
                result: b.die.result, sides: b.die.sides,
              });
              setChips([...settledChips]);
            }
          }
          // shadow follows, shrinking with height
          const hgt = Math.max(0, b.mesh.position.y - b.rest);
          b.shadow.position.x = b.mesh.position.x;
          b.shadow.position.z = b.mesh.position.z;
          const sc = Math.max(0.35, 1 - hgt * 0.16);
          b.shadow.scale.set(sc, sc, 1);
          b.shadow.material.opacity = 0.3 * sc;
        }
        renderer.render(scene, camera);
        if (!allSettled) raf = requestAnimationFrame(tick);
        else renderer.render(scene, camera); // final frame
      };
      raf = requestAnimationFrame(tick);
    }).catch(() => { if (!disposed) onFallback?.(); });

    return () => {
      disposed = true;
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
      {dice.length > 12 && <span style={S.more}>+{dice.length - 12} weitere unten</span>}
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
  more: { position: 'absolute', bottom: 2, right: 4, fontSize: 9, color: 'var(--color-text-muted)' },
};
