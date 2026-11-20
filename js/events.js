// Imprévus de la route, devant le joueur : sangliers qui traversent, chargement perdu sur une voie,
// vache échappée (et son fermier qui court derrière). Info trafic à la radio, le trafic freine et contourne,
// et si on les percute… ça vole (et ça abîme le camion).
import * as THREE from 'three';
import { roadToWorld, roadYaw, laneD, SHOULDER_D, worldToRoad } from './config.js';

const _p = { x: 0, z: 0 };
const mats = {}; const M = c => (mats[c] ||= new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }));
const at = (s, d) => { roadToWorld(s, d, _p); return new THREE.Vector3(_p.x, 0, _p.z); };
function box(par, m, w, h, d, x, y, z) { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; par.add(o); return o; }

function boar(scale = 1) {
  const g = new THREE.Group(), b = new THREE.Group(); g.add(b); const fur = M(0x4a3a2c), dark = M(0x2a211a);
  box(b, fur, 0.5, 0.5, 1.1, 0, 0.55, 0); box(b, fur, 0.38, 0.38, 0.4, 0, 0.6, 0.7); box(b, dark, 0.2, 0.16, 0.18, 0, 0.52, 0.95);
  box(b, M(0xe8e0d0), 0.04, 0.04, 0.12, 0.09, 0.5, 0.98); box(b, M(0xe8e0d0), 0.04, 0.04, 0.12, -0.09, 0.5, 0.98);
  const legs = []; for (const x of [-0.17, 0.17]) for (const z of [-0.38, 0.38]) { const l = new THREE.Group(); l.position.set(x, 0.32, z); box(l, dark, 0.1, 0.32, 0.1, 0, -0.16, 0); b.add(l); legs.push(l); }
  g.scale.setScalar(scale); return { g, b, legs };
}
function cow() {
  const g = new THREE.Group(), b = new THREE.Group(); g.add(b); const w = M(0xf2f0ea), blk = M(0x1c1c1c);
  box(b, w, 0.75, 0.8, 1.7, 0, 1.15, 0); box(b, blk, 0.76, 0.5, 0.6, 0, 1.3, -0.2); box(b, blk, 0.4, 0.35, 0.5, 0.18, 1.1, 0.5);
  box(b, w, 0.42, 0.45, 0.55, 0, 1.35, 1.05); box(b, M(0xe0a0a0), 0.3, 0.2, 0.15, 0, 1.2, 1.35); box(b, M(0xd8c8a0), 0.6, 0.06, 0.06, 0, 1.6, 1.0);
  box(b, M(0xe0a0a0), 0.3, 0.2, 0.3, 0, 0.7, -0.3);
  const legs = []; for (const x of [-0.26, 0.26]) for (const z of [-0.6, 0.6]) { const l = new THREE.Group(); l.position.set(x, 0.78, z); box(l, w, 0.16, 0.78, 0.16, 0, -0.39, 0); b.add(l); legs.push(l); }
  return { g, b, legs };
}
function farmer() {
  const g = new THREE.Group(), b = new THREE.Group(); g.add(b);
  const legs = [-1, 1].map(sx => { const l = new THREE.Group(); l.position.set(sx * 0.11, 0.85, 0); box(l, M(0x2a4a7a), 0.15, 0.85, 0.18, 0, -0.42, 0); b.add(l); return l; });
  box(b, M(0x2a4a7a), 0.46, 0.62, 0.27, 0, 1.18, 0); box(b, M(0xe0b090), 0.22, 0.25, 0.22, 0, 1.64, 0); box(b, M(0x3a2a1a), 0.36, 0.06, 0.36, 0, 1.8, 0);
  const arms = [-1, 1].map(sx => { const a = new THREE.Group(); a.position.set(sx * 0.3, 1.45, 0); box(a, M(0x2a4a7a), 0.11, 0.6, 0.11, 0, -0.28, 0); b.add(a); return a; });
  return { g, b, legs, arms };
}

export class RoadEvents {
  constructor(game) { this.g = game; this.list = []; this.next = 60 + Math.random() * 60; }
  clear() { for (const e of this.list) this.g.scene.remove(e.root); this.list = []; this.next = 60 + Math.random() * 60; }
  step(dt) {
    const g = this.g, pl = g.player; if (!pl || g.state !== 'play' || g.mirror) return;
    this.next -= dt;
    if (this.next <= 0 && pl.road.d < -1 && pl.road.d > -16 && pl.kmh > 40 && this.list.length < 2) { this.next = 100 + Math.random() * 120; this.spawn(pl.road.s + 330 + Math.random() * 120); }
    for (const e of this.list) this.update(e, dt, pl);
    this.list = this.list.filter(e => { if (e.dead || Math.abs(e.s - pl.road.s) > 900) { g.scene.remove(e.root); return false; } return true; });
  }
  spawn(s, kind) {
    const g = this.g; if (g.toll && Math.abs(s - 2700) < 150) s += 300;
    kind ||= ['boars', 'load', 'cow'][Math.floor(Math.random() * 3)];
    const root = new THREE.Group(); g.scene.add(root);
    const e = { kind, s, root, t: 0, items: [] };
    if (kind === 'boars') {
      const n = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) { const b = boar(i === 0 ? 1.25 : 0.65 + Math.random() * 0.2); root.add(b.g); b.d = SHOULDER_D(1) - 4 - i * 1.6; b.s = s + (Math.random() - 0.5) * 3; b.speed = 4.2 + Math.random(); e.items.push(b); }
      g.say?.('evb' + Math.round(s / 100), `📻 Info trafic : présence d’animaux sauvages sur la chaussée au PK ${(s / 1000).toFixed(1)}, soyez prudents.`, 30, '');
    } else if (kind === 'load') {
      const lane = Math.floor(Math.random() * 3), d = laneD(1, lane);
      const mat = box(root, M(0xe8e0f0), 1.4, 0.25, 1.9, 0, 0.13, 0); const p = at(s, d); mat.position.set(p.x, 0.13, p.z); mat.rotation.y = roadYaw(s) + 0.6;
      for (let i = 0; i < 4; i++) { const c = box(root, M(0xa8814f), 0.6, 0.5, 0.6, 0, 0.25, 0); const q = at(s + 4 + Math.random() * 10, d + (Math.random() - 0.5) * 2.5); c.position.set(q.x, 0.25, q.z); c.rotation.y = Math.random() * 3; }
      e.lane = lane; e.d = d;
      g.say?.('evl' + Math.round(s / 100), `📻 Info trafic : objets sur la voie ${['de gauche', 'du milieu', 'de droite'][lane]} au PK ${(s / 1000).toFixed(1)}.`, 30, '');
    } else {
      const c = cow(); root.add(c.g); c.d = laneD(1, 2) + (Math.random() - 0.5); c.s = s; e.items.push(c); e.cow = c;
      const f = farmer(); root.add(f.g); f.d = SHOULDER_D(1) - 6; f.s = s - 25; e.farmer = f;
      g.say?.('evc' + Math.round(s / 100), `📻 Info trafic : une vache en divagation sur l’A77 au PK ${(s / 1000).toFixed(1)} ! Oui, une vache.`, 30, '');
    }
    this.list.push(e);
  }
  update(e, dt, pl) {
    const g = this.g; e.t += dt; const yaw = roadYaw(e.s);
    const place = (o, s, d, face) => { const p = at(s, d); o.g.position.set(p.x, o.g.position.y, p.z); o.g.rotation.y = face; };
    const hit = (o, s, d, r) => { const p = at(s, d); return pl.curPos.distanceTo(p) < r + pl.def.w / 2 && pl.kmh > 15; };
    if (e.kind === 'boars') {
      for (const b of e.items) {
        if (b.fly) { b.fly.vy -= 9.8 * dt; b.g.position.addScaledVector(b.fly.v, dt); b.g.position.y = Math.max(0, b.g.position.y + b.fly.vy * dt); b.b.rotation.x += 8 * dt; if (b.g.position.y <= 0 && b.fly.vy < 0) { b.fly.v.multiplyScalar(0.9); if (b.fly.v.length() < 0.5) { b.fly = null; b.dead = true; b.b.rotation.set(0, 0, Math.PI / 2); } } continue; }
        if (b.dead) continue;
        if (e.t > 2) b.d += b.speed * dt; // traverse de droite à gauche
        place(b, b.s, b.d, yaw + Math.PI / 2);
        b.legs.forEach((l, i) => l.rotation.x = e.t > 2 ? Math.sin(e.t * 16 + i * 1.6) * 0.6 : 0);
        if (hit(b, b.s, b.d, 0.6)) { b.fly = { v: pl.lastV.clone().multiplyScalar(0.6).add(new THREE.Vector3((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3)), vy: 4 }; pl.damage = Math.min(100, pl.damage + 6); g.audio?.crash?.(pl.curPos, 4); g.hud?.toast('🐗 Sanglier percuté !'); }
        if (b.d > 16) b.dead = true;
      }
      if (e.items.every(b => b.dead && !b.fly) && e.t > 30) e.dead = true;
    } else if (e.kind === 'load') { if (e.t > 75) e.dead = true; }
    else {
      const c = e.cow, f = e.farmer;
      if (!c.fly) {
        c.s += Math.sin(e.t * 0.3) * 0.6 * dt; c.d += Math.sin(e.t * 0.21) * 0.5 * dt;
        place(c, c.s, c.d, yaw + Math.sin(e.t * 0.3) * 1.2);
        c.b.rotation.x = Math.sin(e.t * 0.7) * 0.05;
        if (hit(c, c.s, c.d, 1.0)) { c.fly = { v: pl.lastV.clone().multiplyScalar(0.4), vy: 3 }; pl.damage = Math.min(100, pl.damage + 18); g.audio?.crash?.(pl.curPos, 7); g.hud?.big('MEUUUH !', 'wanted'); }
        if (e.t > 50 && !e.leaving) { e.leaving = true; g.bubble?.({ cur: f.g.position, mesh: f.g, type: { h: 0.4 } }, 'Allez Marguerite, on rentre !'); }
        if (e.leaving) c.d -= 1.2 * dt;
      } else { c.fly.vy -= 9.8 * dt; c.g.position.addScaledVector(c.fly.v, dt); c.g.position.y = Math.max(0, c.g.position.y + c.fly.vy * dt); c.b.rotation.z += 2 * dt; if (c.g.position.y <= 0 && c.fly.vy < 0) { c.fly.v.multiplyScalar(0.85); c.b.rotation.z = Math.min(c.b.rotation.z, Math.PI / 2); } }
      // le fermier court après sa vache
      const tgt = e.leaving ? SHOULDER_D(1) - 8 : c.d - 1.8, ds = (c.s - 2) - f.s; f.s += Math.sign(ds) * Math.min(Math.abs(ds), 3.2 * dt); f.d += Math.sign(tgt - f.d) * Math.min(Math.abs(tgt - f.d), 2.2 * dt);
      place(f, f.s, f.d, yaw + (Math.abs(ds) > 0.5 ? 0 : Math.PI / 2));
      f.legs[0].rotation.x = Math.sin(e.t * 10) * 0.6; f.legs[1].rotation.x = -Math.sin(e.t * 10) * 0.6; f.arms[0].rotation.x = -2.6 + Math.sin(e.t * 6) * 0.5;
      if (!e.said && pl.road.s > e.s - 120) { e.said = true; g.bubble?.({ cur: f.g.position, mesh: f.g, type: { h: 0.4 } }, 'Marguerite ! Reviens ici ! MARGUERITE !'); }
      if (e.leaving && c.d < SHOULDER_D(1) - 10) e.dead = true;
      if (e.t > 120) e.dead = true;
    }
  }
  // obstacles pour le trafic (freinage / contournement)
  obstacles(obs) {
    for (const e of this.list) {
      if (e.kind === 'load') obs.push({ s: e.s + 6, d: e.d, v: 0, front: 10, back: 10, w: 3, works: true });
      else for (const o of e.items) if (!o.dead && !o.fly && o.d > SHOULDER_D(1) - 1 && o.d < 1) obs.push({ s: o.s, d: o.d, v: 0, front: 1.5, back: 1.5, w: 1.6, wreck: true });
    }
  }
}
