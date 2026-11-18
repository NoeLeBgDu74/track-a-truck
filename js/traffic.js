// Trafic civil : modèle IDM (distance de sécurité), changements de voie MOBIL simplifiés,
// rabattement devant les gyrophares, accidents physiques (le véhicule percuté devient dynamique).
import * as THREE from 'three';
import { TRAFFIC_TYPES, laneD, roadToWorld, roadYaw, rng, clamp, settings, REST_AREAS } from './config.js';
import { buildTraffic } from './models.js';

const _p = { x: 0, z: 0 };
const UP = new THREE.Vector3(0, 1, 0);
const DENS = { low: 26, normal: 44, high: 64 };

export class Traffic {
  constructor(game) {
    this.game = game; this.cars = []; this.r = rng(Date.now() & 0xffff);
    this.pool = []; this.honkCd = 0; this.sirenNear = [];
    this.totalW = TRAFFIC_TYPES.reduce((a, t) => a + t.weight, 0);
  }
  get target() { return DENS[settings.density] || DENS.normal; }

  pickType() { let x = this.r() * this.totalW; for (const t of TRAFFIC_TYPES) { if ((x -= t.weight) < 0) return t; } return TRAFFIC_TYPES[0]; }

  spawn(s, dir, lane, v) {
    const type = this.pickType();
    if (type.trucks && lane === 0) lane = 1 + (this.r() < 0.6 ? 1 : 0);
    const R = this.game.R, phys = this.game.phys;
    const mesh = buildTraffic(type, this.r);
    this.game.scene.add(mesh);
    const d = laneD(dir, lane);
    roadToWorld(s, d, _p);
    const body = phys.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(_p.x, 0, _p.z));
    const hy = type.h / 2;
    phys.createCollider(R.ColliderDesc.cuboid(type.w / 2, hy - 0.05, type.len / 2).setTranslation(0, hy + 0.05, 0).setMass(type.mass).setFriction(0.5).setRestitution(0.1), body);
    const v0 = (type.v0[0] + this.r() * (type.v0[1] - type.v0[0])) * (0.95 + this.r() * 0.1);
    const car = {
      type, mesh, body, s, d, dir, lane, v: v ?? v0 * 0.9, v0, len: type.len, w: type.w, acc: 0,
      lc: null, lcT: 2 + this.r() * 4, wreck: false, wreckT: 0, brake: false, yawOff: 0,
      prev: new THREE.Vector3(_p.x, 0, _p.z), cur: new THREE.Vector3(_p.x, 0, _p.z), prevYaw: 0, curYaw: 0, kmh: 0, impatience: 0,
    };
    car.curYaw = car.prevYaw = roadYaw(s) + (dir < 0 ? Math.PI : 0);
    this.cars.push(car);
    return car;
  }

  remove(car) {
    this.game.phys.removeRigidBody(car.body);
    this.game.scene.remove(car.mesh);
    car.mesh.traverse(o => o.geometry?.dispose());
    car.dead = true;
  }

  // remplissage initial autour d'un point
  populate(sc) {
    for (const c of this.cars) this.remove(c);
    this.cars = [];
    const n = this.target;
    for (let i = 0; i < n; i++) this.trySpawn(sc, true);
  }

  trySpawn(sc, anywhere) {
    const dir = this.r() < 0.55 ? 1 : -1;
    const lane = Math.min(2, Math.floor(this.r() * 3.3));
    let s;
    if (anywhere) s = sc - 600 + this.r() * 1700;
    else { // apparition hors de vue : loin devant ou derrière
      s = this.r() < 0.65 ? sc + 700 + this.r() * 400 : sc - 450 - this.r() * 200;
    }
    if (Math.abs(s - sc) < 40) return;
    const d = laneD(dir, lane);
    for (const c of this.cars) if (Math.abs(c.s - s) < 30 && Math.abs(c.d - d) < 2.5) return;
    for (const v of this.game.dynVehicles()) if (Math.abs(v.road.s - s) < 40 && Math.abs(v.road.d - d) < 3) return;
    for (const w of this.game.world.roadworks) if (w.dir === dir && w.lane === lane && s > w.s0 - 80 && s < w.s1) return;
    // vitesse initiale = celle du trafic voisin
    this.spawn(s, dir, lane);
  }

  // liste d'obstacles (voitures civiles + véhicules physiques + chantiers)
  buildObstacles() {
    const obs = [];
    for (const c of this.cars) obs.push({ s: c.s, d: c.d, v: c.wreck ? 0 : c.v * c.dir, len: c.len, w: c.w, car: c });
    for (const v of this.game.dynVehicles()) {
      const f = v.forward, vel = v.lastV;
      const yawRoad = roadYaw(v.road.s);
      const along = vel.x * Math.sin(yawRoad) + vel.z * Math.cos(yawRoad);
      obs.push({ s: v.road.s - (v.trailer ? v.def.trailer.len / 2 : 0), d: v.road.d, v: along, len: v.def.len + (v.trailer ? v.def.trailer.len : 0), w: v.def.w + 0.4, veh: v, siren: v.siren && v.isPolice });
    }
    for (const w of this.game.world.roadworks) obs.push({ s: (w.s0 + w.s1) / 2 - 30, d: laneD(w.dir, w.lane), v: 0, len: w.s1 - w.s0 + 60, w: 3.2, works: true });
    return obs;
  }

  leader(car, d, obs, ahead = 220) {
    let best = null, gap = ahead;
    for (const o of obs) {
      if (o.car === car) continue;
      if (Math.abs(o.d - d) > (o.w + car.w) / 2 + 0.25) continue;
      const ds = (o.s - car.s) * car.dir - (o.len + car.len) / 2;
      if (ds > -car.len * 0.5 && ds < gap) { gap = ds; best = o; }
    }
    return { o: best, gap: Math.max(0.1, gap) };
  }
  follower(car, d, obs) {
    let best = null, gap = 120;
    for (const o of obs) {
      if (o.car === car) continue;
      if (Math.abs(o.d - d) > (o.w + car.w) / 2 + 0.25) continue;
      const ds = (car.s - o.s) * car.dir - (o.len + car.len) / 2;
      if (ds > -car.len * 0.5 && ds < gap) { gap = ds; best = o; }
    }
    return { o: best, gap: Math.max(0.1, gap) };
  }

  idm(car, lead, v0) {
    const a = car.type.trucks ? 1.0 : 1.8, b = 3.0, T = car.type.trucks ? 1.6 : 1.25, s0 = 3;
    const v = car.v;
    let acc = a * (1 - Math.pow(v / Math.max(v0, 1), 4));
    if (lead.o) {
      const dv = v - lead.o.v * car.dir;
      const ss = s0 + Math.max(0, v * T + v * dv / (2 * Math.sqrt(a * b)));
      acc -= a * (ss / lead.gap) ** 2;
    }
    return clamp(acc, -9, a);
  }

  step(dt, focusS, wet) {
    const g = this.game, obs = this.buildObstacles();
    const sirens = obs.filter(o => o.siren);
    this.honkCd -= dt;
    const vFactor = 1 - wet * 0.12;

    for (const car of this.cars) {
      car.prev.copy(car.cur); car.prevYaw = car.curYaw;
      if (car.wreck) {
        const p = car.body.translation(), vel = car.body.linvel();
        car.cur.set(p.x, p.y - car.type.h / 2, p.z);
        const q = car.body.rotation(); car.quat = car.quat || new THREE.Quaternion(); car.quat.set(q.x, q.y, q.z, q.w);
        const rd = g.toRoad(p.x, p.z); car.s = rd.s; car.d = rd.d; car.v = Math.hypot(vel.x, vel.z);
        car.wreckT += dt;
        continue;
      }
      let v0 = car.v0 * vFactor;
      // gyrophares derrière : se rabattre à droite et ralentir
      let yield_ = false;
      for (const o of sirens) {
        const behind = (car.s - o.s) * car.dir;
        if (Math.sign(o.d) === Math.sign(car.d) && behind > 0 && behind < 110) { yield_ = true; break; }
      }
      if (yield_) v0 *= 0.72;
      // fermeture de voie (chantier) proche : impatience => changement de voie
      const lead = this.leader(car, car.d, obs);
      let acc = this.idm(car, lead, v0);
      if (car.lc) { // pendant le changement de voie, surveiller aussi la voie cible
        const l2 = this.leader(car, laneD(car.dir, car.lc.to), obs);
        acc = Math.min(acc, this.idm(car, l2, v0));
      }
      car.acc = acc;
      car.v = Math.max(0, car.v + acc * dt);
      car.brake = acc < -1.2 || car.v < 0.5;
      car.s += car.dir * car.v * dt;

      // décision de changement de voie
      car.lcT -= dt;
      if (!car.lc && car.lcT <= 0) {
        car.lcT = 1.2 + this.r() * 2.5;
        const opts = [];
        const minLane = car.type.trucks ? 1 : 0;
        for (const dl of [-1, 1]) {
          const nl = car.lane + dl;
          if (nl < minLane || nl > 2) continue;
          const nd = laneD(car.dir, nl);
          const nlead = this.leader(car, nd, obs), nfol = this.follower(car, nd, obs);
          if (nlead.gap < 8 || nfol.gap < 6) continue;
          const fv = nfol.o ? Math.abs(nfol.o.v) : 0;
          if (nfol.o && fv > car.v && (fv * fv - car.v * car.v) / (2 * Math.max(nfol.gap - 4, 1)) > 3.5) continue; // gêne trop le suiveur
          const aNew = this.idm(car, nlead, v0);
          let gain = aNew - acc;
          if (dl < 0) gain -= 0.35 + (yield_ ? 2 : 0); else gain += 0.25; // dl<0 => voie de gauche (dépassement) ; rabattement à droite encouragé
          if (yield_ && dl > 0) gain += 1.5;
          if (lead.o?.works && lead.gap < 160) gain += 2.5;
          if (lead.o?.veh && lead.gap < 40) gain += 0.8;
          opts.push({ nl, gain });
        }
        opts.sort((a, b) => b.gain - a.gain);
        if (opts[0] && opts[0].gain > 0.25) car.lc = { from: car.lane, to: opts[0].nl, t: 0, dur: car.type.trucks ? 4.5 : 3.2 };
      }
      // trajectoire latérale
      let yawOff = 0;
      if (car.lc) {
        car.lc.t += dt / car.lc.dur;
        const t = clamp(car.lc.t), e = (1 - Math.cos(t * Math.PI)) / 2;
        const d0 = laneD(car.dir, car.lc.from), d1 = laneD(car.dir, car.lc.to);
        car.d = d0 + (d1 - d0) * e;
        yawOff = Math.atan2((d1 - d0) * Math.PI / 2 * Math.sin(t * Math.PI) / car.lc.dur, Math.max(car.v, 3));
        if (t >= 1) { car.lane = car.lc.to; car.lc = null; }
      } else car.d += (laneD(car.dir, car.lane) - car.d) * Math.min(1, dt * 2);

      roadToWorld(car.s, car.d, _p);
      car.cur.set(_p.x, 0, _p.z);
      car.curYaw = roadYaw(car.s) + (car.dir < 0 ? Math.PI : 0) + yawOff * car.dir;
      const qy = Math.sin(car.curYaw / 2), qw = Math.cos(car.curYaw / 2);
      car.body.setNextKinematicTranslation({ x: _p.x, y: 0, z: _p.z });
      car.body.setNextKinematicRotation({ x: 0, y: qy, z: 0, w: qw });

      // klaxon si le joueur coupe la route de près
      if (lead.o?.veh && lead.o.veh === g.player && lead.gap < 7 && car.v > 12 && this.honkCd <= 0) { this.honkCd = 2.5; g.audio?.honkAt(car.cur, car.type.trucks); }
    }

    // accidents : avant le pas physique, transformer en corps dynamique les véhicules sur le point d'être percutés
    for (const v of g.dynVehicles()) {
      const vel = v.lastV;
      for (const car of this.cars) {
        if (car.wreck) continue;
        const dx = car.cur.x - v.curPos.x, dz = car.cur.z - v.curPos.z;
        const reach = (car.len + v.def.len + (v.trailer ? v.def.trailer.len * 2 : 0)) / 2 + 2;
        if (dx * dx + dz * dz > reach * reach) continue;
        // test boîte orientée (dans le repère de la voiture civile) avec marge prédictive
        const cy = Math.cos(car.curYaw), sy = Math.sin(car.curYaw);
        const cvx = Math.sin(car.curYaw) * car.v, cvz = Math.cos(car.curYaw) * car.v;
        const rvx = vel.x - cvx, rvz = vel.z - cvz, rel = Math.hypot(rvx, rvz);
        if (rel < 3.5) continue;
        const pts = [[0, 0], [0, v.def.len / 2], [0, -v.def.len / 2], [v.def.w / 2, v.def.len / 2], [-v.def.w / 2, v.def.len / 2]];
        const cq = Math.cos(v.yaw), sq = Math.sin(v.yaw);
        let hit = false;
        const m = 0.35;
        for (const [lx, lz] of pts) {
          const wx = v.curPos.x + lx * cq + lz * sq - car.cur.x + rvx * dt * 2, wz = v.curPos.z - lx * sq + lz * cq - car.cur.z + rvz * dt * 2;
          const ax = wx * cy - wz * sy, az = wx * sy + wz * cy;
          if (Math.abs(ax) < car.w / 2 + m && Math.abs(az) < car.len / 2 + m) { hit = true; break; }
        }
        if (v.trailer && !hit) {
          const tp = v.trailer.curPos, dx2 = tp.x - car.cur.x, dz2 = tp.z - car.cur.z;
          const ax = dx2 * cy - dz2 * sy, az = dx2 * sy + dz2 * cy;
          if (Math.abs(ax) < car.w / 2 + v.def.trailer.w / 2 + m * 0.5 && Math.abs(az) < car.len / 2 + v.def.trailer.len / 2 + 0.5 && rel > 5) hit = true;
        }
        if (hit) this.makeWreck(car, cvx, cvz);
      }
    }
    // véhicules civils trop proches d'une épave : collision entre eux aussi
    for (const car of this.cars) if (car.wreck && car.wreckT < 6) for (const o of this.cars) {
      if (o.wreck || o === car) continue;
      const dx = o.cur.x - car.cur.x, dz = o.cur.z - car.cur.z;
      if (dx * dx + dz * dz < ((o.len + car.len) / 2) ** 2 * 0.8 && o.v > 6) this.makeWreck(o, Math.sin(o.curYaw) * o.v, Math.cos(o.curYaw) * o.v);
    }

    // recyclage
    const want = this.target;
    for (const car of this.cars) {
      const far = Math.abs(car.s - focusS);
      if (far > 1150 || (car.wreck && car.wreckT > 45 && far > 250)) this.remove(car);
    }
    this.cars = this.cars.filter(c => !c.dead);
    let tries = 0;
    while (this.cars.length < want && tries++ < 3) this.trySpawn(focusS, false);
  }

  makeWreck(car, vx, vz) {
    const R = this.game.R;
    car.wreck = true; car.wreckT = 0; car.brake = true;
    car.body.setBodyType(R.RigidBodyType.Dynamic, true);
    car.body.setLinvel({ x: vx, y: 0, z: vz }, true);
    car.body.setAngularDamping(1.2); car.body.setLinearDamping(0.25);
    this.game.stats.crashes++;
    this.game.onTrafficCrash?.(car);
  }

  render(alpha) {
    const q = new THREE.Quaternion();
    for (const car of this.cars) {
      if (car.wreck && car.quat) {
        const p = car.body.translation();
        car.mesh.position.set(p.x, p.y - car.type.h / 2, p.z); car.mesh.quaternion.copy(car.quat);
        continue;
      }
      car.mesh.position.lerpVectors(car.prev, car.cur, alpha);
      let dy = car.curYaw - car.prevYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      car.mesh.rotation.set(0, car.prevYaw + dy * alpha, 0);
    }
  }

  lightPoints(out, night, camPos) {
    for (const car of this.cars) {
      const dx = car.cur.x - camPos.x, dz = car.cur.z - camPos.z;
      if (dx * dx + dz * dz > 700 * 700) continue;
      const fy = car.curYaw, sx = Math.cos(fy), sz = -Math.sin(fy), fx = Math.sin(fy), fz = Math.cos(fy);
      const L = car.len / 2 + 0.05, hw = car.w * 0.36, y = car.type.trucks ? 1.0 : 0.75;
      const p = car.mesh.position;
      if (night && !car.wreck) for (const k of [-1, 1]) out.push([[p.x + fx * L + sx * hw * k, y, p.z + fz * L + sz * hw * k], 0xfff2dc, 1.3]);
      if (night || car.brake) for (const k of [-1, 1]) out.push([[p.x - fx * L + sx * hw * k, y, p.z - fz * L + sz * hw * k], 0xff2020, car.brake ? 1.2 : 0.6]);
      if (car.wreck && ((this.game.time * 2) % 1 < 0.5)) for (const k of [-1, 1]) out.push([[p.x - fx * L + sx * hw * k, y, p.z - fz * L + sz * hw * k], 0xff9a10, 1.2]);
    }
  }

  near(pos, r) { let n = 0, closest = 1e9; for (const c of this.cars) { const d = Math.hypot(c.cur.x - pos.x, c.cur.z - pos.z); if (d < r) n++; closest = Math.min(closest, d); } return { n, closest }; }
}
