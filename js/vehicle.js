// Véhicule pilotable : Rapier DynamicRayCastVehicleController + transmission + dégâts + feux
import * as THREE from 'three';
import { VEHICLES, clamp, worldToRoad, upLevel, settings } from './config.js';
import { canvasTex } from './models.js';
import { buildPoliceCar, buildPlayerTruck, buildTrailer, makeWheel, MAT } from './models.js';
import { Interior } from './interior.js';

const _q = new THREE.Quaternion(), _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3(), _v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function colliderSet(def) {
  // [hx, hy, hz, x, y, z, part de masse] en coordonnées modèle (sol = 0)
  const L = def.len / 2, w = def.w / 2;
  switch (def.id) {
    case 'sedan': case 'wagon': return [[w, 0.32, L - 0.02, 0, 0.62, 0, 0.8], [w * 0.84, 0.26, L * 0.45, 0, 1.18, -0.2, 0.2]];
    case 'suv': return [[w, 0.42, L - 0.02, 0, 0.82, 0, 0.8], [w * 0.86, 0.3, L * 0.62, 0, 1.5, -0.25, 0.2]];
    case 'delivery': return [[w * 0.9, 0.3, L, 0, 0.85, 0, 0.55], [w, 1.1, 1.0, 0, 2.15, L - 1.0, 0.15], [w, 1.28, 2.55, 0, 2.15, -L + 2.6, 0.3]];
    case 'flatbed': return [[w * 0.9, 0.3, L, 0, 0.85, 0, 0.55], [w, 1.15, 1.1, 0, 2.2, L - 1.1, 0.15], [w, 0.75, 3.3, 0, 1.9, -L + 3.4, 0.3]];
    default: return [[w * 0.9, 0.26, L, 0, 0.78, 0, 0.7], [w, 1.2, 1.2, 0, 2.35, L - 1.2, 0.3]];
  }
}

export class Vehicle {
  constructor(game, defId, opts = {}) {
    const R = game.R, world = game.phys, def = VEHICLES[defId];
    this.game = game; this.R = R; this.world = world; this.def = def; this.id = defId;
    this.team = def.team; this.isPolice = def.team === 'police'; this.ai = !!opts.ai; this.name = opts.name || def.name;
    const bodyY = this.bodyY = def.wheelR + 0.25;
    const { x = 0, z = 0, yaw = 0 } = opts;
    const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    this.body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, bodyY + 0.08, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setLinearDamping(0.0).setAngularDamping(0.6).setCcdEnabled(true).setCanSleep(false));
    for (const [hx, hy, hz, px, py, pz, frac] of colliderSet(def)) {
      world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(px, py - bodyY, pz).setMass(def.mass * frac).setFriction(0.35).setRestitution(0.02), this.body);
    }
    const vc = this.vc = world.createVehicleController(this.body);
    vc.indexUpAxis = 1; vc.setIndexForwardAxis = 2;
    const sp = def.susp;
    this.wheelDefs = def.wheels.map(([wx, wz], i) => {
      const conY = def.wheelR + sp.rest - bodyY;
      vc.addWheel({ x: wx, y: conY, z: wz }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, sp.rest, def.wheelR);
      vc.setWheelSuspensionStiffness(i, sp.k);
      vc.setWheelSuspensionCompression(i, 2.4);
      vc.setWheelSuspensionRelaxation(i, 3.0);
      vc.setWheelMaxSuspensionTravel(i, sp.travel);
      vc.setWheelMaxSuspensionForce(i, def.mass * 40);
      vc.setWheelFrictionSlip(i, def.grip);
      vc.setWheelSideFrictionStiffness(i, 1.0);
      const front = wz > 0 && i < 2;
      const drive = def.awd || (def.driveRear ? wz < 0 : front);
      return { x: wx, z: wz, conY, front, drive, rot: 0 };
    });
    this.nDrive = this.wheelDefs.filter(w => w.drive).length;
    this.mass = this.body.mass();
    this.dragC = def.power / Math.pow(def.vmax / 3.6, 3);

    // état
    this.steer = 0; this.thr = 0; this.brk = 0; this.speed = 0; this.kmh = 0; this.rpm = def.idle; this.gear = 1; this.reverse = false;
    this.damage = 0; this.disabled = false; this.headlights = false; this.siren = false; this.horn = false; this.handbrake = false;
    this.slip = 0; this.onGround = true; this.impact = 0; this.lastV = new THREE.Vector3(); this.flipT = 0; this.spikes = 0;
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.pos = new THREE.Vector3(x, bodyY, z); this.quat = q.clone();
    this.prevPos = this.pos.clone(); this.prevQuat = q.clone(); this.curPos = this.pos.clone(); this.curQuat = q.clone();
    this.road = worldToRoad(x, z, { s: 0, d: 0 });
    this.forward = new THREE.Vector3(0, 0, 1); this.yaw = yaw;

    // visuel
    const paint = opts.paint;
    let model;
    if (this.isPolice) model = buildPoliceCar(def, paint);
    else model = buildPlayerTruck(def, paint);
    this.model = model;
    this.mesh = new THREE.Group();
    model.group.position.y = -bodyY;
    this.mesh.add(model.group);
    this.tailMat = model.group.getObjectByName('tail')?.material;
    this.headMat = model.group.getObjectByName('head')?.material;
    if (this.headMat === MAT.head) { this.headMat = MAT.head.clone(); model.group.getObjectByName('head').material = this.headMat; }
    if (this.tailMat === MAT.tail) { this.tailMat = MAT.tail.clone(); model.group.getObjectByName('tail').material = this.tailMat; }
    this.wheels = this.wheelDefs.map(w => { const m = makeWheel(def.wheelR, def.team === 'truck' ? 0.38 : 0.26); this.mesh.add(m); return m; });
    game.scene.add(this.mesh);

    // volant + essuie-glaces (vue intérieure)
    const cab = def.cab, truck = def.team === 'truck';
    this.cabPos = new THREE.Vector3(cab.x, cab.y - bodyY, cab.z);
    const sw = new THREE.Mesh(new THREE.TorusGeometry(truck ? 0.24 : 0.19, 0.025, 8, 24), MAT.interior);
    sw.position.set(cab.x, cab.y - bodyY - (truck ? 0.5 : 0.36), cab.z + (truck ? 0.55 : 0.5)); sw.rotation.x = truck ? -1.0 : -0.4;
    this.steeringWheel = sw; this.mesh.add(sw);
    this.wipers = [];
    for (const sx of [0.55, -0.15]) {
      const piv = new THREE.Group(); piv.position.set(sx * (truck ? 1.6 : 1), cab.belt + 0.04 - bodyY, cab.wz);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.025, truck ? 0.9 : 0.55, 0.02).translate(0, truck ? 0.45 : 0.27, 0), MAT.interior);
      const inner = new THREE.Group(); inner.rotation.z = 1.45; inner.add(arm);
      piv.rotation.x = truck ? -0.1 : -0.95; piv.add(inner);
      this.mesh.add(piv); this.wipers.push(inner);
    }
    this.wipeT = 0; this.wiping = false;

    // remorque
    if (def.trailer) this.makeTrailer(x, z, yaw);
    this.lightT = Math.random() * 3;
    this.accL = new THREE.Vector3();
    // améliorations du garage (carrière)
    const up = k => (opts.upgrades === false ? 0 : upLevel(defId, k));
    this.pMul = 1 + up('engine') * 0.12; this.gMul = 1 + up('tires') * 0.08; this.armor = 1 - up('armor') * 0.18; this.tankLvl = up('tank');
    this.manual = !opts.ai && settings.gearbox === 'manual'; this.mGear = 1;
    this.blink = 0; this.blinkT = 0; this.hornStuck = 0; this.flat = 0;
    if (opts.interior) this.addInterior();
  }

  // carrosserie froissée au point d'impact (opposé au changement de vitesse), vitres fêlées
  deform(dvWorld, mag) {
    if (mag < 2.2) return;
    const q = _q.copy(this.curQuat).invert(), dir = dvWorld.applyQuaternion(q).normalize();
    const def = this.def, half = new THREE.Vector3(def.w / 2, 1, def.len / 2);
    const hit = new THREE.Vector3(-dir.x * half.x, 0, -dir.z * half.z);
    if (Math.abs(dir.x) > Math.abs(dir.z)) hit.z = 0; else hit.x = 0;
    hit.y = this.bodyY + 0.4;
    const amt = Math.min(0.22, (mag - 2) * 0.03), rad = 0.9 + mag * 0.05;
    this.model.group.traverse(o => {
      if (!o.isMesh || !(o.name === 'paint' || o.name === 'body' || o.name === 'head' || o.name === 'tail')) return;
      const pos = o.geometry.attributes.position; let ch = false;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const d2 = (x - hit.x) ** 2 + (y - hit.y) ** 2 * 0.5 + (z - hit.z) ** 2;
        if (d2 > rad * rad) continue;
        const f = amt * (1 - Math.sqrt(d2) / rad) * (0.7 + Math.random() * 0.6);
        pos.setXYZ(i, x + dir.x * f, y - f * 0.25, z + dir.z * f); ch = true;
      }
      if (ch) { pos.needsUpdate = true; o.geometry.computeVertexNormals(); }
    });
    if (this.damage > 35 && !this.cracked) {
      this.cracked = true;
      const glass = this.model.group.getObjectByName('glass');
      if (glass) {
        const t = canvasTex(512, 512, (g, w, h) => { g.clearRect(0, 0, w, h); g.strokeStyle = 'rgba(230,240,255,0.85)'; g.lineWidth = 1.5; const cx = w * (0.3 + Math.random() * 0.4), cy = h * 0.5; for (let i = 0; i < 22; i++) { g.beginPath(); g.moveTo(cx, cy); let x = cx, y = cy; const a = Math.random() * 7; for (let k = 0; k < 6; k++) { x += Math.cos(a + (Math.random() - 0.5)) * 30; y += Math.sin(a + (Math.random() - 0.5)) * 30; g.lineTo(x, y); } g.stroke(); } for (let r = 20; r < 90; r += 25) { g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke(); } });
        glass.material = glass.material.clone(); glass.material.map = t; glass.material.opacity = 0.85; glass.material.needsUpdate = true;
      }
    }
  }

  addInterior() {
    if (this.interior) return;
    this.interior = new Interior(this);
    this.model.group.add(this.interior.group);
    this.steeringWheel.visible = false;
  }

  makeTrailer(x, z, yaw) {
    const R = this.R, world = this.world, t = this.def.trailer, def = this.def;
    const ty = 1.0, q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    const off = new THREE.Vector3(0, 0, t.kingpin).applyQuaternion(q);
    const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x + off.x, ty + 0.08, z + off.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setAngularDamping(0.5).setCanSleep(false));
    const zc = 1.2 - t.len / 2;
    world.createCollider(R.ColliderDesc.cuboid(t.w / 2, 1.33, t.len / 2 - 0.1).setTranslation(0, 2.68 - ty, zc - 0.1).setMass(t.mass * 0.25).setFriction(0.35), body);
    world.createCollider(R.ColliderDesc.cuboid(t.w / 2 - 0.2, 0.2, (t.len - 3.2) / 2).setTranslation(0, 1.45 - ty, zc - 1.6).setMass(t.mass * 0.75).setFriction(0.35), body);
    const vc = world.createVehicleController(body);
    vc.indexUpAxis = 1; vc.setIndexForwardAxis = 2;
    const r = 0.5, rest = 0.42, wheels = [];
    for (const az of t.axles) for (const sx of [1, -1]) {
      const i = wheels.length;
      vc.addWheel({ x: sx * 1.0, y: r + rest - ty, z: az }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, rest, r);
      vc.setWheelSuspensionStiffness(i, 40); vc.setWheelSuspensionCompression(i, 2.4); vc.setWheelSuspensionRelaxation(i, 3);
      vc.setWheelMaxSuspensionTravel(i, 0.25); vc.setWheelMaxSuspensionForce(i, t.mass * 40); vc.setWheelFrictionSlip(i, 1.8); vc.setWheelSideFrictionStiffness(i, 1);
      wheels.push({ x: sx * 1.0, z: az, conY: r + rest - ty, rot: 0 });
    }
    const jd = R.JointData.spherical({ x: 0, y: 1.25 - this.bodyY, z: t.kingpin }, { x: 0, y: 1.25 - ty, z: 0 });
    const joint = world.createImpulseJoint(jd, this.body, body, true);
    joint.setContactsEnabled(true); // la remorque est solide : on ne traverse plus sa propre remorque en portefeuille
    const model = buildTrailer(def);
    const mesh = new THREE.Group(); model.group.position.y = -ty; mesh.add(model.group);
    const wm = wheels.map(() => { const m = makeWheel(r, 0.4); mesh.add(m); return m; });
    const tail = model.group.getObjectByName('tail').material;
    this.game.scene.add(mesh);
    this.trailer = { body, vc, wheels, wm, mesh, joint, ty, tail, prevPos: new THREE.Vector3(), prevQuat: new THREE.Quaternion(), curPos: new THREE.Vector3(x + off.x, ty, z + off.z), curQuat: q.clone(), pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
    this.mass += body.mass();
  }

  get bodies() { return this.trailer ? [this.body, this.trailer.body] : [this.body]; }

  step(dt, env) {
    const def = this.def, b = this.body, vc = this.vc, inp = this.input;
    const v = b.linvel(), r = b.rotation();
    _q.set(r.x, r.y, r.z, r.w);
    _f.set(0, 0, 1).applyQuaternion(_q); _u.set(0, 1, 0).applyQuaternion(_q); _r.set(-1, 0, 0).applyQuaternion(_q);
    const speed = v.x * _f.x + v.y * _f.y + v.z * _f.z;
    const lat = v.x * _r.x + v.z * _r.z;
    this.speed = speed; this.kmh = Math.abs(speed) * 3.6;
    const aspd = Math.abs(speed);
    const dmgF = this.disabled ? 0 : 1 - 0.45 * clamp((this.damage - 40) / 60);

    // marche avant / arrière
    let thrIn = inp.throttle, brkIn = inp.brake;
    if (!this.reverse && inp.brake > 0.1 && inp.throttle < 0.05 && speed < 0.6) this.reverse = true;
    else if (this.reverse && inp.throttle > 0.1 && speed > -0.6) this.reverse = false;
    if (this.reverse) { thrIn = inp.brake; brkIn = inp.throttle; }
    if (this.disabled) thrIn = 0;
    this.thr += (thrIn - this.thr) * Math.min(1, dt * 6);
    this.brk = brkIn;
    this.handbrake = inp.handbrake;

    // force moteur limitée par la traction puis par la puissance
    const vmax = (this.reverse ? 25 : def.vmax * dmgF * (this.spikes > 0 ? 0.45 : 1)) / 3.6;
    let F = Math.min(this.mass * def.fmax, def.power * this.pMul * dmgF / Math.max(aspd, 4)) * this.thr;
    if (this.manual && !this.reverse) { // boîte manuelle : couple selon le rapport, rupteur, calage en sous-régime
      const bandM = (def.vmax / 3.6) / def.gears * 1.1, lo = (this.mGear - 1) * bandM, hi = this.mGear * bandM * 1.08;
      F *= (1.25 - (this.mGear / def.gears) * 0.5);
      if (aspd > hi) F *= Math.max(0, 1 - (aspd - hi) * 0.8);
      if (aspd < lo * 0.6) F *= 0.35;
    }
    if (aspd > vmax) F *= Math.max(0, 1 - (aspd - vmax) * 0.6);
    if (this.reverse) F = -F * 0.5;
    this.shiftT = (this.shiftT || 0) - dt;
    if (this.shiftT > 0) F *= 0.55;

    // direction (angle réduit avec la vitesse)
    const maxSteer = def.steer * (1 - 0.72 * clamp(aspd / 38));
    const target = inp.steer * maxSteer;
    const rate = (this.ai ? 2.2 : 1.6 + 1.2 * (1 - clamp(aspd / 30))) * dt;
    this.steer += clamp(target - this.steer, -rate, rate);
    // freins
    const wet = env.wet || 0;
    const brakeF = brkIn * this.mass * 8.5;
    const roll = this.thr < 0.02 && brkIn < 0.02 ? this.mass * (aspd < 1.2 ? 4 : 0.25) : 0;
    if (this.oil > 0) this.oil -= dt;
    const gripMul = (1 - wet * 0.22) * (this.spikes > 0 ? 0.55 : 1) * (this.oil > 0 ? 0.18 : 1);
    this.wheelDefs.forEach((w, i) => {
      if (w.front) vc.setWheelSteering(i, this.steer);
      vc.setWheelFrictionSlip(i, def.grip * this.gMul * gripMul * (this.handbrake && !w.front ? 0.6 : 1));
      vc.setWheelSideFrictionStiffness(i, this.handbrake && !w.front ? 0.35 : 1);
      vc.setWheelEngineForce(i, w.drive ? F / this.nDrive : 0);
      let bi = (brakeF + roll) / this.wheelDefs.length;
      if (this.handbrake && !w.front) bi += this.mass * 3;
      vc.setWheelBrake(i, bi * dt);
    });
    vc.updateVehicle(dt);
    let contacts = 0;
    for (let i = 0; i < this.wheelDefs.length; i++) if (vc.wheelIsInContact(i)) contacts++;
    this.onGround = contacts >= 2;

    if (this.trailer) {
      const t = this.trailer;
      const tb = (brakeF * 1.2 + (this.handbrake ? this.mass * 2 : 0) + (roll ? 3000 : 0)) / t.wheels.length;
      t.wheels.forEach((w, i) => { t.vc.setWheelBrake(i, tb * dt); t.vc.setWheelFrictionSlip(i, 1.8 * gripMul); });
      t.vc.updateVehicle(dt);
    }

    // traînée aéro + appui + anti-roulis
    const vv = Math.hypot(v.x, v.y, v.z);
    const drag = this.dragC * vv * vv * dt;
    if (vv > 0.5) b.applyImpulse({ x: -v.x / vv * drag, y: 0, z: -v.z / vv * drag }, true);
    if (this.onGround) {
      b.applyImpulse({ x: 0, y: -this.body.mass() * 0.004 * vv * vv * dt, z: 0 }, true);
      const rollA = _r.y; // inclinaison latérale
      const pitchA = _f.y;
      const k = this.body.mass() * (def.team === 'truck' ? 40 : 18) * dt;
      b.applyTorqueImpulse({ x: _f.x * rollA * k, y: 0, z: _f.z * rollA * k }, true);
      b.applyTorqueImpulse({ x: -_r.x * pitchA * k * 0.5, y: 0, z: -_r.z * pitchA * k * 0.5 }, true);
    }
    this.slip = this.onGround ? clamp((Math.abs(lat) - 2.5) / 6) + (this.handbrake && aspd > 5 ? 0.5 : 0) + (brkIn > 0.8 && aspd > 12 ? 0.3 : 0) : 0;

    // régime / rapports (boîte auto)
    const band = (def.vmax / 3.6) / def.gears * 1.1;
    let g = this.manual ? this.mGear : clamp(Math.floor(aspd / band) + 1, 1, def.gears);
    if (g !== this.gear) { if (!this.reverse && aspd > 1) this.shiftT = def.team === 'truck' ? 0.35 : 0.15; this.gear = g; }
    const frac = clamp((aspd - (g - 1) * band) / band);
    const rpmT = this.disabled ? 0 : def.idle + (def.red - def.idle) * (g === 1 ? frac * 0.85 + 0.05 * this.thr : 0.42 + frac * 0.5) + (this.onGround ? 0 : this.thr * 1500);
    this.rpm += (rpmT - this.rpm) * Math.min(1, dt * 8);

    // essuie-glaces
    if (this.wiping || this.wipeT > 0) {
      this.wipeT += dt * 1.6;
      const a = Math.abs(Math.sin(this.wipeT * Math.PI)) * 1.7;
      this.wipers.forEach(p => p.rotation.z = 1.45 - a);
      if (!this.wiping && this.wipeT % 1 < 0.05) this.wipeT = 0;
    }
    if (this.spikes > 0) this.spikes -= dt * 0.02;
  }

  postStep(dt) {
    const b = this.body, p = b.translation(), q = b.rotation(), v = b.linvel();
    this.prevPos.copy(this.curPos); this.prevQuat.copy(this.curQuat);
    this.curPos.set(p.x, p.y, p.z); this.curQuat.set(q.x, q.y, q.z, q.w);
    _v.set(v.x, v.y, v.z);
    const dv = _v.distanceTo(this.lastV);
    const dvec = _v.clone().sub(this.lastV);
    if (dt > 0) { // accélération ressentie dans la cabine (repère véhicule)
      _f.copy(_v).sub(this.lastV).divideScalar(dt).applyQuaternion(_q.set(q.x, q.y, q.z, q.w).invert());
      _f.clampLength(0, 40);
      this.accL.lerp(_f, 0.15);
    }
    this.lastV.copy(_v);
    this.impact = 0;
    if (dv > 1.1 && this.alive !== false) {
      const k = this.def.team === 'truck' ? 1.4 : (this.ai ? 1.6 : 2.0);
      this.impact = dv;
      // un choc ne fait pas décoller un véhicule de plusieurs tonnes : on borne la vitesse verticale et le cabrage
      const lv = b.linvel(), av = b.angvel();
      if (lv.y > 1.0) b.setLinvel({ x: lv.x, y: 1.0, z: lv.z }, true);
      const up = _u.set(0, 1, 0).applyQuaternion(_q.set(q.x, q.y, q.z, q.w));
      const ay = av.x * up.x + av.y * up.y + av.z * up.z, MAXR = 1.2;
      const px = av.x - up.x * ay, py = av.y - up.y * ay, pz = av.z - up.z * ay, pr = Math.hypot(px, py, pz);
      if (pr > MAXR) { const k = MAXR / pr; b.setAngvel({ x: up.x * ay + px * k, y: up.y * ay + py * k, z: up.z * ay + pz * k }, true); }
      if (this.trailer) { const tv = this.trailer.body.linvel(); if (tv.y > 1.0) this.trailer.body.setLinvel({ x: tv.x, y: 1.0, z: tv.z }, true); }
      this.damage = Math.min(100, this.damage + (dv - 1.1) * k * this.armor);
      if (dt > 0) this.deform(dvec, dv);
      if (this.damage >= 100 && !this.disabled) { this.disabled = true; this.game.onDisabled?.(this); }
    }
    if (this.trailer) {
      const t = this.trailer, tp = t.body.translation(), tq = t.body.rotation();
      t.prevPos.copy(t.curPos); t.prevQuat.copy(t.curQuat);
      t.curPos.set(tp.x, tp.y, tp.z); t.curQuat.set(tq.x, tq.y, tq.z, tq.w);
    }
    worldToRoad(p.x, p.z, this.road);
    _q.copy(this.curQuat); this.forward.set(0, 0, 1).applyQuaternion(_q);
    this.yaw = Math.atan2(this.forward.x, this.forward.z);
    _u.set(0, 1, 0).applyQuaternion(_q);
    this.upright = _u.y;
    if (_u.y < 0.35 && this.kmh < 8) this.flipT += dt; else this.flipT = 0;
  }

  render(alpha, time) {
    this.pos.lerpVectors(this.prevPos, this.curPos, alpha);
    this.quat.slerpQuaternions(this.prevQuat, this.curQuat, alpha);
    this.mesh.position.copy(this.pos); this.mesh.quaternion.copy(this.quat);
    const vc = this.vc;
    this.wheelDefs.forEach((w, i) => {
      const m = this.wheels[i];
      const len = vc.wheelSuspensionLength(i) ?? this.def.susp.rest;
      m.position.set(w.x, w.conY - len, w.z);
      w.rot += (this.speed / this.def.wheelR) * (1 / 60) * (this.handbrake && !w.front ? 0 : 1);
      m.rotation.set(w.rot, w.front ? this.steer : 0, 0, 'YXZ');
      if (this.spikes > 0 && !this.flat) { this.flat = 1; }
      m.scale.set(1, this.flat ? 0.86 : 1, this.flat ? 0.86 : 1); if (this.flat) m.position.y -= this.def.wheelR * 0.12;
    });
    this.steeringWheel.rotation.z = -this.steer * 6;
    if (this.trailer) {
      const t = this.trailer;
      t.pos.lerpVectors(t.prevPos, t.curPos, alpha); t.quat.slerpQuaternions(t.prevQuat, t.curQuat, alpha);
      t.mesh.position.copy(t.pos); t.mesh.quaternion.copy(t.quat);
      t.wheels.forEach((w, i) => { const len = t.vc.wheelSuspensionLength(i) ?? 0.42; w.rot += this.speed / 0.5 / 60; t.wm[i].position.set(w.x, w.conY - len, w.z); t.wm[i].rotation.x = w.rot; });
      t.tail.emissiveIntensity = this.brk > 0.1 ? 3 : (this.headlights ? 1 : 0.3);
    }
    // feux
    if (this.tailMat) this.tailMat.emissiveIntensity = this.brk > 0.1 && !this.reverse ? 3.2 : (this.headlights ? 1.1 : 0.3);
    if (this.headMat) this.headMat.emissiveIntensity = this.headlights ? 4 : 0.3;
    if (this.model.lights) {
      const L = this.model.lights;
      this.lightT += 1 / 60;
      const ph = (this.lightT * 2.6) % 1, on = this.siren;
      const a = on && ((ph < 0.12) || (ph > 0.22 && ph < 0.34)), bb = on && ((ph > 0.5 && ph < 0.62) || (ph > 0.72 && ph < 0.84));
      L.blue.emissiveIntensity = a ? 9 : 0.15; L.red.emissiveIntensity = bb ? 9 : 0.15;
      this.flashA = a; this.flashB = bb;
    }
  }

  // positions monde des feux (pour halos)
  lightPoints(out) {
    const d = this.def, m = this.mesh.matrixWorld, y = (d.team === 'truck' ? 1.05 : (d.id === 'suv' ? 0.95 : 0.8)) - this.bodyY;
    const hw = d.w * 0.36, L = d.len / 2;
    if (this.headlights) for (const sx of [-1, 1]) out.push([_v.set(sx * hw, y, L + 0.1).applyMatrix4(m).toArray(), 0xfff0d8, 1.6]);
    if (this.blink && (performance.now() % 760) < 380) {
      const L2 = d.len / 2 + 0.06, y2 = y + 0.05;
      for (const sx of this.blink === 3 ? [-1, 1] : [this.blink === 1 ? 1 : -1]) { out.push([_v.set(sx * d.w * 0.48, y2, L2).applyMatrix4(m).toArray(), 0xff9a10, 1.1]); out.push([_v.set(sx * d.w * 0.48, y2, -L2).applyMatrix4(m).toArray(), 0xff9a10, 1.1]); }
    }
    const tailOn = this.headlights || this.brk > 0.1;
    if (tailOn) {
      if (this.trailer) { const tm = this.trailer.mesh.matrixWorld; for (const sx of [-1, 1]) out.push([_v.set(sx * 0.95, 0.72 - this.trailer.ty, 1.2 - d.trailer.len - 0.1).applyMatrix4(tm).toArray(), 0xff2020, this.brk > 0.1 ? 1.4 : 0.7]); }
      else for (const sx of [-1, 1]) out.push([_v.set(sx * hw, y + 0.1, -L - 0.1).applyMatrix4(m).toArray(), 0xff2020, this.brk > 0.1 ? 1.4 : 0.7]);
    }
    if (this.model.lights && this.siren) {
      const h = this.model.roofH + 0.15 - this.bodyY;
      if (this.flashA) out.push([_v.set(0.3, h, -0.1).applyMatrix4(m).toArray(), 0x3070ff, 4.5]);
      if (this.flashB) out.push([_v.set(-0.3, h, -0.1).applyMatrix4(m).toArray(), 0xff2030, 4.5]);
    }
  }

  resetOnRoad(s, d, yaw) {
    const p = this.game.roadPose(s, d);
    const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw ?? p.yaw);
    const set = (body, x, y, z) => { body.setTranslation({ x, y, z }, true); body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true); body.setLinvel({ x: 0, y: 0, z: 0 }, true); body.setAngvel({ x: 0, y: 0, z: 0 }, true); };
    set(this.body, p.x, this.bodyY + 0.3, p.z);
    if (this.trailer) { const off = new THREE.Vector3(0, 0, this.def.trailer.kingpin).applyQuaternion(q); set(this.trailer.body, p.x + off.x, this.trailer.ty + 0.3, p.z + off.z); }
    this.lastV.set(0, 0, 0);
    this.postStep(0); this.prevPos.copy(this.curPos); this.prevQuat.copy(this.curQuat);
    if (this.trailer) { this.trailer.prevPos.copy(this.trailer.curPos); this.trailer.prevQuat.copy(this.trailer.curQuat); }
  }

  setVelocityForward(v) {
    const f = this.forward;
    this.body.setLinvel({ x: f.x * v, y: 0, z: f.z * v }, true);
    if (this.trailer) this.trailer.body.setLinvel({ x: f.x * v, y: 0, z: f.z * v }, true);
    this.lastV.set(f.x * v, 0, f.z * v);
  }

  dispose() {
    const w = this.world;
    if (this.trailer) { w.removeRigidBody(this.trailer.body); this.game.scene.remove(this.trailer.mesh); w.removeVehicleController(this.trailer.vc); }
    w.removeVehicleController(this.vc);
    w.removeRigidBody(this.body);
    this.game.scene.remove(this.mesh);
    this.alive = false;
  }
}
