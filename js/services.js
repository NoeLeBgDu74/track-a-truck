// Services d'urgence : après un accident, une ambulance (SAMU), les pompiers (choc grave) et une dépanneuse
// arrivent par la bande d'arrêt d'urgence, gyrophares allumés. Les secouristes vont chercher les blessés,
// les pompiers éteignent la fumée, la dépanneuse charge l'épave et repart.
import * as THREE from 'three';
import { roadToWorld, roadYaw, worldToRoad, SHOULDER_D } from './config.js';
import { pickLine } from './brain.js';

const _p = { x: 0, z: 0 }, _r = {};
const M = (c, e, ei = 0.6) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.15, emissive: e || 0x000000, emissiveIntensity: e ? ei : 0 });

function box(g, m, w, h, d, x, y, z) { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; }
function wheels(g, xs, zs, r = 0.4) { const tm = M(0x151515), rm = M(0xb0b4ba); for (const x of xs) for (const z of zs) { const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.3, 14), tm); w.rotation.z = Math.PI / 2; w.position.set(x, r, z); g.add(w); const h = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.32, 10), rm); h.rotation.z = Math.PI / 2; h.position.copy(w.position); g.add(h); } }
function decal(text, bg, fg, w = 512, h = 128, check) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, w, h);
  if (check) for (let i = 0; i < w / 32; i++) for (let j = 0; j < 2; j++) { x.fillStyle = (i + j) % 2 ? check[0] : check[1]; x.fillRect(i * 32, h - 64 + j * 32, 32, 32); }
  x.fillStyle = fg; x.font = `900 ${h * 0.42}px Arial`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, w / 2, check ? h * 0.3 : h / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function side(g, tex, len, h, y, w) { for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(len, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 })); p.position.set(sx * (w / 2 + 0.01), y, 0); p.rotation.y = sx * Math.PI / 2; g.add(p); } }
function lightBar(g, y, z, w, cols) { const L = []; cols.forEach((c, i) => { const m = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: c, emissiveIntensity: 0.2 }); const o = box(g, m, w / cols.length - 0.04, 0.14, 0.3, -w / 2 + (i + 0.5) * w / cols.length, y, z); L.push({ m, c, x: o.position.x, y, z }); }); return L; }

function buildAmbulance() {
  const g = new THREE.Group(), wht = M(0xf4f4f0), glass = M(0x1a2430);
  box(g, wht, 2.1, 1.0, 5.6, 0, 1.0, 0); box(g, wht, 2.1, 1.5, 3.6, 0, 2.2, -0.9); box(g, glass, 2.0, 0.6, 0.05, 0, 1.9, 1.65); box(g, wht, 2.1, 0.7, 1.6, 0, 1.75, 1.95);
  side(g, decal('SAMU', '#f4f4f0', '#1a4fa8', 512, 160, ['#f2c200', '#1a4fa8']), 3.6, 1.1, 2.0, 2.1);
  box(g, M(0xf2c200), 2.12, 0.2, 5.62, 0, 0.75, 0);
  const lights = lightBar(g, 3.02, 0.9, 1.6, [0x2060ff, 0x2060ff, 0x2060ff]).concat(lightBar(g, 3.02, -2.6, 1.6, [0x2060ff, 0xff9010, 0x2060ff]));
  box(g, M(0xfff6e0, 0xfff0d0, 0.4), 0.3, 0.15, 0.05, 0.75, 1.05, 2.8); box(g, M(0xfff6e0, 0xfff0d0, 0.4), 0.3, 0.15, 0.05, -0.75, 1.05, 2.8);
  wheels(g, [-0.95, 0.95], [1.9, -1.8], 0.38);
  return { g, lights, len: 5.8, w: 2.1, h: 3, pinpon: true };
}
function buildFire() {
  const g = new THREE.Group(), red = M(0xc8141e), glass = M(0x1a2430), alu = M(0xb8bcc2, 0, 0); alu.metalness = 0.9;
  box(g, red, 2.5, 1.6, 2.4, 0, 1.9, 2.6); box(g, glass, 2.4, 0.7, 0.05, 0, 2.3, 3.82); box(g, red, 2.5, 2.2, 5.4, 0, 2.0, -1.5);
  box(g, alu, 2.3, 0.15, 5.2, 0, 3.2, -1.5); box(g, alu, 0.5, 0.25, 6.4, 0.6, 3.4, -1.2); // échelle
  for (let i = 0; i < 12; i++) box(g, alu, 0.5, 0.05, 0.05, 0.6, 3.55, -4.2 + i * 0.5);
  side(g, decal('POMPIERS', '#c8141e', '#ffffff', 512, 128), 5.2, 0.7, 2.4, 2.5);
  box(g, M(0xe8e8e0), 2.52, 0.15, 7.8, 0, 1.1, -0.3);
  const lights = lightBar(g, 2.82, 2.9, 2.0, [0x2060ff, 0x2060ff, 0x2060ff, 0x2060ff]);
  wheels(g, [-1.1, 1.1], [2.4, -1.6, -3.0], 0.5);
  return { g, lights, len: 8, w: 2.5, h: 3.6, pinpon: true };
}
function buildTow() {
  const g = new THREE.Group(), yel = M(0xf0b400), glass = M(0x1a2430), grey = M(0x3a3d42);
  box(g, yel, 2.3, 1.7, 2.2, 0, 1.85, 2.9); box(g, glass, 2.2, 0.7, 0.05, 0, 2.3, 4.02);
  box(g, grey, 1.2, 0.4, 7.6, 0, 0.9, 0);
  const bed = new THREE.Group(); bed.position.set(0, 1.25, -1.2); g.add(bed);
  box(bed, M(0x2a2c30), 2.4, 0.12, 5.4, 0, 0, 0); for (const sx of [-1, 1]) box(bed, yel, 0.08, 0.25, 5.4, sx * 1.18, 0.15, 0);
  side(g, decal('DÉPANNAGE 24/24', '#f0b400', '#111111', 512, 128), 2.1, 0.6, 1.7, 2.3);
  const lights = lightBar(g, 2.8, 2.9, 1.6, [0xff9010, 0xff9010, 0xff9010]);
  wheels(g, [-1.05, 1.05], [2.9, -1.5, -2.6], 0.45);
  return { g, lights, len: 8, w: 2.3, h: 3, bed };
}
function person(top, pants) {
  const g = new THREE.Group(), T = M(top), P = M(pants), S = M(0xe0b090);
  const bx = (m, w, h, d, x, y, z, par = g) => box(par, m, w, h, d, x, y, z);
  const legs = [-1, 1].map(sx => { const l = new THREE.Group(); l.position.set(sx * 0.11, 0.85, 0); bx(P, 0.15, 0.85, 0.18, 0, -0.42, 0, l); g.add(l); return l; });
  bx(T, 0.46, 0.62, 0.26, 0, 1.18, 0); bx(S, 0.22, 0.25, 0.22, 0, 1.64, 0);
  const arms = [-1, 1].map(sx => { const a = new THREE.Group(); a.position.set(sx * 0.3, 1.45, 0); bx(T, 0.11, 0.6, 0.11, 0, -0.28, 0, a); g.add(a); return a; });
  return { g, legs, arms };
}

export class Services {
  constructor(game) { this.g = game; this.units = []; this.incidents = []; this.people = []; this.t = 0; }
  clear() {
    for (const u of this.units) { this.g.scene.remove(u.m.g); this.g.audio?.updateSiren(u, false); if (u.body) this.g.phys.removeRigidBody(u.body); }
    for (const p of this.people) this.g.scene.remove(p.g);
    this.units = []; this.incidents = []; this.people = [];
  }
  addHurt(s, dir, obj) { const i = this.incidents.find(x => x.dir === dir && Math.abs(x.s - s) < 80); if (i && obj && !i.hurt.includes(obj)) i.hurt.push(obj); }
  // un accident vient de se produire
  report(inc) {
    const g = this.g; if (g.mirror || g.state !== 'play') return;
    const pl = g.player; if (pl && Math.abs(pl.road.s - inc.s) > 900) return;
    if (this.incidents.length >= 3 || this.incidents.some(i => Math.abs(i.s - inc.s) < 60 && i.dir === inc.dir)) { const near = this.incidents.find(i => Math.abs(i.s - inc.s) < 60); if (near && inc.hurt) near.hurt.push(...inc.hurt); return; }
    inc.t = 0; inc.hurt ||= []; inc.cars ||= []; inc.stage = 0; inc.cars.forEach(c => c.awaitTow = true);
    inc.ambT = 14 + Math.random() * 8; inc.fireT = inc.severe ? 10 + Math.random() * 6 : 1e9; inc.towT = 32 + Math.random() * 12;
    this.incidents.push(inc);
    setTimeout(() => g.state === 'play' && g.say?.('svc' + Math.round(inc.s / 100), `🚑 SAMU : véhicule engagé sur un accident au PK ${(inc.s / 1000).toFixed(1)}.`, 25, ''), 2500);
  }
  spawn(kind, inc) {
    const m = kind === 'amb' ? buildAmbulance() : kind === 'fire' ? buildFire() : buildTow();
    const u = { kind, m, inc, s: inc.s - inc.dir * 420, d: SHOULDER_D(inc.dir) * 0.97, v: 24, state: 'go', t: 0, pos: new THREE.Vector3(), yaw: 0, pinpon: m.pinpon };
    u.stopS = kind === 'tow' ? inc.s + inc.dir * 9 : kind === 'fire' ? inc.s - inc.dir * 26 : inc.s - inc.dir * 13;
    this.g.scene.add(m.g); this.units.push(u);
    const R = this.g.R; u.body = this.g.phys.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
    this.g.phys.createCollider(R.ColliderDesc.cuboid(m.w / 2, m.h / 2, m.len / 2).setTranslation(0, m.h / 2, 0).setMass(5000), u.body);
    this.place(u);
    return u;
  }
  place(u) {
    roadToWorld(u.s, u.d, _p); const yaw = roadYaw(u.s) + (u.inc.dir < 0 ? Math.PI : 0);
    u.pos.set(_p.x, 0, _p.z); u.yaw = yaw; u.m.g.position.copy(u.pos); u.m.g.rotation.y = yaw;
    u.body?.setNextKinematicTranslation({ x: _p.x, y: 0, z: _p.z }); u.body?.setNextKinematicRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
  }
  addPerson(x, z, yaw, kind) {
    const p = person(kind === 'fire' ? 0x1a1d24 : kind === 'tow' ? 0xf06a10 : 0xf4f4f0, kind === 'fire' ? 0x1a1d24 : kind === 'tow' ? 0x2a3550 : 0x2a6a3a);
    if (kind === 'fire') box(p.g, M(0xd8e030, 0x303000), 0.48, 0.08, 0.28, 0, 1.0, 0); // bandes réfléchissantes
    if (kind === 'fire') box(p.g, M(0xf0c020), 0.28, 0.12, 0.3, 0, 1.82, 0);           // casque F1
    p.g.position.set(x, 0, z); p.g.rotation.y = yaw; this.g.scene.add(p.g); p.t = 0; this.people.push(p); return p;
  }
  walk(p, target, dt, speed = 1.6) {
    const d = target.clone().sub(p.g.position); d.y = 0; const L = d.length();
    if (L < 0.15) { p.legs.forEach(l => l.rotation.x = 0); return true; }
    p.g.rotation.y = Math.atan2(d.x, d.z); p.g.position.addScaledVector(d.normalize(), Math.min(L, speed * dt));
    p.t += dt; p.legs[0].rotation.x = Math.sin(p.t * 8) * 0.5; p.legs[1].rotation.x = -Math.sin(p.t * 8) * 0.5; return false;
  }
  step(dt) {
    const g = this.g; if (g.mirror) return; this.t += dt;
    const pl = g.player;
    for (const inc of this.incidents) {
      inc.t += dt;
      if (!inc.amb && inc.t > inc.ambT) inc.amb = this.spawn('amb', inc);
      if (!inc.fire && inc.t > inc.fireT) inc.fire = this.spawn('fire', inc);
      if (!inc.tow && inc.t > inc.towT && inc.cars.length) inc.tow = this.spawn('tow', inc);
    }
    for (const u of this.units) {
      u.t += dt; const inc = u.inc;
      if (u.state === 'go') {
        const left = (u.stopS - u.s) * inc.dir; const want = left < 60 ? Math.max(2, left * 0.45) : 24;
        u.v += Math.max(-6, Math.min(3, want - u.v)) * dt * 1.5; u.s += inc.dir * u.v * dt;
        if (left < 0.6) { u.state = 'work'; u.t = 0; u.v = 0; this.arrive(u); }
      } else if (u.state === 'work') this.work(u, dt);
      else if (u.state === 'leave') { u.v = Math.min(26, u.v + 2.5 * dt); u.s += inc.dir * u.v * dt; if (u.t > 3 && u.d !== SHOULDER_D(inc.dir) * 0.6) u.d += (SHOULDER_D(inc.dir) * 0.6 - u.d) * dt; if (pl && Math.abs(u.s - pl.road.s) > 900) u.dead = true; }
      this.place(u);
      if (u.load) { // épave chargée sur le plateau
        u.m.bed.updateMatrixWorld(); const tp = new THREE.Vector3(0, 0.1, 0).applyMatrix4(u.m.bed.matrixWorld);
        u.load.mesh.position.lerp(tp, Math.min(1, dt * (u.state === 'work' ? 1.2 : 20))); u.load.mesh.quaternion.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, u.yaw, 0)), Math.min(1, dt * 2));
      }
      const on = u.state !== 'leave' || u.kind !== 'tow';
      if (u.state !== 'work' || u.kind !== 'tow') g.audio?.updateSiren(u, on && u.kind !== 'tow' && u.state === 'go' && pl && u.pos.distanceToSquared(pl.curPos) < 500 * 500);
      else g.audio?.updateSiren(u, false);
      const blink = (this.t * 2.4 + u.s * 0.01) % 1;
      u.m.lights.forEach((L, i) => L.m.emissiveIntensity = ((i % 2 === 0) === (blink < 0.5)) ? 6 : 0.2);
    }
    for (const u of this.units) if (u.dead) { g.scene.remove(u.m.g); g.audio?.updateSiren(u, false); if (u.body) g.phys.removeRigidBody(u.body); if (u.load && !u.load.dead) { g.traffic.remove(u.load); g.traffic.cars = g.traffic.cars.filter(c => c !== u.load); } }
    this.units = this.units.filter(u => !u.dead);
    this.incidents = this.incidents.filter(i => !(i.done = i.t > 30 && (!i.amb || i.amb.dead || i.amb.state === 'leave') && (!i.fire || i.fire.dead || i.fire.state === 'leave') && (!i.cars.length || (i.tow && (i.tow.dead || i.tow.state === 'leave')))) && i.t < 240);
  }
  arrive(u) {
    const inc = u.inc, fx = Math.sin(u.yaw), fz = Math.cos(u.yaw), lx = Math.cos(u.yaw), lz = -Math.sin(u.yaw);
    const at = (f, l) => new THREE.Vector3(u.pos.x + fx * f + lx * l, 0, u.pos.z + fz * f + lz * l);
    if (u.kind === 'amb') {
      u.crew = [this.addPerson(...at(-2.6, 0.6).toArray().filter((_, i) => i !== 1), u.yaw, 'amb'), this.addPerson(...at(-2.6, -0.6).toArray().filter((_, i) => i !== 1), u.yaw, 'amb')];
      u.stretcher = box(new THREE.Group(), M(0xd8d8d8), 0.6, 0.12, 1.9, 0, 0, 0).parent; this.g.scene.add(u.stretcher); u.stretcher.visible = false;
      u.targets = inc.hurt.filter(h => h && (h.piv || h.grp || h.g)).slice(0, 2);
      this.g.bubble?.({ cur: u.pos, mesh: u.m.g, type: { h: 2.4 } }, pickLine('secouriste', ['On arrive ! Ne bougez pas !', 'SAMU ! Où sont les blessés ?']));
    } else if (u.kind === 'fire') {
      u.crew = [this.addPerson(at(3, 1.6).x, at(3, 1.6).z, u.yaw, 'fire'), this.addPerson(at(3, -1.6).x, at(3, -1.6).z, u.yaw, 'fire')];
    } else {
      u.crew = [this.addPerson(at(2, 1.6).x, at(2, 1.6).z, u.yaw, 'tow')];
      u.queue = inc.cars.filter(c => c && !c.dead).slice(0, 1);
    }
  }
  work(u, dt) {
    const inc = u.inc, g = this.g;
    if (u.kind === 'amb') {
      const [a, b] = u.crew, tgt = u.targets[0], tpos = tgt ? (tgt.piv || tgt.grp || tgt.g).position : null;
      if (u.phase == null) u.phase = 0;
      if (u.phase === 0) { // aller jusqu'au blessé
        if (!tpos) { u.phase = 3; return; }
        const s1 = this.walk(a, tpos.clone().add(new THREE.Vector3(0.7, 0, 0)), dt), s2 = this.walk(b, tpos.clone().add(new THREE.Vector3(-0.7, 0, 0)), dt);
        if (s1 && s2) { u.phase = 1; u.pt = 0; [a, b].forEach(p => { p.arms.forEach(x => x.rotation.x = -1.2); }); g.bubble?.({ cur: a.g.position, mesh: a.g, type: { h: 0.6 } }, pickLine('soins', ['Monsieur, vous m’entendez ?', 'On va vous immobiliser, d’accord ?', 'Restez avec moi !'])); }
      } else if (u.phase === 1) { // soins
        u.pt += dt; a.g.position.y = b.g.position.y = -0.35; // à genoux
        if (u.pt > 6) { u.phase = 2; a.g.position.y = b.g.position.y = 0; const o = tgt.piv || tgt.grp || tgt.g; o.visible = false; u.stretcher.visible = true; u.carried = o; }
      } else if (u.phase === 2) { // brancard jusqu'à l'ambulance
        const back = u.pos.clone().add(new THREE.Vector3(-Math.sin(u.yaw) * 3.4, 0, -Math.cos(u.yaw) * 3.4));
        const s1 = this.walk(a, back.clone().add(new THREE.Vector3(0.6, 0, 0)), dt, 1.1), s2 = this.walk(b, back.clone().add(new THREE.Vector3(-0.6, 0, 0)), dt, 1.1);
        u.stretcher.position.set((a.g.position.x + b.g.position.x) / 2, 0.85, (a.g.position.z + b.g.position.z) / 2); u.stretcher.rotation.y = a.g.rotation.y;
        if (s1 && s2) { u.targets.shift(); u.stretcher.visible = false; if (u.targets.length) u.phase = 0; else u.phase = 3; }
      } else if (u.phase === 3) { // tout le monde remonte, départ
        const s1 = this.walk(a, u.pos, dt), s2 = this.walk(b, u.pos, dt);
        if (s1 && s2) { this.dropCrew(u); g.scene.remove(u.stretcher); u.state = 'leave'; u.t = 0; g.say?.('svcl' + Math.round(inc.s / 100), `🚑 SAMU : blessé(s) pris en charge au PK ${(inc.s / 1000).toFixed(1)}, on évacue.`, 25, ''); }
      }
    } else if (u.kind === 'fire') {
      const car = inc.cars[0]; const cp = car?.mesh?.position;
      if (u.t < 25 && cp) {
        u.crew.forEach((p, i) => { const tg = cp.clone().add(new THREE.Vector3((i ? -1 : 1) * 2.4, 0, -1.5)); if (this.walk(p, tg, dt)) { p.g.lookAt(cp.x, 0, cp.z); p.arms[1].rotation.x = -1.3; if (Math.random() < 0.6) g.particles?.emit(p.g.position.x + (cp.x - p.g.position.x) * 0.25, 1.2, p.g.position.z + (cp.z - p.g.position.z) * 0.25, (cp.x - p.g.position.x) * 1.6, 0.6, (cp.z - p.g.position.z) * 1.6, 0.7, 0.18, 1.2, 0xeef6ff, 0.6); } });
        if (u.t > 8 && car.react) car.react.smk = 99; // feu / fumée éteints
      } else { if (u.crew.every(p => this.walk(p, u.pos, dt))) { this.dropCrew(u); u.state = 'leave'; u.t = 0; } }
    } else {
      const car = u.queue?.[0], [p] = u.crew;
      if (!car) { if (this.walk(p, u.pos, dt)) { this.dropCrew(u); u.state = 'leave'; u.t = 0; } return; }
      if (!u.hooked) { u.m.bed.rotation.x = Math.min(0.18, u.m.bed.rotation.x + dt * 0.1); if (this.walk(p, car.mesh.position.clone().add(new THREE.Vector3(1.6, 0, 0)), dt) && u.t > 5) { u.hooked = true; u.t = 0; if (car.body) { g.phys.removeRigidBody(car.body); car.body = null; } if (car.trailer?.body) { g.phys.removeRigidBody(car.trailer.body); car.trailer.body = null; g.scene.remove(car.trailer.mesh); } car.towed = true; u.load = car; if (car.ped) { g.scene.remove(car.ped.grp); car.ped = null; } } }
      else { u.m.bed.rotation.x = Math.max(0, u.m.bed.rotation.x - dt * 0.05); if (u.t > 6 && this.walk(p, u.pos, dt)) { this.dropCrew(u); u.state = 'leave'; u.t = 0; g.say?.('tow' + Math.round(inc.s / 100), `🚛 Dépanneuse : épave dégagée au PK ${(inc.s / 1000).toFixed(1)}.`, 25, ''); } }
    }
  }
  dropCrew(u) { for (const p of u.crew || []) { this.g.scene.remove(p.g); this.people = this.people.filter(x => x !== p); } u.crew = []; }
  lightPoints(out) {
    for (const u of this.units) {
      const fx = Math.sin(u.yaw), fz = Math.cos(u.yaw), lx = Math.cos(u.yaw), lz = -Math.sin(u.yaw);
      for (const L of u.m.lights) if (L.m.emissiveIntensity > 1) out.push([[u.pos.x + fx * L.z + lx * L.x, L.y, u.pos.z + fz * L.z + lz * L.x], L.c, 3.2]);
      if (u.state !== 'work') for (const k of [-1, 1]) out.push([[u.pos.x + fx * (u.m.len / 2) + lx * k * 0.75, 1.0, u.pos.z + fz * (u.m.len / 2) + lz * k * 0.75], 0xfff2dc, 1.3]);
    }
  }
}
