// Modèles 3D procéduraux (géométries fusionnées par matériau = peu d'appels de rendu)
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}

// ---------- matériaux partagés ----------
export const MAT = {};
export function initMaterials() {
  MAT.paint = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.12 });
  MAT.body = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1 });
  MAT.chrome = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.18, metalness: 1.0 });
  MAT.glass = new THREE.MeshPhysicalMaterial({ color: 0x06090c, roughness: 0.04, metalness: 0.3, transparent: true, opacity: 0.72, clearcoat: 1, depthWrite: false });
  MAT.head = new THREE.MeshStandardMaterial({ color: 0xfafcff, emissive: 0xfff6e0, emissiveIntensity: 0.25, roughness: 0.1 });
  MAT.tail = new THREE.MeshStandardMaterial({ color: 0x5a0606, emissive: 0xff1010, emissiveIntensity: 0.35, roughness: 0.3 });
  MAT.orange = new THREE.MeshStandardMaterial({ color: 0x7a3c00, emissive: 0xff8a00, emissiveIntensity: 0.3 });
  MAT.tire = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.92 });
  const rim = canvasTex(256, 256, (g, w) => {
    g.fillStyle = '#121212'; g.fillRect(0, 0, w, w);
    g.translate(128, 128);
    g.fillStyle = '#2a2a2a'; g.beginPath(); g.arc(0, 0, 124, 0, 7); g.fill();
    const gr = g.createRadialGradient(0, 0, 10, 0, 0, 84); gr.addColorStop(0, '#e8e8e8'); gr.addColorStop(1, '#8a8d92');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 84, 0, 7); g.fill();
    g.fillStyle = '#1c1c1c';
    for (let i = 0; i < 6; i++) { g.save(); g.rotate(i * Math.PI / 3); g.beginPath(); g.ellipse(0, 52, 12, 22, 0, 0, 7); g.fill(); g.restore(); }
    g.fillStyle = '#5a5d62'; g.beginPath(); g.arc(0, 0, 20, 0, 7); g.fill();
    g.fillStyle = '#ddd'; for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(Math.cos(i) * 12, Math.sin(i) * 12, 3, 0, 7); g.fill(); }
  });
  MAT.rim = new THREE.MeshStandardMaterial({ map: rim, roughness: 0.35, metalness: 0.7 });
  MAT.interior = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.9 });
}

const _c = new THREE.Color();
class Builder {
  constructor() { this.parts = {}; }
  add(kind, geo, color = 0xffffff) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute && g.morphAttributes && (g.morphAttributes = {});
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    _c.set(color);
    const n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = _c.r; a[i * 3 + 1] = _c.g; a[i * 3 + 2] = _c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    (this.parts[kind] ||= []).push(g);
    return g;
  }
  box(kind, color, w, h, d, x, y, z, o = {}) {
    const g = o.r ? new RoundedBoxGeometry(w, h, d, 2, o.r) : new THREE.BoxGeometry(w, h, d);
    if (o.rx) g.rotateX(o.rx); if (o.ry) g.rotateY(o.ry); if (o.rz) g.rotateZ(o.rz);
    g.translate(x, y, z);
    return this.add(kind, g, color);
  }
  cyl(kind, color, r1, r2, h, x, y, z, o = {}) {
    const g = new THREE.CylinderGeometry(r1, r2, h, o.seg || 14);
    if (o.rx) g.rotateX(o.rx); if (o.rz) g.rotateZ(o.rz);
    g.translate(x, y, z);
    return this.add(kind, g, color);
  }
  wedge(kind, color, w, h, d, x, y, z, slope) { // boîte dont le dessus avant est incliné (pare-brise/capot)
    const g = new THREE.BoxGeometry(w, h, d);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0 && p.getZ(i) > 0) p.setZ(i, p.getZ(i) - slope);
    g.computeVertexNormals(); g.translate(x, y, z);
    return this.add(kind, g, color);
  }
  build(mats = MAT) {
    const grp = new THREE.Group();
    for (const k in this.parts) {
      const geo = mergeGeometries(this.parts[k], false);
      const m = new THREE.Mesh(geo, mats[k] || MAT[k]);
      m.castShadow = k !== 'glass'; m.receiveShadow = k === 'body' || k === 'paint';
      m.name = k; grp.add(m);
    }
    return grp;
  }
}

// ---------- roues ----------
const wheelGeoCache = new Map();
export function makeWheel(r, wdt = 0.3) {
  const key = r.toFixed(2) + wdt;
  if (!wheelGeoCache.has(key)) { const g = new THREE.CylinderGeometry(r, r, wdt, 22); g.rotateZ(Math.PI / 2); wheelGeoCache.set(key, g); }
  const m = new THREE.Mesh(wheelGeoCache.get(key), [MAT.tire, MAT.rim, MAT.rim]);
  m.castShadow = true;
  return m;
}

// ---------- textures de livrée ----------
function sideDecal(text, sub, bg, fg, band) {
  return canvasTex(1024, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    if (band) { g.fillStyle = band[0]; g.fillRect(0, 120, w, 46); g.fillStyle = band[1]; g.fillRect(0, 166, w, 18); }
    g.fillStyle = fg; g.font = '900 104px Arial Black, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, band ? 70 : h / 2 - (sub ? 22 : 0));
    if (sub) { g.font = '700 40px Arial'; g.fillText(sub, w / 2, band ? 215 : h / 2 + 62); }
  });
}
const decalCache = {};
function decal(key, make) { return decalCache[key] ||= new THREE.MeshStandardMaterial({ map: make(), transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 }); }
function addDecal(group, mat, w, h, x, y, z, ry) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z); m.rotation.y = ry; group.add(m); return m;
}

// ---------- voitures ----------
function carBody(b, o) {
  const { len, w, paint, kind } = o;
  const L = len / 2, sill = o.sill ?? 0.3, belt = o.belt ?? 0.92, roofH = o.roof ?? 1.42;
  const trim = 0x18191b;
  const gS = o.gFront ?? L * 0.35, gE = o.gRear ?? -L * 0.62;
  if (o.hollow) {
    const hh = belt - sill, cz0 = gS - 0.25, cz1 = Math.max(gE + 0.1, -L + 0.5);
    b.box('paint', paint, w, hh, L - 0.04 - cz0, 0, (belt + sill) / 2, (L - 0.04 + cz0) / 2, { r: 0.1 });       // avant (moteur)
    b.box('paint', paint, w, hh, cz1 - (-L + 0.04), 0, (belt + sill) / 2, (cz1 + (-L + 0.04)) / 2, { r: 0.1 }); // arrière
    for (const sx of [-1, 1]) b.box('paint', paint, 0.06, hh, cz0 - cz1, sx * (w / 2 - 0.03), (belt + sill) / 2, (cz0 + cz1) / 2);
    b.box('body', 0x1b1c1f, w - 0.1, 0.05, cz0 - cz1, 0, sill + 0.04, (cz0 + cz1) / 2);
  } else b.box('paint', paint, w, belt - sill, len - 0.08, 0, (belt + sill) / 2, 0, { r: 0.12 });
  // capot / coffre légèrement bombés
  b.box('paint', paint, w * 0.94, 0.08, len * 0.3, 0, belt + 0.01, L - len * 0.17, { r: 0.04 });
  // habitacle vitré
  const gStart = o.gFront ?? L * 0.35, gEnd = o.gRear ?? -L * 0.62;
  const gl = gStart - gEnd, gz = (gStart + gEnd) / 2;
  const gh = roofH - belt;
  b.wedge('glass', 0, w * 0.86, gh, gl, 0, belt + gh / 2, gz, o.screenSlope ?? gl * 0.22);
  // toit + montants
  b.box('paint', paint, w * 0.8, 0.07, gl * (o.roofFrac ?? 0.6), 0, roofH, gz - (o.roofShift ?? 0.05), { r: 0.03 });
  for (const sx of [-1, 1]) {
    b.box('paint', paint, 0.07, gh, 0.08, sx * w * 0.42, belt + gh / 2, gStart - gl * 0.11, { rx: -0.5 });
    b.box('paint', paint, 0.07, gh, 0.12, sx * w * 0.42, belt + gh / 2, gz - gl * 0.08);
    b.box('paint', paint, 0.07, gh, 0.12, sx * w * 0.42, belt + gh / 2, gEnd + 0.12, { rx: o.wagon ? 0 : 0.35 });
    b.box('body', trim, 0.04, 0.03, 0.12, sx * (w / 2 + 0.03), belt + 0.06, gStart - 0.12);     // bras du rétro
    b.box('paint', paint, 0.08, 0.12, 0.2, sx * (w / 2 + 0.1), belt + 0.08, gStart - 0.15, { r: 0.03 }); // coque du rétro
    for (const zz of [gStart - 0.05, gz - gl * 0.08, gEnd + 0.2]) b.box('body', 0x0c0c0d, 0.01, belt - sill - 0.08, 0.015, sx * (w / 2 + 0.002), (belt + sill) / 2 + 0.02, zz); // joints de portes
    for (const zz of [gz + gl * 0.12, gz - gl * 0.3]) b.box('chrome', 0xc0c4c8, 0.02, 0.03, 0.12, sx * (w / 2 + 0.012), belt - 0.1, zz); // poignées
    for (const zz of [L - 0.85, -L + 0.85]) b.cyl('body', 0x101011, 0.42, 0.42, 0.06, sx * (w / 2 - 0.02), sill + 0.05, zz, { rz: Math.PI / 2, seg: 16 }); // passages de roues
    // passages de roue
  }
  if (!o.hollow) {
    b.box('body', 0x1d1e21, w * 0.84, 0.03, gl * 0.95, 0, belt + 0.005, gz);
    b.box('body', 0x232427, w * 0.84, 0.22, 0.5, 0, belt + 0.08, gStart - 0.3, { r: 0.05 });
    b.box('body', 0x2d2e33, 0.5, 0.5, 0.5, 0.38, belt - 0.05, gz - 0.25); b.box('body', 0x2d2e33, 0.5, 0.5, 0.5, -0.38, belt - 0.05, gz - 0.25);
  }
  // pare-chocs, calandre, bas de caisse
  b.box('body', trim, w * 0.98, 0.22, 0.18, 0, sill + 0.1, L - 0.05, { r: 0.06 });
  b.box('body', trim, w * 0.98, 0.22, 0.18, 0, sill + 0.1, -L + 0.05, { r: 0.06 });
  b.box('body', 0x0b0b0c, w * 0.5, 0.16, 0.05, 0, sill + 0.36, L - 0.03);
  b.box('body', trim, w + 0.01, 0.1, len * 0.55, 0, sill + 0.03, 0);
  // feux
  b.box('head', 0, 0.42, 0.12, 0.06, w * 0.33, belt - 0.12, L - 0.03);
  b.box('head', 0, 0.42, 0.12, 0.06, -w * 0.33, belt - 0.12, L - 0.03);
  b.box('tail', 0, 0.44, 0.12, 0.06, w * 0.34, belt - 0.1, -L + 0.03);
  b.box('tail', 0, 0.44, 0.12, 0.06, -w * 0.34, belt - 0.1, -L + 0.03);
  b.box('body', 0xd8d8d8, 0.4, 0.1, 0.02, 0, sill + 0.24, -L - 0.005); // plaque
  b.box('body', 0xd8d8d8, 0.4, 0.1, 0.02, 0, sill + 0.24, L + 0.005);
}

export function buildPoliceCar(def, paintColor, opts = {}) {
  const b = new Builder();
  const isSuv = def.id === 'suv', isWagon = def.id === 'wagon';
  const col = paintColor ?? def.color;
  carBody(b, {
    len: def.len, w: def.w, paint: col, sill: isSuv ? 0.42 : 0.3, belt: isSuv ? 1.18 : 0.92, roof: isSuv ? 1.78 : (isWagon ? 1.5 : 1.42),
    gRear: isWagon || isSuv ? -def.len / 2 + 0.35 : undefined, roofFrac: isWagon || isSuv ? 0.85 : 0.6, roofShift: isWagon || isSuv ? 0.1 : 0.05, wagon: isWagon || isSuv,
    screenSlope: isSuv ? 0.45 : undefined, hollow: true,
  });
  const roofH = isSuv ? 1.78 : (isWagon ? 1.5 : 1.42);
  // pare-buffle
  const pb = isSuv ? 0.72 : 0.55, fz = def.len / 2 + 0.1;
  for (const sx of [-0.35, 0.35]) b.cyl('body', 0x111111, 0.03, 0.03, 0.42, sx, pb, fz, { seg: 8 });
  for (const yy of [pb - 0.15, pb + 0.15]) b.cyl('body', 0x111111, 0.03, 0.03, 0.74, 0, yy, fz, { rz: Math.PI / 2, seg: 8 });
  b.box('tail', 0, 0.12, 0.05, 0.02, 0.18, pb + 0.15, fz + 0.03); b.box('head', 0, 0.12, 0.05, 0.02, -0.18, pb + 0.15, fz + 0.03); // feux de pénétration
  for (const sx of [-1, 1]) b.cyl('head', 0, 0.05, 0.05, 0.03, sx * def.w * 0.36, (isSuv ? 0.6 : 0.42), def.len / 2 - 0.02, { rx: Math.PI / 2, seg: 12 }); // antibrouillards
  b.cyl('body', 0x111111, 0.006, 0.006, 0.7, 0.25, roofH + 0.35, -def.len * 0.32, { seg: 4 }); b.cyl('body', 0x111111, 0.006, 0.006, 0.5, -0.25, roofH + 0.25, -def.len * 0.3, { seg: 4 }); // antennes
  if (!isSuv && !isWagon) b.box('paint', col, def.w * 0.8, 0.04, 0.22, 0, 0.98, -def.len / 2 + 0.2, { rx: 0.15 }); // béquet
  // rampe lumineuse
  b.box('body', 0x16171a, 1.25, 0.06, 0.32, 0, roofH + 0.05, -0.1);
  const g = b.build();
  const red = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1020, emissiveIntensity: 0.2, roughness: 0.2 });
  const blue = new THREE.MeshStandardMaterial({ color: 0x000a40, emissive: 0x1050ff, emissiveIntensity: 0.2, roughness: 0.2 });
  const barGeo = new THREE.BoxGeometry(0.58, 0.13, 0.28);
  const L1 = new THREE.Mesh(barGeo, blue); L1.position.set(0.3, roofH + 0.14, -0.1);
  const L2 = new THREE.Mesh(barGeo, red); L2.position.set(-0.3, roofH + 0.14, -0.1);
  g.add(L1, L2);
  // livrée
  const dark = col === 0x1b2433 || col === 0x3a3d42;
  const dm = decal('police' + (dark ? 'd' : 'l') + def.id, () => sideDecal('POLICE', '17', 0, dark ? '#f5f5f5' : '#173c8c', dark ? ['#f2f2f2', '#d01818'] : ['#173c8c', '#d01818']));
  const bh = isSuv ? 0.82 : 0.62, by = isSuv ? 0.82 : 0.62;
  addDecal(g, dm, def.len * 0.86, bh, def.w / 2 + 0.012, by, 0, Math.PI / 2);
  addDecal(g, dm, def.len * 0.86, bh, -def.w / 2 - 0.012, by, 0, -Math.PI / 2);
  const hm = decal('hood' + dark, () => canvasTex(512, 128, (c, w, h) => { c.fillStyle = dark ? '#f5f5f5' : '#173c8c'; c.font = '900 86px Arial Black, Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('POLICE', w / 2, h / 2 + 4); }));
  const hood = addDecal(g, hm, 1.2, 0.3, 0, (isSuv ? 1.18 : 0.92) + 0.07, def.len / 2 - 0.45, 0); hood.rotation.x = -Math.PI / 2;
  return { group: g, lights: { red, blue, L1, L2 }, roofH };
}

// ---------- motos (police + trafic) : vrai deux-roues + motard assis ----------
const _sq = new THREE.Quaternion(), _sy = new THREE.Vector3(0, 1, 0), _sd = new THREE.Vector3();
// segment (tube ou membre) entre deux points
function seg(b, kind, color, p1, p2, t, round) {
  _sd.set(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]); const L = _sd.length(); _sd.normalize();
  const g = round ? new THREE.CylinderGeometry(t, t * 0.9, L, 10) : new RoundedBoxGeometry(t * 2, L, t * 2, 2, t * 0.6);
  g.applyQuaternion(_sq.setFromUnitVectors(_sy, _sd));
  g.translate((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, (p1[2] + p2[2]) / 2);
  return b.add(kind, g, color);
}
function sph(b, kind, color, r, x, y, z, sx = 1, sy = 1, sz = 1) { const g = new THREE.SphereGeometry(r, 16, 12); g.scale(sx, sy, sz); g.translate(x, y, z); return b.add(kind, g, color); }
const motoWheelMats = {};
function motoWheel(R, disc) {
  motoWheelMats.rim ||= new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.35, metalness: 0.8 });
  motoWheelMats.disc ||= new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.3, metalness: 1 });
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.TorusGeometry(R - 0.055, 0.06, 10, 28), MAT.tire); tire.rotation.y = Math.PI / 2; tire.scale.z = 1.25; tire.castShadow = true; g.add(tire);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R - 0.1, 0.014, 6, 28), motoWheelMats.rim); rim.rotation.y = Math.PI / 2; g.add(rim);
  for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2, sp = new THREE.Mesh(new THREE.BoxGeometry(0.03, R - 0.12, 0.022), motoWheelMats.rim); sp.position.set(0, Math.cos(a) * (R - 0.1) / 2, Math.sin(a) * (R - 0.1) / 2); sp.rotation.x = a; g.add(sp); }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.14, 12), motoWheelMats.disc); hub.rotation.z = Math.PI / 2; g.add(hub);
  if (disc) for (const sx of disc) { const d = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.55, R * 0.55, 0.012, 24), motoWheelMats.disc); d.rotation.z = Math.PI / 2; d.position.x = sx * 0.07; g.add(d); }
  return g;
}
// o : { police, paint, accent, jacket, pants, helmet, R, wb }
export function buildMoto(o) {
  const b = new Builder(), R = o.R || 0.32, F = (o.wb || 1.48) / 2, blk = 0x161618, grey = 0x3b3d42, paint = o.paint, acc = o.accent ?? paint;
  const fh = [0, R, F], head = [0, 1.0, F - 0.26], piv = [0, 0.52, -0.18], rh = [0, R, -F];
  // fourche télescopique inclinée + tés + garde-boue
  for (const sx of [-1, 1]) { seg(b, 'chrome', 0xc8ccd2, [sx * 0.085, fh[1] + 0.02, fh[2]], [sx * 0.085, fh[1] + 0.34, fh[2] - 0.12], 0.026, true); seg(b, 'body', blk, [sx * 0.085, fh[1] + 0.34, fh[2] - 0.12], [sx * 0.085, head[1] + 0.05, head[2]], 0.03, true); }
  b.box('body', grey, 0.24, 0.05, 0.1, 0, head[1] + 0.04, head[2], { r: 0.02 });
  b.box('paint', acc, 0.15, 0.04, 0.5, 0, R + 0.1, F - 0.02, { r: 0.015, rx: 0.15 });
  // cadre, bras oscillant, amortisseur
  for (const sx of [-1, 1]) { seg(b, 'body', grey, [sx * 0.1, head[1] - 0.05, head[2] - 0.04], [sx * 0.14, piv[1] + 0.05, piv[2]], 0.035); seg(b, 'body', grey, [sx * 0.13, piv[1], piv[2]], [sx * 0.11, rh[1], rh[2]], 0.03); }
  seg(b, 'chrome', 0xd0a020, [0, piv[1] + 0.1, piv[2] - 0.08], [0, piv[1] + 0.38, piv[2] - 0.22], 0.025, true);
  // moteur + radiateur + échappement
  b.box('body', 0x2a2b2f, 0.3, 0.3, 0.42, 0, 0.42, 0.06, { r: 0.05 });
  for (const sx of [-1, 1]) b.box('chrome', 0x8a8e95, 0.11, 0.24, 0.16, sx * 0.08, 0.66, 0.2, { r: 0.03, rx: -0.35 });
  b.box('body', 0x111214, 0.34, 0.3, 0.05, 0, 0.62, 0.38, { r: 0.02, rx: -0.2 });
  seg(b, 'chrome', 0xc0c4c8, [0.08, 0.48, 0.28], [0.12, 0.26, 0.02], 0.03, true);
  seg(b, 'chrome', 0xc0c4c8, [0.12, 0.26, 0.02], [0.18, 0.4, -0.5], 0.03, true);
  seg(b, 'chrome', 0x9a9ea4, [0.19, 0.42, -0.5], [0.22, 0.58, -0.85], 0.06, true);
  // réservoir, selle, coque arrière, feux, plaque
  sph(b, 'paint', paint, 0.24, 0, 0.92, 0.12, 0.78, 0.6, 1.25);
  b.box('paint', acc, 0.3, 0.05, 0.3, 0, 1.03, 0.08, { r: 0.02, rx: -0.1 });
  b.box('body', 0x1c1c1e, 0.28, 0.09, 0.62, 0, 0.88, -0.36, { r: 0.04, rx: 0.06 });
  b.wedge('paint', paint, 0.24, 0.16, 0.42, 0, 0.84, -0.72, -0.12);
  b.box('tail', 0, 0.16, 0.05, 0.03, 0, 0.88, -0.94);
  b.box('body', 0xf0f0f0, 0.18, 0.1, 0.01, 0, 0.62, -0.97, { rx: 0.3 });
  seg(b, 'body', blk, [0, 0.8, -0.85], [0, 0.6, -0.96], 0.02);
  for (const sx of [-1, 1]) b.box('orange', 0, 0.05, 0.04, 0.06, sx * 0.13, 0.8, -0.9);
  // phare rond, guidon, rétros, clignos
  const hl = new THREE.CylinderGeometry(0.085, 0.085, 0.06, 18); hl.rotateX(Math.PI / 2); hl.translate(0, 0.94, F - 0.14); b.add('head', hl, 0xffffff);
  if (o.police) {
    b.wedge('paint', paint, 0.52, 0.42, 0.42, 0, 0.92, F - 0.22, 0.18);
    b.box('paint', acc, 0.54, 0.07, 0.38, 0, 0.82, F - 0.24);
    b.wedge('glass', 0, 0.44, 0.36, 0.06, 0, 1.28, F - 0.33, 0.14);
    for (const sx of [-1, 1]) b.box('paint', paint, 0.2, 0.34, 0.48, sx * 0.29, 0.62, -0.58, { r: 0.05 }); // valises
  } else b.cyl('body', blk, 0.1, 0.07, 0.12, 0, 0.94, F - 0.2, { rx: Math.PI / 2, seg: 14 });
  seg(b, 'body', blk, [-0.34, 1.08, head[2] - 0.06], [0.34, 1.08, head[2] - 0.06], 0.016, true);
  for (const sx of [-1, 1]) {
    seg(b, 'body', 0x2a2a2a, [sx * 0.3, 1.08, head[2] - 0.06], [sx * 0.37, 1.08, head[2] - 0.06], 0.022, true);
    seg(b, 'body', blk, [sx * 0.24, 1.08, head[2] - 0.04], [sx * 0.3, 1.26, head[2]], 0.008, true);
    b.box('body', blk, 0.1, 0.06, 0.02, sx * 0.31, 1.27, head[2] + 0.01, { r: 0.008 });
    b.box('orange', 0, 0.04, 0.03, 0.05, sx * 0.14, 0.9, F - 0.12);
    b.box('body', grey, 0.12, 0.02, 0.04, sx * 0.17, 0.42, -0.12); // repose-pieds
  }
  // motard : assis, penché, mains sur les poignées, pieds sur les repose-pieds
  const J = o.jacket ?? 0x22262e, P = o.pants ?? 0x1c1d22, H = o.helmet ?? 0xf2f2f2;
  const hip = [0, 0.98, -0.3], sh = [0, 1.48, -0.02];
  seg(b, 'body', J, hip, sh, 0.17);
  if (o.police) seg(b, 'body', 0xf5d020, [0, hip[1] + 0.2, hip[2] + 0.06], [0, sh[1] - 0.06, sh[2] - 0.02], 0.178);
  sph(b, 'body', H, 0.15, 0, 1.68, 0.1, 1, 1.05, 1.12);
  sph(b, 'glass', 0, 0.13, 0, 1.67, 0.17, 0.95, 0.55, 0.8);
  for (const sx of [-1, 1]) {
    const S = [sx * 0.19, sh[1] - 0.04, sh[2]], E = [sx * 0.26, 1.24, 0.18], Hd = [sx * 0.31, 1.09, head[2] - 0.06];
    seg(b, 'body', J, S, E, 0.06); seg(b, 'body', J, E, Hd, 0.05); sph(b, 'body', 0x111111, 0.05, Hd[0], Hd[1], Hd[2]);
    const Hp = [sx * 0.12, hip[1], hip[2] + 0.04], K = [sx * 0.2, 0.86, 0.14], Ft = [sx * 0.19, 0.44, -0.08];
    seg(b, 'body', P, Hp, K, 0.08); seg(b, 'body', P, K, Ft, 0.065);
    b.box('body', 0x0c0c0c, 0.1, 0.1, 0.24, Ft[0], 0.42, Ft[2] + 0.04, { r: 0.03 });
  }
  const g = b.build();
  const wF = motoWheel(R, [-1, 1]), wR = motoWheel(R, [1]); wF.position.set(...fh); wR.position.set(...rh); g.add(wF, wR);
  g.userData.motoWheels = [wF, wR]; g.userData.R = R;
  return g;
}

export function buildPoliceMoto(def) {
  const g = buildMoto({ police: true, paint: 0xf2f2f2, accent: 0x173c8c, jacket: 0x1d2f5a, pants: 0x1d2f5a, helmet: 0xf2f2f2, R: def.wheelR, wb: 1.48 });
  const red = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1020, emissiveIntensity: 0.2 });
  const blue = new THREE.MeshStandardMaterial({ color: 0x000a40, emissive: 0x1050ff, emissiveIntensity: 0.2 });
  const L1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.05), blue); L1.position.set(0.17, 1.02, 0.62);
  const L2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.05), red); L2.position.set(-0.17, 1.02, 0.62);
  const L3 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.24, 0.05), blue); L3.position.set(0.26, 1.05, -0.8);
  const L4 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.24, 0.05), red); L4.position.set(-0.26, 1.05, -0.8);
  for (const L of [L3, L4]) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6), MAT.interior); st.position.y = -0.2; L.add(st); }
  g.add(L1, L2, L3, L4);
  return { group: g, lights: { red, blue, L1, L2 }, roofH: 1.05 };
}

// ---------- camions joueurs ----------
function truckCab(b, o) {
  const { w, front, paint, cabLen = 2.3, floor = 1.05, top = 3.35 } = o;
  const z0 = front - cabLen / 2, trim = 0x1a1b1d;
  const belt = floor + 0.95;
  if (o.hollow) { // coque creuse : on voit le vrai intérieur
    const hh = belt - floor, t = 0.07;
    for (const sx of [-1, 1]) b.box('paint', paint, t, hh, cabLen, sx * (w / 2 - t / 2), (floor + belt) / 2, z0, { r: 0.03 });
    b.box('paint', paint, w, hh, 0.1, 0, (floor + belt) / 2, front - 0.05, { r: 0.04 });
    b.box('paint', paint, w, hh, 0.08, 0, (floor + belt) / 2, front - cabLen + 0.04);
    b.box('body', 0x202124, w - 0.1, 0.06, cabLen - 0.1, 0, floor + 0.03, z0);
  } else b.box('paint', paint, w, belt - floor, cabLen, 0, (floor + belt) / 2, z0, { r: 0.1 });
  // vitres : pare-brise + latérales
  b.wedge('glass', 0, w - 0.08, 0.95, cabLen - 0.25, 0, belt + 0.47, z0 - 0.08, 0.12);
  // montants
  for (const sx of [-1, 1]) {
    b.box('paint', paint, 0.1, 0.95, 0.12, sx * (w / 2 - 0.06), belt + 0.47, front - 0.13);
    b.box('paint', paint, 0.1, 0.95, 0.5, sx * (w / 2 - 0.06), belt + 0.47, z0 - cabLen / 2 + 0.35);
    if (!o.hollow) { // rétros simplifiés (les cabines détaillées ont de vrais miroirs, cf. interior.js)
      b.box('body', trim, 0.08, 0.5, 0.22, sx * (w / 2 + 0.3), belt + 0.35, front - 0.2);
      b.box('body', trim, 0.36, 0.04, 0.04, sx * (w / 2 + 0.13), belt + 0.58, front - 0.25);
      b.box('body', trim, 0.36, 0.04, 0.04, sx * (w / 2 + 0.13), belt + 0.12, front - 0.25);
    }
    b.box('body', trim, 0.5, 0.12, 0.7, sx * (w / 2 - 0.25), floor - 0.25, front - 0.6); // marchepieds
  }
  b.box('paint', paint, w - 0.02, 0.9, 0.35, 0, belt + 0.47, z0 - cabLen / 2 + 0.17); // paroi arrière
  b.box('paint', paint, w, top - belt - 0.95, cabLen, 0, (top + belt + 0.95) / 2, z0, { r: 0.08 }); // pavillon
  b.wedge('paint', paint, w - 0.1, 0.55, cabLen * 0.8, 0, top + 0.27, z0 - 0.1, 0.4); // déflecteur
  // face avant
  b.box('body', 0x101113, w * 0.82, 0.62, 0.06, 0, floor + 0.5, front + 0.005);
  for (let i = 0; i < 5; i++) b.box('chrome', 0x9ea3a8, w * 0.8, 0.03, 0.03, 0, floor + 0.25 + i * 0.12, front + 0.03);
  b.box('body', trim, w + 0.04, 0.35, 0.3, 0, floor - 0.25, front - 0.1, { r: 0.06 });
  b.box('head', 0, 0.42, 0.18, 0.05, w * 0.36, floor + 0.05, front + 0.05);
  b.box('head', 0, 0.42, 0.18, 0.05, -w * 0.36, floor + 0.05, front + 0.05);
  b.box('orange', 0, 0.12, 0.08, 0.05, w * 0.47, floor + 0.05, front + 0.05);
  b.box('orange', 0, 0.12, 0.08, 0.05, -w * 0.47, floor + 0.05, front + 0.05);
  for (let i = -2; i <= 2; i++) b.box('orange', 0, 0.1, 0.05, 0.05, i * 0.22, top + 0.04, front - 0.1);
  // pare-soleil extérieur, klaxons à air, gyrophares orange, emblème, plaque, poignées, joints de portes
  b.box('body', trim, w - 0.05, 0.05, 0.32, 0, belt + 0.99, front + 0.08, { rx: -0.12 });
  for (const sx of [-0.35, 0.35]) { b.cyl('chrome', 0xd0d4da, 0.05, 0.03, 0.45, sx, top + 0.12, z0 + 0.2, { rx: Math.PI / 2, seg: 10 }); }
  for (const sx of [-1, 1]) b.cyl('orange', 0, 0.07, 0.07, 0.14, sx * (w / 2 - 0.2), top + 0.1, front - 0.4, { seg: 12 });
  b.box('chrome', 0xd8dce0, 0.36, 0.1, 0.03, 0, floor + 0.86, front + 0.035);
  b.box('body', 0xf0f0ea, 0.52, 0.12, 0.02, 0, floor - 0.3, front + 0.06);
  for (const sx of [-1, 1]) {
    b.box('body', 0x0e0f11, 0.012, belt - floor - 0.1, 0.02, sx * (w / 2 + 0.002), (floor + belt) / 2, z0 - cabLen * 0.18);
    b.box('body', 0x0e0f11, 0.012, belt - floor - 0.1, 0.02, sx * (w / 2 + 0.002), (floor + belt) / 2, front - 0.25);
    b.box('chrome', 0xc8ccd2, 0.03, 0.04, 0.18, sx * (w / 2 + 0.015), belt - 0.15, z0 - cabLen * 0.1);
    b.box('body', 0x0e0f11, 0.01, 0.95, 0.03, sx * (w / 2 - 0.02), belt + 0.47, z0 - cabLen * 0.18); // joint de vitre
    for (let i = 0; i < 3; i++) b.box('body', 0x2a2b2e, 0.42, 0.04, 0.24, sx * (w / 2 - 0.22), floor - 0.48 + i * 0.25, front - 0.62); // marches
  }
  // intérieur simplifié (véhicules vus de loin) ; l'intérieur détaillé est dans interior.js
  if (!o.hollow) b.box('body', 0x1d1e21, w - 0.2, 0.03, cabLen - 0.4, 0, belt + 0.01, z0 - 0.1);
  if (!o.hollow) {
  b.box('body', 0x26272b, w - 0.2, 0.3, 0.55, 0, belt + 0.1, front - 0.45, { r: 0.05 });
  b.box('body', 0x303136, 0.6, 0.7, 0.6, w * 0.24, belt - 0.05, z0 - 0.35); b.box('body', 0x303136, 0.6, 0.7, 0.6, -w * 0.24, belt - 0.05, z0 - 0.35);
  }
  return belt;
}

function chassis(b, w, z0, z1, y, axles) {
  b.box('body', 0x1a1a1c, 0.9, 0.3, z0 - z1, 0, y, (z0 + z1) / 2);
  for (const az of axles || []) for (const sx of [-1, 1]) {
    b.box('body', 0x111214, 0.5, 0.05, 1.25, sx * (w / 2 - 0.25), 1.12, az, { r: 0.02 });            // garde-boue
    b.box('body', 0x0b0b0c, 0.48, 0.55, 0.02, sx * (w / 2 - 0.25), 0.5, az - 0.68);                 // bavette
  }
  for (const sx of [-1, 1]) b.box('body', 0x2a2c30, 0.03, 0.35, Math.max(0.1, (z0 - z1) * 0.35), sx * (w / 2 - 0.02), 0.62, z1 + (z0 - z1) * 0.35); // jupe
  b.box('body', 0x2a2b2e, 0.8, 0.5, 1.0, w * 0.32, y - 0.1, z1 + (z0 - z1) * 0.55); // réservoir
  b.box('chrome', 0xb8bcc2, 0.82, 0.52, 0.02, w * 0.32, y - 0.1, z1 + (z0 - z1) * 0.55 + 0.51);
}

export function buildPlayerTruck(def, paintColor) {
  const b = new Builder(), col = paintColor ?? def.color, w = def.w, front = def.len / 2;
  const deco = [];
  if (def.id === 'delivery') {
    const belt = truckCab(b, { w, front, paint: col, cabLen: 2.0, floor: 1.0, top: 3.1, hollow: true });
    chassis(b, w, front - 1.0, -front + 0.3, 0.75, [2.35, -1.75]);
    b.box('body', 0xf6f6f2, w + 0.02, 2.55, 5.1, 0, 2.15, -front + 2.55 + 0.05, { r: 0.04 });
    b.box('body', 0x9a9a98, w + 0.04, 0.08, 5.1, 0, 0.9, -front + 2.6);
    b.box('tail', 0, 0.3, 0.16, 0.05, w * 0.38, 0.85, -front - 0.02); b.box('tail', 0, 0.3, 0.16, 0.05, -w * 0.38, 0.85, -front - 0.02);
    b.box('body', 0x707274, 0.04, 2.4, 0.02, 0, 2.15, -front - 0.01);
    deco.push(['TRANS-EXPRESS', 'Livraison 24h/24', 5.0, 2.3, 2.15, -front + 2.6]);
  } else if (def.id === 'flatbed') {
    truckCab(b, { w, front, paint: col, cabLen: 2.2, floor: 1.08, top: 3.3, hollow: true });
    chassis(b, w, front - 1.0, -front + 0.2, 0.8, [3.2, -2.1, -3.45]);
    const dz = -front + 3.4;
    b.box('body', 0x2b2c2f, w + 0.04, 0.2, 6.6, 0, 1.2, dz);
    b.box('body', 0x6e5a3e, w, 0.04, 6.5, 0, 1.31, dz);
    b.box('paint', col, w + 0.04, 0.9, 0.1, 0, 1.75, dz + 3.25); // ridelle avant
    const wood = [0xa0794a, 0x8d6a40, 0xb08655];
    let i = 0;
    for (const z of [-2.2, -0.4, 1.4]) for (const x of [-0.6, 0.6]) {
      const hh = 1.1 + (i % 2) * 0.3; b.box('body', wood[i % 3], 1.15, hh, 1.6, x, 1.33 + hh / 2, dz + z); i++;
    }
    for (const z of [-2.2, -0.4, 1.4]) b.box('body', 0xe0a020, w + 0.06, 0.04, 0.06, 0, 2.78, dz + z); // sangles
    b.box('tail', 0, 0.3, 0.16, 0.05, w * 0.38, 0.95, -front - 0.02); b.box('tail', 0, 0.3, 0.16, 0.05, -w * 0.38, 0.95, -front - 0.02);
  } else { // semi : tracteur
    truckCab(b, { w, front, paint: col, cabLen: 2.4, floor: 1.15, top: 3.55, hollow: true });
    chassis(b, w, front - 1.1, -front + 0.1, 0.85, [1.95, -1.75]);
    b.cyl('body', 0x1c1c1c, 0.7, 0.7, 0.1, 0, 1.2, -1.15, { seg: 18 }); // sellette
    b.cyl('chrome', 0xc0c4c8, 0.09, 0.09, 1.6, w * 0.45, 3.1, front - 2.45); // échappement
    b.box('body', 0x111111, w, 0.08, 1.2, 0, 1.3, -front + 0.6);
    b.box('tail', 0, 0.3, 0.14, 0.05, w * 0.38, 0.9, -front - 0.02); b.box('tail', 0, 0.3, 0.14, 0.05, -w * 0.38, 0.9, -front - 0.02);
  }
  const g = b.build({ ...MAT, tail: MAT.tail.clone() });
  for (const [t, sub, len, hgt, y, z] of deco) {
    const m = decal('cargo' + t, () => sideDecal(t, sub, 0, '#d8462b', null));
    addDecal(g, m, len * 0.9, hgt * 0.5, w / 2 + 0.03, y, z, Math.PI / 2);
    addDecal(g, m, len * 0.9, hgt * 0.5, -w / 2 - 0.03, y, z, -Math.PI / 2);
  }
  return { group: g };
}

export function buildTrailer(def) {
  const t = def.trailer, b = new Builder(), w = t.w, front = 1.2; // origine = pivot d'attelage décalé
  const zc = front - t.len / 2;
  b.box('body', 0xdcdcd8, w, 2.9, t.len, 0, 2.55, zc, { r: 0.05 });
  b.box('body', 0x9a9b9e, w + 0.02, 0.1, t.len, 0, 1.08, zc);
  b.box('body', 0x1c1c1e, 0.9, 0.3, t.len - 1, 0, 0.9, zc);
  b.box('body', 0x3a3b3e, w * 0.9, 0.12, 0.12, 0, 0.55, front - t.len + 0.1); // anti-encastrement
  b.box('body', 0x8b8c90, 0.05, 2.75, 0.02, 0, 2.55, front - t.len - 0.01);
  b.box('tail', 0, 0.36, 0.16, 0.05, w * 0.38, 0.72, front - t.len - 0.02);
  b.box('tail', 0, 0.36, 0.16, 0.05, -w * 0.38, 0.72, front - t.len - 0.02);
  for (let i = 0; i < 6; i++) b.box('orange', 0, 0.06, 0.06, 0.05, w / 2 + 0.01, 1.05, front - 1 - i * 2.3); // feux de gabarit
  b.box('body', 0x2a2a2a, 0.1, 0.8, 0.1, w * 0.3, 0.6, front - 2.6); b.box('body', 0x2a2a2a, 0.1, 0.8, 0.1, -w * 0.3, 0.6, front - 2.6); // béquilles
  const rearZ = front - t.len;
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 18; i++) b.box(i % 2 ? 'tail' : 'body', i % 2 ? 0 : 0xf2f2f2, 0.01, 0.05, 0.6, sx * (w / 2 + 0.012), 1.18, front - 0.5 - i * 0.68); // bande réfléchissante
    for (const yy of [0.7, 0.95]) b.box('chrome', 0xa8acb2, 0.04, 0.05, 5.2, sx * (w / 2 - 0.05), yy, front - 4.5);                              // protections latérales
    b.box('body', 0x0b0b0c, 0.5, 0.5, 0.02, sx * (w / 2 - 0.25), 0.5, rearZ + 1.0);                                                           // bavettes
  }
  for (const xx of [-0.85, -0.3, 0.3, 0.85]) b.cyl('chrome', 0xb8bcc2, 0.02, 0.02, 2.6, xx, 2.55, rearZ - 0.03, { seg: 8 });                 // barres de fermeture
  for (const yy of [1.5, 3.6]) for (const sx of [-1, 1]) b.box('chrome', 0x9a9ea4, 0.12, 0.06, 0.03, sx * (w / 2 - 0.1), yy, rearZ - 0.025);  // charnières
  b.box('body', 0x18191b, 0.012, 2.7, 0.02, 0, 2.55, rearZ - 0.012);
  for (let i = 0; i < 8; i++) b.box(i % 2 ? 'tail' : 'body', i % 2 ? 0 : 0xf2f2f2, 0.28, 0.06, 0.01, -w / 2 + 0.17 + i * 0.31, 1.18, rearZ - 0.02);
  const g = b.build({ ...MAT, tail: MAT.tail.clone() });
  const m = decal('trailer', () => canvasTex(2048, 512, (c, W, H) => {
    const gr = c.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, '#b0161e'); gr.addColorStop(0.5, '#e8442a'); gr.addColorStop(1, '#f0a020');
    c.fillStyle = gr; c.fillRect(0, H - 90, W, 40);
    c.fillStyle = '#18233a'; c.font = '900 190px Arial Black, Arial'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('TRACK A TRUCK', W / 2, H / 2 - 60);
    c.font = '700 70px Arial'; c.fillStyle = '#b0161e'; c.fillText('LOGISTICS • EUROPE', W / 2, H / 2 + 90);
  }));
  addDecal(g, m, t.len * 0.92, 2.6, w / 2 + 0.03, 2.55, zc, Math.PI / 2);
  addDecal(g, m, t.len * 0.92, 2.6, -w / 2 - 0.03, 2.55, zc, -Math.PI / 2);
  return { group: g };
}

// ---------- trafic civil (une géométrie fusionnée par type/couleur) ----------
const CIVIL = [0xe8e8e6, 0x1c1d20, 0x8a8f96, 0x5a6470, 0x8e1b1b, 0x1e3f73, 0x2f4f3a, 0xc8c2b2, 0x6b2a2a, 0x3d6fa8, 0xd6d0c4, 0x0f1d33, 0xb35a1f];
export function buildTraffic(type, r) {
  const b = new Builder();
  const paint = CIVIL[Math.floor(r() * CIVIL.length)];
  const { len, w } = type;
  const L = len / 2;
  const wheel = (x, z, rad, wd = 0.25) => { b.cyl('body', 0x141414, rad, rad, wd, x, rad, z, { rz: Math.PI / 2, seg: 12 }); b.cyl('chrome', 0x9a9da2, rad * 0.6, rad * 0.6, wd + 0.02, x, rad, z, { rz: Math.PI / 2, seg: 10 }); };
  if (type.kind === 'moto') {
    const cols = [0xc81e1e, 0x1d1d20, 0xf0f0f0, 0x1f5fa8, 0xf0b400, 0x2b8a3a, 0xe05a10];
    const jk = [0x22262e, 0x3a2a1e, 0x1d1d20, 0x5a1a1a, 0x2a3a5a][Math.floor(r() * 5)];
    return buildMoto({ paint: cols[Math.floor(r() * cols.length)], jacket: jk, helmet: [0x111111, 0xf2f2f2, 0xc81e1e, 0x1f5fa8, 0xf0b400][Math.floor(r() * 5)], R: 0.31, wb: 1.45 });
  }
  if (type.kind === 'car' || type.kind === 'hatch') {
    const hatch = type.kind === 'hatch';
    carBody(b, { len, w, paint, belt: 0.9, roof: hatch ? 1.48 : 1.42, gRear: hatch ? -L + 0.3 : undefined, roofFrac: hatch ? 0.8 : 0.6, wagon: hatch });
    for (const sx of [-1, 1]) for (const sz of [1, -1]) wheel(sx * (w / 2 - 0.12), sz * (L - 0.85), 0.32);
  } else if (type.kind === 'van') {
    const col = r() < 0.6 ? 0xf0f0ee : paint;
    b.box('paint', col, w, 1.95, len - 1.2, 0, 1.38, -0.55, { r: 0.08 });
    b.wedge('paint', col, w, 0.7, 1.3, 0, 0.75, L - 0.75, 0.5);
    b.wedge('glass', 0, w - 0.1, 0.65, 1.0, 0, 1.75, L - 1.4, 0.5);
    for (const sx of [-1, 1]) b.box('glass', 0, 0.02, 0.5, 0.7, sx * (w / 2 + 0.005), 1.8, L - 1.6);
    b.box('body', 0x18191b, w, 0.25, 0.2, 0, 0.42, L - 0.05, { r: 0.05 }); b.box('body', 0x18191b, w, 0.25, 0.2, 0, 0.42, -L + 0.05);
    b.box('head', 0, 0.3, 0.15, 0.05, w * 0.36, 0.85, L - 0.02); b.box('head', 0, 0.3, 0.15, 0.05, -w * 0.36, 0.85, L - 0.02);
    b.box('tail', 0, 0.12, 0.5, 0.05, w * 0.45, 1.0, -L - 0.01); b.box('tail', 0, 0.12, 0.5, 0.05, -w * 0.45, 1.0, -L - 0.01);
    for (const sx of [-1, 1]) for (const sz of [1, -1]) wheel(sx * (w / 2 - 0.15), sz * (L - 1.0), 0.36);
  } else if (type.kind === 'truck') {
    // semi articulé : tracteur (origine = centre, 6,2 m) + remorque séparée (origine = pivot d'attelage)
    const cab = [0xf2f2ee, 0x1f5fa8, 0xb0161e, 0x2b7a3d, 0xe0a020, 0x3a3d42][Math.floor(r() * 6)];
    const tc = r() < 0.5 ? 0xdcdcd8 : [0x1f3f6a, 0x7a1f1f, 0x2f5a3a, 0x5a5d62][Math.floor(r() * 4)];
    const F = 3.1;
    truckCab(b, { w, front: F, paint: cab, cabLen: 2.3, floor: 1.1, top: 3.45 });
    chassis(b, w, F - 1, -F + 0.2, 0.8, [1.95, -1.75]);
    b.cyl('body', 0x1c1c1c, 0.7, 0.7, 0.1, 0, 1.2, -1.15, { seg: 14 });
    for (const sx of [-1, 1]) for (const z of [1.95, -1.75]) wheel(sx * (w / 2 - 0.25), z, 0.5, 0.45);
    const b2 = new Builder();
    b2.box('body', tc, w + 0.02, 2.85, 13.4, 0, 2.55, 1.2 - 6.7, { r: 0.04 });
    b2.box('body', 0x1c1c1e, 0.9, 0.3, 12.4, 0, 0.95, -5.6);
    b2.box('body', 0x3a3b3e, w * 0.9, 0.12, 0.12, 0, 0.55, -12.1);
    b2.box('tail', 0, 0.36, 0.16, 0.05, w * 0.38, 0.72, -12.22); b2.box('tail', 0, 0.36, 0.16, 0.05, -w * 0.38, 0.72, -12.22);
    for (let i = 0; i < 5; i++) b2.box('orange', 0, 0.06, 0.06, 0.05, w / 2 + 0.02, 1.05, -0.5 - i * 2.4);
    const wheel2 = (x, z) => { b2.cyl('body', 0x141414, 0.5, 0.5, 0.45, x, 0.5, z, { rz: Math.PI / 2, seg: 12 }); b2.cyl('chrome', 0x9a9da2, 0.3, 0.3, 0.47, x, 0.5, z, { rz: Math.PI / 2, seg: 10 }); };
    for (const sx of [-1, 1]) for (const z of [-8.4, -9.7, -11.0]) wheel2(sx * (w / 2 - 0.25), z);
    const g = b.build(); g.userData.trailer = b2.build();
    return g;
  } else if (type.kind === 'tractor') { // tracteur agricole (routes de campagne)
    const col = [0x2b8a3a, 0xc22020, 0x1f5fa8][Math.floor(r() * 3)];
    b.box('paint', col, 1.0, 0.8, 2.4, 0, 1.2, 0.6, { r: 0.08 });
    b.box('glass', 0, 1.5, 1.3, 1.3, 0, 2.1, -0.7);
    b.box('paint', col, 1.6, 0.08, 1.4, 0, 2.8, -0.7);
    for (const sx of [-1, 1]) for (const zz of [-0.6, -0.8]) b.box('paint', col, 0.06, 1.3, 0.06, sx * 0.75, 2.1, zz - 0.05 + (zz < -0.7 ? -0.5 : 0.55));
    b.cyl('chrome', 0x8a8e95, 0.05, 0.05, 1.1, 0.35, 2.2, 1.3, { seg: 8 });
    b.box('head', 0, 0.2, 0.12, 0.05, 0.3, 1.5, 1.82); b.box('head', 0, 0.2, 0.12, 0.05, -0.3, 1.5, 1.82);
    b.box('orange', 0, 0.15, 0.15, 0.15, 0, 3.0, -0.7);
    b.box('tail', 0, 0.12, 0.12, 0.05, 0.7, 1.3, -1.45); b.box('tail', 0, 0.12, 0.12, 0.05, -0.7, 1.3, -1.45);
    for (const sx of [-1, 1]) { b.cyl('body', 0x141414, 0.85, 0.85, 0.5, sx * 0.95, 0.85, -0.9, { rz: Math.PI / 2, seg: 16 }); b.cyl('chrome', 0xd8b020, 0.45, 0.45, 0.52, sx * 0.95, 0.85, -0.9, { rz: Math.PI / 2, seg: 12 }); b.cyl('body', 0x141414, 0.5, 0.5, 0.35, sx * 0.85, 0.5, 1.4, { rz: Math.PI / 2, seg: 14 }); }
  } else { // bus / car
    const col = [0xf0f0ee, 0x1f5fa8, 0x2b7a3d, 0xd8d0b8][Math.floor(r() * 4)];
    b.box('paint', col, w, 2.9, len, 0, 2.05, 0, { r: 0.15 });
    b.box('glass', 0, w + 0.02, 1.05, len - 1.6, 0, 2.55, -0.3);
    b.box('glass', 0, w - 0.15, 1.5, 0.05, 0, 2.3, L + 0.005);
    b.box('body', 0x19191b, w + 0.02, 0.35, len, 0, 0.75, 0);
    b.box('head', 0, 0.4, 0.15, 0.05, w * 0.36, 0.95, L + 0.01); b.box('head', 0, 0.4, 0.15, 0.05, -w * 0.36, 0.95, L + 0.01);
    b.box('tail', 0, 0.2, 0.5, 0.05, w * 0.42, 1.2, -L - 0.01); b.box('tail', 0, 0.2, 0.5, 0.05, -w * 0.42, 1.2, -L - 0.01);
    for (const sx of [-1, 1]) for (const z of [L - 2.3, -L + 3.0, -L + 1.7]) wheel(sx * (w / 2 - 0.25), z, 0.5, 0.4);
  }
  return b.build();
}

// Petit personnage (sortie du véhicule)
export function buildPerson(color = 0x1e3a6e) {
  const b = new Builder();
  b.box('body', color, 0.42, 0.6, 0.25, 0, 1.2, 0, { r: 0.08 });
  b.box('body', 0x2a2a30, 0.17, 0.82, 0.2, 0.11, 0.45, 0); b.box('body', 0x2a2a30, 0.17, 0.82, 0.2, -0.11, 0.45, 0);
  b.box('body', color, 0.12, 0.58, 0.14, 0.29, 1.18, 0); b.box('body', color, 0.12, 0.58, 0.14, -0.29, 1.18, 0);
  b.box('body', 0xe0b090, 0.22, 0.25, 0.24, 0, 1.68, 0, { r: 0.08 });
  b.box('body', 0x1a1a1a, 0.24, 0.08, 0.26, 0, 1.82, 0);
  b.box('body', 0xf5d020, 0.44, 0.05, 0.27, 0, 1.35, 0); // bande réfléchissante
  return b.build();
}

export { Builder };

// Routier assis (équipage du mode coop) : tête et bras articulés pour les animations
export function buildSeated(shirt = 0x3a5a8a, cap = 0xd8462b) {
  const b = new Builder();
  b.box('body', shirt, 0.46, 0.62, 0.3, 0, 0.31, 0, { r: 0.08 });
  b.box('body', 0x2a2a30, 0.4, 0.18, 0.5, 0, -0.02, 0.18);
  b.box('body', 0x2a2a30, 0.16, 0.5, 0.16, 0.11, -0.25, 0.42); b.box('body', 0x2a2a30, 0.16, 0.5, 0.16, -0.11, -0.25, 0.42);
  const g = b.build();
  const hb = new Builder();
  hb.box('body', 0xe0b090, 0.24, 0.27, 0.25, 0, 0.13, 0, { r: 0.09 });
  hb.box('body', cap, 0.27, 0.08, 0.28, 0, 0.29, 0); hb.box('body', cap, 0.22, 0.03, 0.14, 0, 0.26, 0.17);
  hb.box('body', 0x5a3a22, 0.2, 0.06, 0.04, 0, 0.04, 0.125); // moustache
  hb.box('body', 0x111111, 0.04, 0.035, 0.02, 0.06, 0.16, 0.128); hb.box('body', 0x111111, 0.04, 0.035, 0.02, -0.06, 0.16, 0.128);
  const head = hb.build(); head.position.set(0, 0.62, 0); g.add(head);
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.04, 0.02), new THREE.MeshStandardMaterial({ color: 0x3a0f0f, roughness: 0.8 }));
  mouth.position.set(0, 0.075, 0.127); head.add(mouth);
  const arm = () => { const ab = new Builder(); ab.box('body', shirt, 0.12, 0.5, 0.13, 0, -0.22, 0, { r: 0.04 }); ab.box('body', 0xe0b090, 0.1, 0.1, 0.1, 0, -0.5, 0); const a = ab.build(); return a; };
  const armL = arm(), armR = arm(); armL.position.set(0.29, 0.56, 0); armR.position.set(-0.29, 0.56, 0); g.add(armL, armR);
  return { group: g, head, armL, armR, mouth };
}
