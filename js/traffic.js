// Trafic civil « intelligent » :
// - IDM (distance de sécurité, bouchons) + changements de voie (MOBIL simplifié) avec vérification de l'angle mort
// - cinématique réaliste : l'essieu arrière suit l'essieu avant (le véhicule pivote naturellement),
//   semi-remorques articulés (la remorque suit la sellette, elle coupe les virages)
// - réactions : gyrophares (se rabattre, voire s'arrêter sur la BAU), accident devant (ralentir, warnings, éviter la voie),
//   véhicule agressif derrière (laisser passer), écart latéral d'un fou à côté (écart + klaxon)
// - accidents physiques : la voiture percutée devient un corps dynamique (épave qui glisse et reste sur la route)
import * as THREE from 'three';
import { TRAFFIC_TYPES, laneD, roadToWorld, roadYaw, rng, clamp, settings, worldToRoad, D77, VILLAGE } from './config.js';
const d77D = dir => D77.d - dir * 1.8; // voie de la départementale selon le sens
import { buildTraffic } from './models.js';

const _p = { x: 0, z: 0 }, _r = { s: 0, d: 0 };
const DENS = { low: 26, normal: 44, high: 64 };
const KP = -1.15, TRAIL_AX = 9.7; // pivot d'attelage (repère tracteur), distance pivot → essieux remorque
let NEXT_ID = 1;

export class Traffic {
  constructor(game) {
    this.game = game; this.cars = []; this.r = rng(Date.now() & 0xffff);
    this.honkCd = 0;
    this.totalW = TRAFFIC_TYPES.reduce((a, t) => a + t.weight, 0);
  }
  get target() { return DENS[settings.density] || DENS.normal; }
  pickType() { let x = this.r() * this.totalW; for (const t of TRAFFIC_TYPES) { if ((x -= t.weight) < 0) return t; } return TRAFFIC_TYPES[0]; }
  // trafic des petites routes : voitures, utilitaires et tracteurs sur la D77
  spawnLocal(s, dir) {
    const r = this.r(), type = r < 0.18 ? TRAFFIC_TYPES.find(t => t.kind === 'tractor') : r < 0.35 ? TRAFFIC_TYPES.find(t => t.kind === 'van') : TRAFFIC_TYPES[r < 0.7 ? 0 : 1];
    const car = this.spawn(s, dir, 0, { type, v: 10 });
    car.d77 = true; car.d = d77D(dir); car.lane = 0; car.v0 = type.kind === 'tractor' ? 7 + this.r() * 2 : 19 + this.r() * 5;
    this.kinematics(car, 0); car.prev.copy(car.cur); car.prevYaw = car.curYaw;
    return car;
  }

  spawn(s, dir, lane, opts = {}) {
    const type = opts.type || this.pickType();
    if (type.trucks && lane === 0) lane = 1 + (this.r() < 0.6 ? 1 : 0);
    const R = this.game.R, phys = this.game.phys;
    const seed = opts.seed ?? (this.r() * 1e9 | 0);
    const mesh = buildTraffic(type, rng(seed));
    this.game.scene.add(mesh);
    const d = laneD(dir, lane);
    const car = {
      id: opts.id ?? NEXT_ID++, seed, ti: TRAFFIC_TYPES.indexOf(type),
      type, mesh, s, d, dir, lane, len: type.len, w: type.w, acc: 0, v: 0, v0: 0,
      lc: null, lcT: 2 + this.r() * 4, wreck: false, wreckT: 0, brake: false, hazard: 0, dodge: 0, pull: 0, mood: this.r(),
      front: type.len / 2, back: type.len / 2 + (type.artic ? -KP + 12.2 - type.len / 2 : 0),
      prev: new THREE.Vector3(), cur: new THREE.Vector3(), prevYaw: 0, curYaw: 0,
      fa: new THREE.Vector3(), ra: new THREE.Vector3(), wb: type.len * (type.kind === 'bus' ? 0.5 : 0.62),
    };
    car.v0 = (type.v0[0] + this.r() * (type.v0[1] - type.v0[0])) * (0.93 + car.mood * 0.12);
    // personnalité du conducteur : influence vitesse, distances, réactions
    const pr = this.r(); car.persona = type.trucks ? (pr < 0.7 ? 'calme' : 'prudent') : pr < 0.35 ? 'calme' : pr < 0.6 ? 'prudent' : pr < 0.85 ? 'presse' : 'distrait';
    if (car.persona === 'presse') car.v0 *= 1.1; if (car.persona === 'prudent') car.v0 *= 0.92;
    car.feel = null; car.feelT = 0; car.accLag = 0;
    car.v = opts.v ?? car.v0 * 0.9;
    // chaîne cinématique initiale (alignée sur la route)
    const yaw = roadYaw(s) + (dir < 0 ? Math.PI : 0), fx = Math.sin(yaw), fz = Math.cos(yaw);
    roadToWorld(s, d, _p);
    car.fa.set(_p.x + fx * car.wb / 2, 0, _p.z + fz * car.wb / 2);
    car.ra.set(_p.x - fx * car.wb / 2, 0, _p.z - fz * car.wb / 2);
    car.cur.set(_p.x, 0, _p.z); car.prev.copy(car.cur); car.curYaw = car.prevYaw = yaw;
    if (!this.game.mirror) {
      car.body = phys.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(_p.x, 0, _p.z));
      const hy = type.h / 2;
      phys.createCollider(R.ColliderDesc.cuboid(type.w / 2, hy - 0.05, type.len / 2).setTranslation(0, hy + 0.05, 0).setMass(type.mass).setFriction(0.3).setRestitution(0), car.body);
    }
    if (type.artic) {
      const tm = mesh.userData.trailer; this.game.scene.add(tm);
      const kx = _p.x + fx * KP, kz = _p.z + fz * KP;
      car.trailer = { mesh: tm, kp: new THREE.Vector3(kx, 0, kz), ax: new THREE.Vector3(kx - fx * TRAIL_AX, 0, kz - fz * TRAIL_AX), yaw, prevYaw: yaw, prev: new THREE.Vector3(kx, 0, kz), cur: new THREE.Vector3(kx, 0, kz) };
      if (!this.game.mirror) {
        car.trailer.body = phys.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(kx, 0, kz));
        phys.createCollider(R.ColliderDesc.cuboid(1.27, 1.9, 6.7).setTranslation(0, 2.05, 1.2 - 6.7).setMass(type.tmass).setFriction(0.5), car.trailer.body);
      }
    }
    this.cars.push(car);
    return car;
  }

  remove(car) {
    if (car.body) this.game.phys.removeRigidBody(car.body);
    if (car.trailer?.body) this.game.phys.removeRigidBody(car.trailer.body);
    this.game.scene.remove(car.mesh);
    car.mesh.traverse(o => o.geometry?.dispose());
    if (car.trailer) { this.game.scene.remove(car.trailer.mesh); car.trailer.mesh.traverse(o => o.geometry?.dispose()); }
    car.dead = true;
  }
  clear() { for (const c of this.cars) this.remove(c); this.cars = []; }

  populate(sc) {
    this.clear();
    if (this.game.mirror) return;
    const n = this.target;
    for (let i = 0; i < n * 2 && this.cars.length < n; i++) this.trySpawn(sc, true);
  }

  trySpawn(sc, anywhere) {
    const dir = this.r() < 0.55 ? 1 : -1;
    const lane = Math.min(2, Math.floor(this.r() * 3.3));
    let s;
    if (anywhere) s = sc - 600 + this.r() * 1700;
    else s = this.r() < 0.65 ? sc + 700 + this.r() * 400 : sc - 450 - this.r() * 200;
    if (Math.abs(s - sc) < 40) return;
    const d = laneD(dir, lane);
    for (const c of this.cars) if (Math.abs(c.s - s) < 40 && Math.abs(c.d - d) < 2.5) return;
    for (const v of this.game.dynVehicles()) if (Math.abs(v.road.s - s) < 50 && Math.abs(v.road.d - d) < 3) return;
    for (const w of this.game.world.roadworks) if (w.dir === dir && w.lane === lane && s > w.s0 - 80 && s < w.s1) return;
    this.spawn(s, dir, lane);
  }

  // obstacles en coordonnées route : s (centre), d, v (vitesse le long de +s), front/back (étendue dans SON sens de marche)
  buildObstacles() {
    const obs = [];
    for (const c of this.cars) {
      if (c.trailer && !c.wreck) {
        obs.push({ s: c.s, d: c.d, v: c.v * c.dir, front: c.front, back: c.len / 2, w: c.w, car: c, dir: c.dir });
        worldToRoad((c.trailer.kp.x + c.trailer.ax.x) / 2, (c.trailer.kp.z + c.trailer.ax.z) / 2, _r);
        obs.push({ s: _r.s, d: _r.d, v: c.v * c.dir, front: 6.5, back: 6.5, w: c.w, car: c, dir: c.dir, trailerOf: c });
      } else obs.push({ s: c.s, d: c.d, v: c.wreck ? 0 : c.v * c.dir, front: c.len / 2, back: c.len / 2, w: c.wreck ? c.w + 1 : c.w, car: c, wreck: c.wreck, dir: c.dir });
    }
    for (const v of this.game.dynVehicles()) {
      const vel = v.lastV, yr = roadYaw(v.road.s);
      const along = vel.x * Math.sin(yr) + vel.z * Math.cos(yr);
      const dirV = along >= 0 ? 1 : -1;
      const tl = v.trailer ? v.def.trailer.len : 0;
      obs.push({ s: v.road.s, d: v.road.d, v: along, front: v.def.len / 2, back: v.def.len / 2 + tl, w: v.def.w + 0.5, veh: v, dir: dirV, siren: v.siren && v.isPolice, lat: v.latVel || 0 });
    }
    for (const r of this.game.remotes.values()) {
      if (!r.curPos) continue;
      const rd = worldToRoad(r.curPos.x, r.curPos.z, {});
      obs.push({ s: rd.s, d: rd.d, v: r.vAlong || 0, front: r.def.len / 2, back: r.def.len / 2 + (r.def.trailer ? r.def.trailer.len : 0), w: r.def.w + 0.5, veh: r, dir: 1, siren: r.siren });
    }
    for (const w of this.game.world.roadworks) obs.push({ s: (w.s0 + w.s1) / 2 - 30, d: laneD(w.dir, w.lane), v: 0, front: (w.s1 - w.s0 + 60) / 2, back: (w.s1 - w.s0 + 60) / 2, w: 3.2, works: true });
    return obs;
  }

  // véhicule le plus proche devant dans la bande latérale d
  leader(car, d, obs, ahead = 220) {
    let best = null, gap = ahead;
    for (const o of obs) {
      if (o.car === car) continue;
      if (Math.abs(o.d - d) > (o.w + car.w) / 2 + 0.25) continue;
      const ext = (o.dir === car.dir || o.works) ? o.back : o.front;
      const ds = (o.s - car.s) * car.dir - ext - car.front;
      if (ds > -car.front - 1 && ds < gap) { gap = ds; best = o; }
    }
    return { o: best, gap: Math.max(0.1, gap) };
  }
  follower(car, d, obs) {
    let best = null, gap = 140;
    for (const o of obs) {
      if (o.car === car) continue;
      if (Math.abs(o.d - d) > (o.w + car.w) / 2 + 0.25) continue;
      const ds = (car.s - o.s) * car.dir - car.back - o.front;
      if (ds > -car.back - 1 && ds < gap) { gap = ds; best = o; }
    }
    return { o: best, gap: Math.max(0.1, gap) };
  }
  // personne à côté dans la voie visée (angle mort)
  sideClear(car, d, obs) {
    for (const o of obs) {
      if (o.car === car) continue;
      if (Math.abs(o.d - d) > (o.w + car.w) / 2 + 0.4) continue;
      const ds = (o.s - car.s) * car.dir;
      if (ds < car.front + o.back + 4 && ds > -(car.back + o.front + 6)) return false;
    }
    return true;
  }

  idm(car, lead, v0) {
    const env = this.game.env, wetK = 1 + (env?.wet || 0) * 0.45 + (env?.fogAmt || 0) * 0.5;
    const pT = { calme: 1, prudent: 1.35, presse: 0.7, distrait: 1.1 }[car.persona] || 1;
    const a = car.type.trucks ? 1.0 : 1.8, b = 3.0, s0 = 3;
    let T = (car.type.trucks ? 1.7 : 1.15 + car.mood * 0.4) * pT * wetK;
    if (car.feel === 'angry') T *= 0.45; if (car.feel === 'panic') T *= 1.3;
    const v = car.v;
    let acc = a * (1 - Math.pow(v / Math.max(v0, 0.5), 4));
    if (lead.o) {
      const dv = v - lead.o.v * car.dir;
      const ss = s0 + Math.max(0, v * T + v * dv / (2 * Math.sqrt(a * b)));
      acc -= a * (ss / lead.gap) ** 2;
    }
    return clamp(acc, -9, a);
  }

  step(dt, focusS, wet) {
    const g = this.game;
    if (g.mirror) return;
    const obs = this.buildObstacles();
    const sirens = obs.filter(o => o.siren);
    const wrecks = obs.filter(o => o.wreck);
    const dyn = obs.filter(o => o.veh);
    this.honkCd -= dt;
    const vFactor = 1 - wet * 0.12;

    for (const car of this.cars) {
      car.prev.copy(car.cur); car.prevYaw = car.curYaw;
      if (car.trailer) { car.trailer.prev.copy(car.trailer.cur); car.trailer.prevYaw = car.trailer.yaw; }
      if (car.wreck) { this.wreckStep(car, dt); continue; }
      if (car.broken) { car.v = 0; car.brake = false; this.kinematics(car, dt); continue; }
      let v0 = car.v0 * vFactor;
      car.hazard = Math.max(0, car.hazard - dt);
      if (car.d77) { if (car.s > VILLAGE.s0 - 40 && car.s < VILLAGE.s1 + 40) v0 = Math.min(v0, 13.5); if (car.s < D77.s0 + 10 || car.s > D77.s1 - 10) { car.dead2 = true; } }

      // --- perception ---
      let yieldSiren = null;
      for (const o of sirens) {
        const behind = (car.s - o.s) * car.dir;
        if (Math.sign(o.d) === Math.sign(car.d) && behind > -5 && behind < 130) { yieldSiren = o; break; }
      }
      let wreckNear = null;
      for (const o of wrecks) { const ah = (o.s - car.s) * car.dir; if (ah > -10 && ah < 220 && Math.sign(o.d) === Math.sign(car.d) || (ah > -10 && ah < 80 && Math.abs(o.d - car.d) < 9)) { if (!wreckNear || ah < wreckNear.ah) wreckNear = { o, ah }; } }
      let chaser = null, sideThreat = null;
      for (const o of dyn) {
        const ds = (o.s - car.s) * car.dir;
        const sameSide = Math.sign(o.d) === Math.sign(car.d);
        if (!sameSide) continue;
        const closing = (o.v * car.dir) - car.v;
        if (ds < -car.back && ds > -60 && Math.abs(o.d - car.d) < 2.6 && closing > 5) chaser = o;
        if (Math.abs(ds) < car.front + o.back + 2 && Math.abs(o.d - car.d) < (o.w + car.w) / 2 + 1.2) sideThreat = o;
      }

      if (yieldSiren) v0 *= car.lane >= 2 ? 0.55 : 0.75;
      // ---- conscience de l'environnement ----
      const env = g.env;
      if (env) { v0 *= 1 - env.night * 0.07 - env.fogAmt * 0.25 - env.tunnel * 0.1; }
      car.feelT = Math.max(0, car.feelT - dt); if (car.feelT <= 0) car.feel = null;
      const tk = g.targetTruck?.();
      if (tk && !car.d77 === tk.road.d > -18) {
        const ds = (tk.road.s - car.s) * car.dir, sameSide = Math.sign(tk.road.d) === Math.sign(car.d) || car.d77;
        const closing = (tk.speed * Math.sign(roadYaw(tk.road.s) * 0 + 1)) - car.v;
        // le camion fou arrive vite derrière (ou la poursuite) : panique, on s'écarte
        if (sameSide && ds < -car.back && ds > -80 && (closing > 6 || (g.released && g.mode !== 'free'))) {
          if (car.feel !== 'panic') { car.feel = 'panic'; car.feelT = 5; car.hazard = 4; if (car.persona !== 'distrait') g.bubble?.(car, ['Mais il est fou ce camion !', 'AAAH il arrive !', 'Je me pousse, je me pousse !', 'C’est quoi ce délire ?!'][Math.floor(this.r() * 4)]); }
        }
        // curiosité : la police et l'hélicoptère
        if (g.heliOn && Math.abs(ds) < 120 && this.r() < 0.002) g.bubble?.(car, ['Un hélico ?! C’est un film ?', 'Regarde là-haut !'][Math.floor(this.r() * 2)]);
      }
      if (car.feel === 'panic') { v0 *= 0.75; yieldSiren = yieldSiren || { s: car.s - car.dir * 50, d: car.d }; }
      if (car.feel === 'angry') v0 *= 1.15;
      if (car.persona === 'distrait' && !car.lc) car.dodge += Math.sin(g.time * 0.8 + car.seed) * 0.004; // léger zigzag (téléphone)
      if (wreckNear) { // curiosité + prudence
        if (wreckNear.ah < 90) { v0 = Math.min(v0, 14 + car.mood * 6); if (car.v > 16) car.hazard = 3; }
      }

      // --- longitudinal ---
      const lead = this.leader(car, car.d, obs);
      let acc = this.idm(car, lead, v0);
      if (car.lc) acc = Math.min(acc, this.idm(car, this.leader(car, laneD(car.dir, car.lc.to), obs), v0));
      if (lead.o?.wreck && lead.gap < 60) car.hazard = 3;
      if (acc < -5) car.hazard = Math.max(car.hazard, 1.5);
      if (car.persona === 'distrait') { car.accLag += (acc - car.accLag) * Math.min(1, dt * 1.6); acc = Math.min(acc, car.accLag) < -6 ? acc : car.accLag; }
      car.acc = acc;
      car.v = Math.max(0, car.v + acc * dt);
      car.brake = acc < -1.2 || car.v < 0.5;
      car.s += car.dir * car.v * dt;

      // --- changements de voie ---
      car.lcT -= dt;
      if (!car.lc && car.lcT <= 0 && !car.d77) {
        car.lcT = 1.0 + this.r() * 2.2;
        const opts = [];
        const minLane = car.type.trucks ? 1 : 0, maxLane = yieldSiren && car.lane === 2 && (car.s - yieldSiren.s) * car.dir < 70 ? 3 : 2;
        for (const dl of [-1, 1]) {
          const nl = car.lane + dl;
          if (nl < minLane || nl > maxLane) continue;
          const nd = laneD(car.dir, nl);
          if (!this.sideClear(car, nd, obs)) continue;
          const nlead = this.leader(car, nd, obs), nfol = this.follower(car, nd, obs);
          if (nlead.gap < 10 || nfol.gap < 8) continue;
          const fv = nfol.o ? Math.abs(nfol.o.v) : 0;
          if (nfol.o && fv > car.v && (fv * fv - car.v * car.v) / (2 * Math.max(nfol.gap - 4, 1)) > 3) continue;
          const aNew = this.idm(car, nlead, v0);
          let gain = aNew - acc;
          if (dl < 0) gain -= 0.35 + (yieldSiren ? 3 : 0); else gain += 0.2;
          if (yieldSiren && dl > 0) gain += 2.5;
          if (nl === 3) gain += yieldSiren ? 0.5 : -99;
          if (lead.o?.works && lead.gap < 170) gain += 2.5;
          if (lead.o?.wreck && lead.gap < 200) gain += 3;
          if (chaser && dl > 0) gain += 1.4;           // laisser passer celui qui colle
          if (lead.o?.veh && lead.gap < 40) gain += 0.6;
          opts.push({ nl, gain });
        }
        opts.sort((a, b) => b.gain - a.gain);
        if (opts[0] && opts[0].gain > 0.25) car.lc = { from: car.lane, to: opts[0].nl, t: 0, dur: car.type.trucks ? 5 : 3.4 - car.mood * 0.6 };
        // retour de la BAU une fois la police passée
        if (!car.lc && car.lane === 3 && !yieldSiren && this.sideClear(car, laneD(car.dir, 2), obs) && this.follower(car, laneD(car.dir, 2), obs).gap > 25) car.lc = { from: 3, to: 2, t: 0, dur: 4 };
      }

      // --- latéral : trajectoire de l'essieu avant ---
      if (car.lc) {
        car.lc.t += dt / car.lc.dur;
        const t = clamp(car.lc.t), e = (1 - Math.cos(t * Math.PI)) / 2;
        const d0 = laneD(car.dir, car.lc.from), d1 = laneD(car.dir, car.lc.to);
        car.d = d0 + (d1 - d0) * e;
        if (t >= 1) { car.lane = car.lc.to; car.lc = null; }
        // annule si un véhicule surgit dans l'angle mort au début de la manœuvre
        else if (t < 0.3 && !this.sideClear(car, laneD(car.dir, car.lc.to), obs)) { car.lc = { from: car.lc.to, to: car.lc.from, t: 1 - t, dur: car.lc.dur }; }
      } else car.d += ((car.d77 ? d77D(car.dir) - (yieldSiren ? car.dir * 1.2 : 0) : laneD(car.dir, car.lane)) - car.d) * Math.min(1, dt * 2);
      // écart d'évitement si un véhicule fou se rapproche latéralement
      let dodgeT = 0;
      if (sideThreat) {
        dodgeT = clamp(car.d - sideThreat.d, -1, 1) > 0 ? 1 : -1;
        if (this.honkCd <= 0 && sideThreat.veh === g.player && car.v > 8) { this.honkCd = 2 + this.r() * 2; g.audio?.honkAt(car.cur, car.type.trucks); }
      }
      car.dodge += (dodgeT * 0.9 - car.dodge) * Math.min(1, dt * 2.5);
      this.kinematics(car, dt);

      if (lead.o?.veh && lead.o.veh === g.player && lead.gap < 8 && car.v > 12 && this.honkCd <= 0) {
        this.honkCd = 2.5; g.audio?.honkAt(car.cur, car.type.trucks);
        if (car.persona === 'presse' || car.persona === 'calme' && this.r() < 0.3) { car.feel = 'angry'; car.feelT = 7; car.flash = 1.5; g.bubble?.(car, ['Non mais ho !', 'Apprends à conduire !', 'Espèce de chauffard !', 'Tu vas voir toi…'][Math.floor(this.r() * 4)]); }
        else g.bubble?.(car, ['Oh là là…', 'Il m’a fait peur !'][Math.floor(this.r() * 2)]);
      }
      if (car.flash > 0) car.flash -= dt;
    }

    this.detectCrashes(dt);

    // recyclage
    const want = this.target;
    for (const car of this.cars) {
      const far = Math.abs(car.s - focusS);
      if ((far > 1150 && !car.broken) || (car.wreck && car.wreckT > 60 && far > 250) || (car.dead2 && !car.wreck)) this.remove(car);
    }
    this.cars = this.cars.filter(c => !c.dead);
    let tries = 0;
    while (this.cars.filter(c => !c.broken && !c.d77).length < want && tries++ < 3) this.trySpawn(focusS, false);
    if (focusS > D77.s0 - 900 && focusS < D77.s1 + 900) {
      const loc = this.cars.filter(c => c.d77).length;
      if (loc < 9 && this.r() < 0.1) {
        const dir = this.r() < 0.5 ? 1 : -1, s = clamp(focusS + (this.r() < 0.5 ? -1 : 1) * (250 + this.r() * 500), D77.s0 + 30, D77.s1 - 30);
        if (!this.cars.some(c => c.d77 && Math.abs(c.s - s) < 40 && c.dir === dir)) this.spawnLocal(s, dir);
      }
    }
  }

  // l'essieu avant suit la voie ; l'essieu arrière est « tiré » (rayon de braquage réaliste), la remorque suit la sellette
  kinematics(car, dt) {
    const yawRoad = roadYaw(car.s) + (car.dir < 0 ? Math.PI : 0);
    roadToWorld(car.s, car.d + car.dodge, _p);
    const fx = Math.sin(yawRoad), fz = Math.cos(yawRoad);
    car.fa.set(_p.x + fx * car.wb / 2, 0, _p.z + fz * car.wb / 2);
    let dx = car.fa.x - car.ra.x, dz = car.fa.z - car.ra.z, l = Math.hypot(dx, dz) || 1;
    car.ra.set(car.fa.x - dx / l * car.wb, 0, car.fa.z - dz / l * car.wb);
    if (l > car.wb * 3) car.ra.set(car.fa.x - fx * car.wb, 0, car.fa.z - fz * car.wb); // téléportation / apparition
    const yaw = Math.atan2(car.fa.x - car.ra.x, car.fa.z - car.ra.z);
    car.cur.set((car.fa.x + car.ra.x) / 2, 0, (car.fa.z + car.ra.z) / 2);
    car.curYaw = yaw;
    car.body?.setNextKinematicTranslation({ x: car.cur.x, y: 0, z: car.cur.z });
    car.body?.setNextKinematicRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
    if (car.trailer) {
      const t = car.trailer, sx = Math.sin(yaw), sz = Math.cos(yaw);
      t.kp.set(car.cur.x + sx * KP, 0, car.cur.z + sz * KP);
      let ex = t.kp.x - t.ax.x, ez = t.kp.z - t.ax.z, el = Math.hypot(ex, ez) || 1;
      if (el > TRAIL_AX * 2) { t.ax.set(t.kp.x - sx * TRAIL_AX, 0, t.kp.z - sz * TRAIL_AX); ex = sx; ez = sz; el = 1; }
      t.ax.set(t.kp.x - ex / el * TRAIL_AX, 0, t.kp.z - ez / el * TRAIL_AX);
      t.yaw = Math.atan2(t.kp.x - t.ax.x, t.kp.z - t.ax.z);
      t.cur.copy(t.kp);
      t.body?.setNextKinematicTranslation({ x: t.kp.x, y: 0, z: t.kp.z });
      t.body?.setNextKinematicRotation({ x: 0, y: Math.sin(t.yaw / 2), z: 0, w: Math.cos(t.yaw / 2) });
    }
  }

  wreckStep(car, dt) {
    const p = car.body.translation(), vel = car.body.linvel(), q = car.body.rotation();
    if (p.y < -2) { car.body.setTranslation({ x: p.x, y: 0.5, z: p.z }, true); car.body.setLinvel({ x: vel.x, y: 0, z: vel.z }, true); }
    car.cur.set(p.x, p.y, p.z);
    (car.quat ||= new THREE.Quaternion()).set(q.x, q.y, q.z, q.w);
    worldToRoad(p.x, p.z, _r); car.s = _r.s; car.d = _r.d; car.v = Math.hypot(vel.x, vel.z);
    if (car.trailer?.body) {
      const tp = car.trailer.body.translation(), tq = car.trailer.body.rotation();
      if (tp.y < -2) car.trailer.body.setTranslation({ x: tp.x, y: 0.5, z: tp.z }, true);
      car.trailer.cur.set(tp.x, tp.y, tp.z); (car.trailer.quat ||= new THREE.Quaternion()).set(tq.x, tq.y, tq.z, tq.w);
      car.trailer.kp.copy(car.trailer.cur);
    }
    car.wreckT += dt; car.hazard = 1;
  }

  detectCrashes(dt) {
    const g = this.game;
    // avant le pas physique : un civil sur le point d'être percuté devient un corps dynamique
    for (const v of g.dynVehicles()) {
      const vel = v.lastV;
      const parts = [[v.curPos, v.yaw, v.def.len, v.def.w]];
      if (v.trailer) { const tq = v.trailer.curQuat, ty = Math.atan2(2 * (tq.w * tq.y + tq.x * tq.z), 1 - 2 * (tq.y * tq.y + tq.x * tq.x)); parts.push([new THREE.Vector3(v.trailer.curPos.x - Math.sin(ty) * 5.5, 0, v.trailer.curPos.z - Math.cos(ty) * 5.5), ty, v.def.trailer.len, v.def.trailer.w]); }
      for (const car of this.cars) {
        if (car.wreck) continue;
        const boxes = [[car.cur, car.curYaw, car.len, car.w]];
        if (car.trailer) boxes.push([new THREE.Vector3(car.trailer.kp.x - Math.sin(car.trailer.yaw) * 5.5, 0, car.trailer.kp.z - Math.cos(car.trailer.yaw) * 5.5), car.trailer.yaw, 13.4, car.w]);
        const cvx = Math.sin(car.curYaw) * car.v, cvz = Math.cos(car.curYaw) * car.v;
        const rvx = vel.x - cvx, rvz = vel.z - cvz, rel = Math.hypot(rvx, rvz);
        if (rel < 2.5) continue;
        let hit = false;
        for (const [pp, py, pl, pw] of parts) for (const [bp, by, bl, bw] of boxes) {
          if (hit) break;
          const dx = pp.x - bp.x, dz = pp.z - bp.z, reach = (pl + bl) / 2 + 2;
          if (dx * dx + dz * dz > reach * reach) continue;
          hit = obbOverlap(pp.x + rvx * dt * 3, pp.z + rvz * dt * 3, py, pl / 2 + 0.3, pw / 2 + 0.25, bp.x, bp.z, by, bl / 2 + 0.3, bw / 2 + 0.25) || obbOverlap(pp.x + rvx * dt, pp.z + rvz * dt, py, pl / 2 + 0.3, pw / 2 + 0.25, bp.x, bp.z, by, bl / 2 + 0.3, bw / 2 + 0.25);
        }
        if (hit) this.makeWreck(car, cvx, cvz);
      }
    }
    // carambolage : un civil qui arrive trop vite sur une épave
    for (const car of this.cars) if (car.wreck && car.wreckT < 8) for (const o of this.cars) {
      if (o.wreck || o === car) continue;
      const dx = o.cur.x - car.cur.x, dz = o.cur.z - car.cur.z;
      if (dx * dx + dz * dz < ((o.len + car.len) / 2) ** 2 * 0.7 && o.v > 7) this.makeWreck(o, Math.sin(o.curYaw) * o.v, Math.cos(o.curYaw) * o.v);
    }
  }

  makeWreck(car, vx, vz) {
    const R = this.game.R;
    car.wreck = true; car.wreckT = 0; car.brake = true; car.hazard = 1;
    for (const b of [car.body, car.trailer?.body]) {
      if (!b) continue;
      b.setBodyType(R.RigidBodyType.Dynamic, true);
      b.enableCcd(true);
      b.setLinvel({ x: vx, y: 0, z: vz }, true);
      b.setAngularDamping(1.2); b.setLinearDamping(0.3);
    }
    this.game.stats.crashes++;
    // les témoins appellent la police
    const g = this.game, tk = g.targetTruck?.();
    if (tk && car.cur.distanceTo(tk.curPos) < 40 && g.mode !== 'free' && g.state === 'play') {
      g.heat = Math.min(100, (g.heat || 0) + 3);
      const w = this.cars.find(o => !o.wreck && o !== car && o.cur.distanceTo(car.cur) < 80);
      if (w) { g.bubble?.(w, 'J’appelle le 17 !'); w.hazard = 6; g.say?.('witness', `Un témoin signale le camion au PK ${(car.s / 1000).toFixed(1)}.`, 20); }
    }
    this.game.onTrafficCrash?.(car);
  }

  render(alpha) {
    for (const car of this.cars) {
      if (car.wreck && car.quat) {
        car.mesh.position.copy(car.cur); car.mesh.quaternion.copy(car.quat);
        if (car.trailer?.quat) { car.trailer.mesh.position.copy(car.trailer.cur); car.trailer.mesh.quaternion.copy(car.trailer.quat); }
        continue;
      }
      car.mesh.position.lerpVectors(car.prev, car.cur, alpha);
      let dy = car.curYaw - car.prevYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      car.mesh.rotation.set(0, car.prevYaw + dy * alpha, 0);
      if (car.trailer) {
        const t = car.trailer;
        t.mesh.position.lerpVectors(t.prev, t.cur, alpha);
        let ty = t.yaw - t.prevYaw; ty = Math.atan2(Math.sin(ty), Math.cos(ty));
        t.mesh.rotation.set(0, t.prevYaw + ty * alpha, 0);
      }
    }
  }

  lightPoints(out, night, camPos) {
    const blink = (this.game.time * 2) % 1 < 0.5;
    for (const car of this.cars) {
      const dx = car.cur.x - camPos.x, dz = car.cur.z - camPos.z;
      if (dx * dx + dz * dz > 700 * 700) continue;
      const fy = car.curYaw, sx = Math.cos(fy), sz = -Math.sin(fy), fx = Math.sin(fy), fz = Math.cos(fy);
      const L = car.len / 2 + 0.05, hw = car.w * 0.36, y = car.type.trucks ? 1.0 : 0.75;
      const p = car.mesh.position;
      let rx = p.x - fx * L, rz = p.z - fz * L, rsx = sx, rsz = sz;
      if (car.trailer && !car.wreck) { const ty = car.trailer.yaw; rx = car.trailer.kp.x - Math.sin(ty) * 12.25; rz = car.trailer.kp.z - Math.cos(ty) * 12.25; rsx = Math.cos(ty); rsz = -Math.sin(ty); }
      const flashOn = car.flash > 0 && (this.game.time * 6) % 1 < 0.5;
      if ((night || flashOn) && !car.wreck) for (const k of [-1, 1]) out.push([[p.x + fx * L + sx * hw * k, y, p.z + fz * L + sz * hw * k], 0xfff2dc, flashOn ? 3 : 1.3]);
      if (night || car.brake) for (const k of [-1, 1]) out.push([[rx + rsx * hw * k, y, rz + rsz * hw * k], 0xff2020, car.brake ? 1.2 : 0.6]);
      if (car.lc && !car.hazard && blink) { // clignotant du côté de la voie visée (+X = gauche du véhicule)
        const toLeft = (laneD(car.dir, car.lc.to) - laneD(car.dir, car.lc.from)) * car.dir < 0 ? 1 : -1, k = toLeft;
        out.push([[p.x + fx * L + sx * hw * 1.25 * k, y, p.z + fz * L + sz * hw * 1.25 * k], 0xff9a10, 1.0]);
        out.push([[rx + rsx * hw * 1.25 * k, y + 0.05, rz + rsz * hw * 1.25 * k], 0xff9a10, 1.0]);
      }
      if (car.hazard > 0 && blink) for (const k of [-1, 1]) { out.push([[rx + rsx * hw * 1.2 * k, y + 0.1, rz + rsz * hw * 1.2 * k], 0xff9a10, 1.2]); out.push([[p.x + fx * L + sx * hw * 1.2 * k, y, p.z + fz * L + sz * hw * 1.2 * k], 0xff9a10, 1.0]); }
    }
  }

  near(pos, r) { let n = 0, closest = 1e9; for (const c of this.cars) { const d = Math.hypot(c.cur.x - pos.x, c.cur.z - pos.z); if (d < r) n++; closest = Math.min(closest, d); } return { n, closest }; }

  // ----- réseau (coop en ligne) : l'hôte envoie un instantané, l'invité l'affiche -----
  snapshot() {
    return this.cars.map(c => {
      const a = [c.id, c.ti, c.seed, +c.cur.x.toFixed(2), +c.cur.z.toFixed(2), +c.curYaw.toFixed(3), c.brake ? 1 : 0, c.hazard > 0 ? 1 : 0];
      if (c.trailer) a.push(+c.trailer.kp.x.toFixed(2), +c.trailer.kp.z.toFixed(2), +c.trailer.yaw.toFixed(3)); else a.push(0, 0, 0);
      if (c.wreck && c.quat) a.push(+c.cur.y.toFixed(2), ...[c.quat.x, c.quat.y, c.quat.z, c.quat.w].map(x => +x.toFixed(3)));
      return a;
    });
  }
  applySnapshot(list) {
    const seen = new Set();
    const byId = new Map(this.cars.map(c => [c.id, c]));
    for (const a of list) {
      const [id, ti, seed, x, z, yaw, br, hz, kx, kz, ky] = a;
      seen.add(id);
      let c = byId.get(id);
      if (!c) { worldToRoad(x, z, _r); c = this.spawn(_r.s, 1, 1, { type: TRAFFIC_TYPES[ti], seed, id }); c.prev.set(x, 0, z); c.prevYaw = yaw; if (c.trailer) { c.trailer.prev.set(kx, 0, kz); c.trailer.prevYaw = ky; } }
      c.prev.copy(c.mesh.position); c.prevYaw = c.mesh.rotation.y;
      c.cur.set(x, a.length > 11 ? a[11] : 0, z); c.curYaw = yaw; c.brake = !!br; c.hazard = hz ? 1 : 0;
      worldToRoad(x, z, _r); c.s = _r.s; c.d = _r.d;
      if (a.length > 11) { c.wreck = true; (c.quat ||= new THREE.Quaternion()).set(a[12], a[13], a[14], a[15]); }
      if (c.trailer) { c.trailer.prev.copy(c.trailer.mesh.position); c.trailer.prevYaw = c.trailer.mesh.rotation.y; c.trailer.kp.set(kx, 0, kz); c.trailer.cur.set(kx, 0, kz); c.trailer.yaw = ky; }
    }
    for (const c of this.cars) if (!seen.has(c.id)) this.remove(c);
    this.cars = this.cars.filter(c => !c.dead);
  }
}

// chevauchement de deux rectangles orientés (axes séparateurs)
function obbOverlap(ax, az, ayaw, ahl, ahw, bx, bz, byaw, bhl, bhw) {
  const axes = [[Math.sin(ayaw), Math.cos(ayaw)], [Math.cos(ayaw), -Math.sin(ayaw)], [Math.sin(byaw), Math.cos(byaw)], [Math.cos(byaw), -Math.sin(byaw)]];
  const dx = bx - ax, dz = bz - az;
  for (const [ux, uz] of axes) {
    const ra = ahl * Math.abs(Math.sin(ayaw) * ux + Math.cos(ayaw) * uz) + ahw * Math.abs(Math.cos(ayaw) * ux - Math.sin(ayaw) * uz);
    const rb = bhl * Math.abs(Math.sin(byaw) * ux + Math.cos(byaw) * uz) + bhw * Math.abs(Math.cos(byaw) * ux - Math.sin(byaw) * uz);
    if (Math.abs(dx * ux + dz * uz) > ra + rb) return false;
  }
  return true;
}
