// Chantiers vivants : dans la voie fermée par les cônes, de vrais ouvriers travaillent (pelle, marteau-piqueur,
// brouette, géomètre, homme-trafic avec drapeau) avec des engins animés (pelleteuse, rouleau compresseur,
// camion-benne, fourgon à gyrophares orange) et un enrobé tout frais qui fume. Si on fonce dans le chantier, tout le monde court.
import * as THREE from 'three';
import { roadToWorld, roadYaw, laneD } from './config.js';
import { pickLine } from './brain.js';

const _p = { x: 0, z: 0 };
const mat = {};
const M = (c, e) => (mat[c + '_' + (e || 0)] ||= new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.1, emissive: e || 0x000000, emissiveIntensity: e ? 0.5 : 0 }));
function box(par, m, w, h, d, x, y, z) { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; par.add(o); return o; }
function cyl(par, m, r, h, x, y, z, rz = 0, rx = 0) { const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 14), m); o.position.set(x, y, z); o.rotation.z = rz; o.rotation.x = rx; o.castShadow = true; par.add(o); return o; }

function worker(tool) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const vest = M(0xff7a10, 0x401800), pants = M(0x2a3550), skin = M([0xe0b090, 0xc08a60, 0x8a5a3a][Math.floor(Math.random() * 3)]), hat = M(Math.random() < 0.7 ? 0xf2f2f0 : 0xf0c020);
  const legs = [-1, 1].map(sx => { const l = new THREE.Group(); l.position.set(sx * 0.11, 0.85, 0); box(l, pants, 0.15, 0.85, 0.18, 0, -0.42, 0); body.add(l); return l; });
  box(body, vest, 0.46, 0.62, 0.27, 0, 1.18, 0); box(body, M(0xe8e8e8, 0x303030), 0.47, 0.05, 0.28, 0, 1.02, 0); box(body, M(0xe8e8e8, 0x303030), 0.47, 0.05, 0.28, 0, 1.3, 0);
  box(body, skin, 0.22, 0.25, 0.22, 0, 1.64, 0); box(body, hat, 0.28, 0.1, 0.3, 0, 1.81, 0.02);
  const arms = [-1, 1].map(sx => { const a = new THREE.Group(); a.position.set(sx * 0.3, 1.45, 0); box(a, vest, 0.11, 0.6, 0.11, 0, -0.28, 0); body.add(a); return a; });
  let item = null;
  if (tool === 'shovel') { item = new THREE.Group(); cyl(item, M(0x8a5a2a), 0.025, 1.3, 0, -0.55, 0.2, 0, 0.3); box(item, M(0x555a60), 0.26, 0.04, 0.3, 0, -1.15, 0.42); arms[1].add(item); }
  if (tool === 'flag') { item = new THREE.Group(); cyl(item, M(0x333333), 0.02, 0.9, 0, -0.75, 0); box(item, M(0xff5010, 0x401000), 0.04, 0.4, 0.5, 0, -0.45, 0.25); arms[1].add(item); }
  if (tool === 'jack') { item = new THREE.Group(); box(item, M(0xd02020), 0.18, 0.4, 0.18, 0, 0.55, 0); cyl(item, M(0x999999), 0.03, 0.55, 0, 0.12, 0); box(item, M(0x222222), 0.5, 0.05, 0.05, 0, 0.82, 0); g.add(item); item.position.set(0, 0, 0.45); }
  if (tool === 'coffee') { item = box(arms[1], M(0xf2f2f2), 0.08, 0.1, 0.08, 0, -0.6, 0.05); }
  if (tool === 'survey') { item = new THREE.Group(); for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; const l = cyl(item, M(0xc8c8c8), 0.015, 1.4, Math.cos(a) * 0.25, 0.65, Math.sin(a) * 0.25); l.rotation.z = Math.cos(a) * 0.2; l.rotation.x = -Math.sin(a) * 0.2; } box(item, M(0xf0c020), 0.18, 0.15, 0.22, 0, 1.4, 0); item.position.set(0, 0, 0.6); g.add(item); }
  if (tool === 'barrow') { item = new THREE.Group(); box(item, M(0x2a7a3a), 0.6, 0.3, 0.8, 0, 0.55, 0.9); cyl(item, M(0x151515), 0.18, 0.1, 0, 0.18, 1.3, Math.PI / 2); box(item, M(0x3a3a3a), 0.5, 0.25, 0.65, 0, 0.62, 0.9); g.add(item); }
  return { g, body, legs, arms, item, tool, t: Math.random() * 10, mode: tool };
}

function excavator() {
  const g = new THREE.Group(), Y = M(0xf0b400), D = M(0x222326), G = M(0x1a2430);
  box(g, D, 2.4, 0.7, 3.4, 0, 0.35, 0); for (const sx of [-1, 1]) box(g, M(0x111111), 0.55, 0.75, 3.6, sx * 1.0, 0.38, 0);
  const top = new THREE.Group(); top.position.y = 0.75; g.add(top);
  box(top, Y, 2.3, 0.9, 2.6, 0, 0.45, -0.3); box(top, Y, 1.1, 1.4, 1.2, -0.55, 1.6, 0.4); box(top, G, 1.0, 0.9, 1.15, -0.55, 1.75, 0.45);
  const beacon = box(top, M(0xff9010, 0xff9010), 0.2, 0.18, 0.2, -0.55, 2.4, 0.4);
  const boom = new THREE.Group(); boom.position.set(0.5, 1.1, 1.0); top.add(boom); box(boom, Y, 0.35, 0.4, 3.2, 0, 0, 1.6);
  const stick = new THREE.Group(); stick.position.set(0, 0, 3.2); boom.add(stick); box(stick, Y, 0.28, 0.3, 2.2, 0, 0, 1.1);
  const bucket = new THREE.Group(); bucket.position.set(0, 0, 2.2); stick.add(bucket); box(bucket, D, 0.8, 0.6, 0.6, 0, -0.2, 0.2);
  return { g, top, boom, stick, bucket, beacon };
}
function roller() {
  const g = new THREE.Group(), Y = M(0xf0b400);
  cyl(g, M(0x8a8e95), 0.75, 1.9, 0, 0.75, 1.3, Math.PI / 2); cyl(g, M(0x8a8e95), 0.75, 1.9, 0, 0.75, -1.3, Math.PI / 2);
  box(g, Y, 1.7, 0.9, 1.6, 0, 1.4, 0); box(g, M(0x1a2430), 1.2, 0.9, 0.9, 0, 2.3, -0.2); box(g, Y, 1.4, 0.08, 1.3, 0, 2.8, -0.2);
  const beacon = box(g, M(0xff9010, 0xff9010), 0.18, 0.16, 0.18, 0, 2.92, -0.2);
  return { g, beacon };
}
function dumper() {
  const g = new THREE.Group(), W = M(0xf2f2ee), O = M(0xe07010);
  box(g, W, 2.4, 1.6, 2.0, 0, 1.9, 2.6); box(g, M(0x1a2430), 2.3, 0.7, 0.05, 0, 2.3, 3.62); box(g, M(0x333333), 1.2, 0.4, 7.4, 0, 0.9, 0);
  const bed = box(g, O, 2.45, 1.3, 4.4, 0, 2.0, -1.2); bed.rotation.x = -0.08;
  box(g, M(0x222222), 2.2, 0.5, 4.0, 0, 2.5, -1.2);
  for (const sx of [-1, 1]) for (const z of [2.6, -1.0, -2.3]) cyl(g, M(0x151515), 0.5, 0.4, sx * 1.05, 0.5, z, Math.PI / 2);
  const beacon = box(g, M(0xff9010, 0xff9010), 0.2, 0.18, 0.2, 0.7, 2.8, 2.6);
  return { g, beacon };
}
function van() {
  const g = new THREE.Group(), W = M(0xf2f2ee);
  box(g, W, 2.0, 1.9, 5.2, 0, 1.4, 0); box(g, M(0x1a2430), 1.9, 0.6, 0.05, 0, 1.9, 2.62);
  for (let i = 0; i < 10; i++) box(g, M(i % 2 ? 0xe02020 : 0xf2f2f2), 0.21, 0.4, 0.02, -0.95 + i * 0.21, 1.0, -2.61);
  for (const sx of [-1, 1]) for (const z of [1.7, -1.7]) cyl(g, M(0x151515), 0.36, 0.25, sx * 0.95, 0.36, z, Math.PI / 2);
  const bar = [0, 1, 2, 3].map(i => box(g, new THREE.MeshStandardMaterial({ color: 0x331a00, emissive: 0xff8a00, emissiveIntensity: 0.2 }), 0.36, 0.14, 0.3, -0.6 + i * 0.4, 2.42, 0.8));
  return { g, bar };
}

export class Works {
  constructor(game) { this.g = game; this.sites = new Map(); this.t = 0; }
  clear() { for (const s of this.sites.values()) this.g.scene.remove(s.root); this.sites.clear(); }
  // dOff > 0 : côté opposé à la voie ouverte
  pose(w, s, dOff = 0) { const tow = w.lane === 0 ? -w.dir : w.dir; const d = laneD(w.dir, w.lane) - dOff * tow; roadToWorld(s, d, _p); return { x: _p.x, z: _p.z, yaw: roadYaw(s) + (w.dir < 0 ? Math.PI : 0) }; }
  put(site, obj, s, dOff = 0, yawOff = 0) { const p = this.pose(site.w, s, dOff); obj.position.set(p.x, 0, p.z); obj.rotation.y = p.yaw + yawOff; site.root.add(obj); return p; }
  build(w) {
    const root = new THREE.Group(), site = { w, root, workers: [], fx: [], t: 0 }, L = w.s1 - w.s0;
    const at = (f) => w.s0 + Math.min(L - 10, f);
    // enrobé frais (plus sombre) qui fume
    const len = Math.min(70, L - 40), a0 = at(L * 0.55);
    for (let s = a0; s < a0 + len; s += 6) { const p = this.pose(w, s); const m = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 6.2), M(0x16171a)); m.rotation.x = -Math.PI / 2; m.rotation.z = p.yaw; m.position.set(p.x, 0.025, p.z); m.receiveShadow = true; root.add(m); }
    site.asphalt = [a0, a0 + len];
    const vn = van(); this.put(site, vn.g, at(12)); site.van = vn;
    const ex = excavator(); this.put(site, ex.g, at(L * 0.3), 0.2, -0.5); site.ex = ex;
    const dp = dumper(); this.put(site, dp.g, at(L * 0.3) + 14, 0); site.dp = dp;
    const rl = roller(); this.put(site, rl.g, a0 + 10); site.rl = rl; site.rlBase = a0 + 10;
    const plan = [['flag', -55, -1.4 * 0], ['jack', L * 0.2, -0.6], ['shovel', L * 0.3 + 5, 1.1], ['shovel', L * 0.55 - 4, 0.8], ['barrow', L * 0.4, -0.9], ['survey', L * 0.7, 0.9], ['coffee', 20, 1.3], ['talk', 21.2, 1.3]];
    for (const [tool, f, dOff] of plan) {
      const k = worker(tool === 'talk' ? 'coffee' : tool); const s = tool === 'flag' ? w.s0 - 55 : at(f);
      const p = this.put(site, k.g, s, tool === 'flag' ? -0.2 : dOff, tool === 'talk' ? Math.PI : tool === 'flag' ? Math.PI : (Math.random() - 0.5) * 2);
      k.s = s; k.dOff = dOff; k.home = new THREE.Vector3(p.x, 0, p.z); k.talk = tool === 'talk'; site.workers.push(k);
    }
    this.g.scene.add(root);
    return site;
  }
  step(dt) {
    const g = this.g, pl = g.player; if (!pl) return; this.t += dt;
    const list = g.world.roadworks || [];
    for (const w of list) {
      const key = w.s0 + '_' + w.dir + '_' + w.lane, near = Math.abs(pl.road.s - (w.s0 + w.s1) / 2) < 650 + (w.s1 - w.s0) / 2;
      if (near && !this.sites.has(key)) this.sites.set(key, this.build(w));
      if (!near && this.sites.has(key)) { g.scene.remove(this.sites.get(key).root); this.sites.delete(key); }
    }
    for (const site of this.sites.values()) this.animate(site, dt, pl);
  }
  animate(site, dt, pl) {
    const g = this.g, t = (site.t += dt), w = site.w;
    // danger : le joueur entre dans la zone fermée
    const inZone = pl.road.s > w.s0 - 20 && pl.road.s < w.s1 && Math.abs(pl.road.d - laneD(w.dir, w.lane)) < 2.6 && pl.kmh > 25;
    if (inZone && !site.panic) { site.panic = 6; const k = site.workers.find(x => x.g.position.distanceTo(pl.curPos) < 60) || site.workers[1]; if (k) g.bubble?.({ cur: k.g.position, mesh: k.g, type: { h: 0.4 } }, pickLine('ouvrier_peur', ['ATTENTION !! Il fonce dans le chantier !', 'Mais il est malade lui !', 'Courez !!'])); g.heat = g.released ? Math.min(100, (g.heat || 0) + 2) : g.heat; }
    if (site.panic > 0) site.panic -= dt;
    // pelleteuse : creuse, pivote, vide dans la benne
    const ph = (t * 0.25) % 1, ex = site.ex;
    ex.top.rotation.y = ph < 0.5 ? 0 : Math.sin((ph - 0.5) * 2 * Math.PI) * 1.1;
    ex.boom.rotation.x = -0.55 + Math.sin(t * 0.25 * Math.PI * 2) * 0.2; ex.stick.rotation.x = 1.25 + Math.cos(t * 1.57) * 0.3; ex.bucket.rotation.x = 0.6 + Math.sin(t * 1.57) * 0.6;
    if (ph < 0.15 && Math.random() < 0.3) { ex.bucket.updateMatrixWorld(); const bp = new THREE.Vector3().setFromMatrixPosition(ex.bucket.matrixWorld); g.particles?.emit(bp.x, 0.4, bp.z, (Math.random() - 0.5), 0.8, (Math.random() - 0.5), 1.6, 0.6, 1.4, 0x8a7a60, 0.35); }
    // rouleau : aller-retour sur l'enrobé
    const rs = site.rlBase + (Math.sin(t * 0.22) * 0.5 + 0.5) * Math.max(4, site.asphalt[1] - site.asphalt[0] - 18);
    const rp = this.pose(w, rs); site.rl.g.position.set(rp.x, 0, rp.z);
    if (Math.random() < 0.15) { const s = site.asphalt[0] + Math.random() * (site.asphalt[1] - site.asphalt[0]); const p = this.pose(w, s, (Math.random() - 0.5) * 2.4); g.particles?.emit(p.x, 0.1, p.z, 0, 0.4, 0, 2.5, 0.5, 1.2, 0xbdbdbd, 0.12); }
    // gyrophares orange
    const on = (t * 1.6) % 1 < 0.5; for (const b of [ex.beacon, site.rl.beacon, site.dp.beacon]) b.material.emissiveIntensity = on ? 3 : 0.3;
    site.van.bar.forEach((b, i) => b.material.emissiveIntensity = ((Math.floor(t * 6) + i) % 4 === 0) ? 5 : 0.2);
    // ouvriers
    for (const k of site.workers) {
      k.t += dt; const [L, R] = k.arms, T = k.t;
      if (site.panic > 0 && k.tool !== 'flag') { // fuite sur le côté
        k.body.position.y = 0; const away = this.pose(w, k.s, Math.max(k.dOff, 0) + 3); const tgt = new THREE.Vector3(away.x, 0, away.z);
        const d = tgt.sub(k.g.position); if (d.length() > 0.2) { k.g.rotation.y = Math.atan2(d.x, d.z); k.g.position.addScaledVector(d.normalize(), Math.min(d.length(), 4 * dt)); }
        L.rotation.x = Math.sin(T * 14) * 0.9; R.rotation.x = -Math.sin(T * 14) * 0.9; k.legs[0].rotation.x = Math.sin(T * 14) * 0.7; k.legs[1].rotation.x = -Math.sin(T * 14) * 0.7; continue;
      }
      if (k.g.position.distanceTo(k.home) > 0.1 && k.tool !== 'barrow') { const d = k.home.clone().sub(k.g.position); k.g.rotation.y = Math.atan2(d.x, d.z); k.g.position.addScaledVector(d.normalize(), Math.min(d.length(), 1.2 * dt)); k.legs[0].rotation.x = Math.sin(T * 7) * 0.4; k.legs[1].rotation.x = -Math.sin(T * 7) * 0.4; continue; }
      k.legs.forEach(l => l.rotation.x *= 0.9);
      if (k.tool === 'shovel') { const c = (T * 0.8) % 1; k.body.rotation.x = c < 0.5 ? c * 0.9 : (1 - c) * 0.9; R.rotation.x = -0.6 - Math.sin(c * Math.PI * 2) * 0.5; L.rotation.x = -0.9 - Math.sin(c * Math.PI * 2) * 0.4; if (c > 0.45 && c < 0.5 && Math.random() < 0.5) g.particles?.emit(k.g.position.x, 0.6, k.g.position.z, Math.sin(k.g.rotation.y) * 1.5, 1.2, Math.cos(k.g.rotation.y) * 1.5, 1.2, 0.3, 0.6, 0x6a5a40, 0.4); }
      else if (k.tool === 'jack') { k.body.position.y = Math.abs(Math.sin(T * 40)) * 0.025; L.rotation.x = R.rotation.x = -0.75; k.item.position.y = Math.abs(Math.sin(T * 40)) * 0.04; if (Math.random() < 0.35) g.particles?.emit(k.g.position.x + Math.sin(k.g.rotation.y) * 0.45, 0.1, k.g.position.z + Math.cos(k.g.rotation.y) * 0.45, (Math.random() - 0.5) * 1.5, 1, (Math.random() - 0.5) * 1.5, 0.8, 0.25, 1, 0xc8c0b0, 0.4); }
      else if (k.tool === 'flag') { R.rotation.x = -1.5 + Math.sin(T * 2.2) * 0.9; L.rotation.x = 0; }
      else if (k.tool === 'survey') { L.rotation.x = R.rotation.x = -1.3; k.body.rotation.x = 0.25; if (Math.floor(T / 6) % 2) k.g.rotation.y += Math.sin(T) * 0.003; }
      else if (k.tool === 'coffee') { R.rotation.x = k.talk ? -0.4 + Math.sin(T * 3) * 0.6 : -2.0 + Math.max(0, Math.sin(T * 0.6)) * -0.5; L.rotation.x = k.talk ? Math.sin(T * 2.5) * 0.5 : 0; if (!k.said && Math.random() < 0.0008 && pl.curPos.distanceTo(k.g.position) < 80) { k.said = true; g.bubble?.({ cur: k.g.position, mesh: k.g, type: { h: 0.4 } }, pickLine('ouvrier', ['Tu crois qu’on finit avant l’hiver ?', 'C’est l’heure de la pause, non ?', 'Le chef a dit lundi… mais quel lundi ?'])); } }
      else if (k.tool === 'barrow') { // va-et-vient avec la brouette
        const s = k.s + Math.sin(T * 0.25) * 18 * site.w.dir; const p = this.pose(w, s, k.dOff); const old = k.g.position.clone(); k.g.position.set(p.x, 0, p.z);
        const d = k.g.position.clone().sub(old); if (d.lengthSq() > 1e-6) k.g.rotation.y = Math.atan2(d.x, d.z);
        L.rotation.x = R.rotation.x = -0.5; k.legs[0].rotation.x = Math.sin(T * 6) * 0.4; k.legs[1].rotation.x = -Math.sin(T * 6) * 0.4;
      }
    }
  }
  lightPoints(out) {
    for (const site of this.sites.values()) {
      const on = (site.t * 1.6) % 1 < 0.5;
      if (on) for (const b of [site.ex.beacon, site.rl.beacon, site.dp.beacon]) { b.updateMatrixWorld(); const p = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld); out.push([[p.x, p.y, p.z], 0xff9010, 2.4]); }
    }
  }
}
