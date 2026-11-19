// Pilotes IA : police tactique (meneur / flanc / arrière / bretelle) et camion en fuite.
// Ils « comprennent » la situation : ils évitent les civils (angle mort, épaves, chantiers), utilisent la BAU,
// encerclent le camion quand il ralentit, gardent la sortie 18 quand il s'en approche, se replacent s'ils sont distancés.
import { laneD, SHOULDER_D, roadToWorld, roadYaw, clamp, DEST, DEST_S, EXIT_GAP, worldToRoad } from './config.js';

const _p = { x: 0, z: 0 }, _r = { s: 0, d: 0 };
const LEFT = laneD(1, 0) + 1.0, RIGHT = SHOULDER_D(1) - 0.3;

export class AIDriver {
  constructor(game, veh, role, opts = {}) {
    this.game = game; this.v = veh; this.role = role; // 'chase' | 'flee' | 'roadblock' | 'idle' | 'cruise' | 'guard'
    this.target = opts.target || null; this.lane = 1; this.laneT = 0; this.stuckT = 0; this.revT = 0;
    this.skill = opts.skill ?? 1; this.offset = opts.offset ?? 0; this.dir = 1;
    this.speedCap = opts.speedCap ?? 999; this.tactic = 'tail'; this.side = 0; this.lastSeen = null;
  }

  // obstacles le long de la bande latérale d (civils + véhicules + chantiers) : distance libre et vitesse de l'obstacle
  freeAhead(d, w = 2.6, maxD = 180, ignore) {
    const me = this.v, s0 = me.road.s, myFront = me.def.len / 2;
    let gap = maxD, ov = 0, civ = false;
    for (const o of this.game.trafficObs()) {
      if (o.veh === me || (ignore && o.veh === ignore)) continue;
      if (Math.abs(o.d - d) > (o.w + w) / 2) continue;
      const ext = o.dir === 1 || o.works ? o.back : o.front;
      const ds = (o.s - s0) - ext - myFront;
      if (ds > -2 && ds < gap) { gap = Math.max(0, ds); ov = o.v; civ = !!o.car; }
    }
    return { gap, ov, civ };
  }
  // un civil (ou autre) occupe-t-il la bande d à côté de nous ?
  sideBusy(d, w, ignore) {
    const me = this.v, s0 = me.road.s;
    for (const o of this.game.trafficObs()) {
      if (o.veh === me || (ignore && o.veh === ignore) || o.works) continue;
      if (Math.abs(o.d - d) > (o.w + w) / 2 + 0.3) continue;
      const ds = o.s - s0;
      if (ds < me.def.len / 2 + o.back + 2 && ds > -(me.def.len / 2 + o.front + 3)) return o;
    }
    return null;
  }

  update(dt) {
    const v = this.v, inp = v.input, g = this.game;
    if (v.disabled || this.role === 'roadblock' || this.role === 'idle') { inp.throttle = 0; inp.brake = Math.abs(v.speed) > 1 ? 1 : 0; inp.steer = 0; inp.handbrake = true; return; }
    inp.handbrake = false;
    const s = v.road.s, d = v.road.d, spd = v.speed;

    // marche arrière si coincé
    if (this.revT > 0) { this.revT -= dt; inp.throttle = 0; inp.brake = 1; inp.steer = -this.revSteer; if (this.revT <= 0) this.stuckT = 0; return; }
    if (Math.abs(spd) < 1.2 && g.time > 3 && this.wantV > 2) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    if (this.stuckT > 2.2) { this.revT = 1.4; this.revSteer = Math.sign((this.wantD ?? d) - d || 1) * 0.8; this.stuckT = 0; return; }

    const lanes = [laneD(1, 0), laneD(1, 1), laneD(1, 2), SHOULDER_D(1)];
    const tgt = this.target;
    let wantD, wantV = v.def.vmax / 3.6, aimPoint = null, ignore = null;

    // voie la plus dégagée (avec hystérésis)
    this.laneT -= dt;
    if (this.laneT <= 0) {
      this.laneT = 0.4 + Math.random() * 0.4;
      let best = this.lane, bestScore = -1e9;
      lanes.forEach((ld, i) => {
        if (i === 3 && this.role !== 'chase' && this.role !== 'flee') return;
        const fa = this.freeAhead(ld, v.def.w + 0.6, 220, tgt);
        const blocked = Math.abs(ld - d) > 1.5 && this.sideBusy(ld, v.def.w, tgt);
        const sc = fa.gap + Math.max(-10, fa.ov - spd) * 4 - Math.abs(ld - d) * 3 - (i === 3 ? 40 : 0) + (i === this.lane ? 18 : 0) - (blocked ? 200 : 0);
        if (sc > bestScore) { bestScore = sc; best = i; }
      });
      this.lane = best;
    }
    wantD = lanes[this.lane];

    if (this.role === 'chase' && tgt && !tgt.disabled) {
      ({ wantD, wantV, ignore, aimPoint } = this.chase(tgt, wantD, wantV, s, d, spd));
    } else if (this.role === 'guard') {
      // garder la bretelle de sortie : stationné en travers du début de la bretelle
      roadToWorld(EXIT_GAP[0] + 90, -19, _p);
      const dx = _p.x - v.curPos.x, dz = _p.z - v.curPos.z, dist = Math.hypot(dx, dz);
      aimPoint = { x: _p.x, z: _p.z }; wantV = dist > 40 ? 30 : dist > 6 ? Math.max(2, dist * 0.4) : 0;
      wantD = d;
      if (dist < 6) { inp.throttle = 0; inp.brake = Math.abs(spd) > 1 ? 1 : 0; inp.handbrake = true; inp.steer = 0; this.wantV = 0; return; }
    } else if (this.role === 'flee') {
      ({ wantD, wantV, aimPoint } = this.flee(wantD, wantV, s, d, spd));
    } else if (this.role === 'cruise') wantV = Math.min(wantV, this.speedCap / 3.6);

    if (g.confuseT > 0 && this.role === 'chase') { wantV *= 0.5; wantD = lanes[(Math.floor(g.time * 0.4) + (this.v.unit || 0)) % 3]; }
    wantD = clamp(wantD, RIGHT, LEFT);
    // ne pas se rabattre sur un civil qui est à côté
    if (!aimPoint && Math.abs(wantD - d) > 1.2) {
      const mid = d + Math.sign(wantD - d) * Math.min(2.4, Math.abs(wantD - d));
      const busy = this.sideBusy(mid, v.def.w * 0.9, ignore);
      if (busy && busy.car) wantD = d + Math.sign(wantD - d) * 0.3;
    }
    // vitesse sûre vis-à-vis de ce qu'il y a devant (on ne fonce pas dans les civils)
    const fa = this.freeAhead(d * 0.5 + wantD * 0.5, v.def.w + 0.3, 170, ignore);
    const safeV = Math.max(0, fa.ov) + Math.sqrt(Math.max(0, 2 * 7.5 * (fa.gap - (fa.civ ? 8 : 5))));
    wantV = Math.min(wantV, Math.max(0, safeV));
    this.wantD = wantD; this.wantV = wantV;
    this.drive(dt, wantD, wantV, aimPoint);
  }

  chase(tgt, wantD, wantV, s, d, spd) {
    const g = this.game, ds = tgt.road.s - s;
    const tlen = tgt.trailer ? tgt.def.trailer.len + 1 : 0;
    const tv = Math.max(0, tgt.speed);
    let ignore = null, aimPoint = null;
    const tactic = this.tactic;
    // camion presque arrêté : on l'encercle calmement (pas de carambolage)
    if (tgt.kmh < 25 && Math.abs(ds) < 60) {
      ignore = tgt;
      if (tactic === 'lead') { wantD = tgt.road.d; wantV = ds < -7 ? 0 : tv + 3; if (ds > -7) wantD = tgt.road.d + (this.side || 1) * 3.6; }
      else if (tactic === 'flank') { wantD = tgt.road.d + (this.side || -1) * 3.4; wantV = ds > 1 ? tv + 4 : tv * 0.8; }
      else { wantD = tgt.road.d; wantV = ds > tlen + 9 ? tv + 4 : 0; ignore = null; }
      return { wantD, wantV, ignore, aimPoint };
    }
    if (ds > tlen + 35) {
      // approche : voie la plus libre, convergence progressive, vitesse plafonnée (sécurité)
      if (ds < 140) wantD = wantD + (tgt.road.d - wantD) * 0.4;
      wantV = Math.min(wantV, ds > 900 ? 99 : this.speedCap / 3.6);
      if (g.env.wet > 0.5 || g.env.tunnel > 0.5) wantV = Math.min(wantV, 45);
    } else if (ds > -5) {
      ignore = tgt;
      // à hauteur : chaque unité a son côté (le meneur double, le flanc presse, l'arrière reste derrière)
      if (!this.side) this.side = tgt.road.d > laneD(1, 1) ? -1 : 1;
      if (tactic === 'tail') { wantD = tgt.road.d; wantV = ds > tlen + 12 ? tv + 6 : tv - 1; ignore = null; }
      else {
        let wd = tgt.road.d + this.side * 3.9;
        if (wd > LEFT || wd < RIGHT || this.sideBusy(wd, this.v.def.w, tgt)?.car) { const alt = tgt.road.d - this.side * 3.9; if (alt <= LEFT && alt >= RIGHT) { this.side = -this.side; wd = alt; } }
        wantD = wd;
        wantV = tv + (ds > tlen ? clamp((ds - tlen) * 0.4, 6, 20) : (tactic === 'lead' ? 10 : 2) * this.skill);
        // flanc : pousser le camion vers la glissière quand on est à hauteur de la cabine, sans civil de l'autre côté
        if (tactic === 'flank' && ds < 3 && ds > -4 && !this.sideBusy(tgt.road.d - this.side * 3.6, tgt.def.w, tgt)) wantD = tgt.road.d + this.side * 1.4;
      }
    } else {
      // devant : se rabattre devant le camion et freiner progressivement (bouchon roulant)
      ignore = tgt;
      wantD = tgt.road.d;
      wantV = ds > -16 ? Math.max(0, tv - 6 * this.skill) : Math.max(0, tv - clamp((-ds - 10) * 0.25, 3, 20));
      if (tactic === 'flank') { wantD = tgt.road.d + (this.side || 1) * 3.6; wantV = tv; }
    }
    return { wantD, wantV, ignore, aimPoint };
  }

  flee(wantD, wantV, s, d, spd) {
    const g = this.game;
    let aimPoint = null;
    // repérer la police : celle qui remonte derrière, celle qui bloque devant
    let behind = null, front = null;
    for (const p of g.police) {
      const ds = p.v.road.s - s;
      if (ds < 0 && ds > -45 && (!behind || ds > behind.ds)) behind = { v: p.v, ds };
      if (ds > 0 && ds < 40 && Math.abs(p.v.road.d - d) < 4 && (!front || ds < front.ds)) front = { v: p.v, ds };
    }
    if (behind && Math.abs(behind.v.road.d - d) < 7 && Math.random() < 0.95) wantD = clamp(behind.v.road.d, laneD(1, 2) - 1, LEFT); // couper la route
    if (front) { // contourner le bouchon roulant par le côté le plus large
      const l = this.freeAhead(front.v.road.d + 3.8, this.v.def.w, 80).gap, r = this.freeAhead(front.v.road.d - 3.8, this.v.def.w, 80).gap;
      wantD = front.v.road.d + (l > r ? 3.8 : -3.8);
    }
    if (s > DEST.s0 - 240) {
      const ms = (DEST.s0 + DEST.s1) / 2, md = (DEST.d0 + DEST.d1) / 2;
      if (s < DEST.s0 - 40) { wantD = -14 - (s - (DEST.s0 - 240)) / 200 * 8; wantV = 18; }
      else { roadToWorld(ms + 20, md, _p); aimPoint = { x: _p.x, z: _p.z }; wantV = 9; }
    }
    return { wantD, wantV, aimPoint };
  }

  drive(dt, wantD, wantV, aimPoint) {
    const v = this.v, inp = v.input, s = v.road.s, spd = v.speed;
    const look = clamp(Math.abs(spd) * 0.9, 9, 45);
    if (!aimPoint) { roadToWorld(s + look, wantD, _p); aimPoint = _p; }
    const dx = aimPoint.x - v.curPos.x, dz = aimPoint.z - v.curPos.z;
    let ang = Math.atan2(dx, dz) - v.yaw; ang = Math.atan2(Math.sin(ang), Math.cos(ang));
    const wb = Math.abs(v.def.wheels[0][1] - v.def.wheels[2][1]);
    const steerA = Math.atan2(2 * wb * Math.sin(ang), Math.hypot(dx, dz));
    const maxSteer = v.def.steer * (1 - 0.72 * clamp(Math.abs(spd) / 38));
    inp.steer = clamp(steerA / Math.max(maxSteer, 0.05), -1, 1);
    const ev = wantV - spd;
    if (ev > 0.5) { inp.throttle = clamp(ev * 0.25, 0.25, 1); inp.brake = 0; }
    else if (ev < -1.5) { inp.throttle = 0; inp.brake = clamp(-ev * 0.12, 0.1, 1); }
    else { inp.throttle = 0.1; inp.brake = 0; }
    if (spd < -0.5 && wantV > 0) { inp.brake = 0; inp.throttle = 1; }
    if (wantV < 0.6 && Math.abs(spd) < 1.2) { inp.throttle = 0; inp.brake = 0; inp.handbrake = true; this.stuckT = 0; }
  }
}

// Coordination de la police : attribue les rôles selon la position de chaque unité par rapport au camion.
export function assignTactics(game, truck) {
  const units = game.police.filter(p => p.ai && p.ai.role === 'chase' && !p.v.disabled);
  if (!truck || !units.length) return;
  units.sort((a, b) => b.v.road.s - a.v.road.s); // la plus avancée d'abord
  units.forEach((u, i) => { u.ai.tactic = i === 0 ? 'lead' : i === 1 ? 'flank' : 'tail'; });
  if (units[1]) units[1].ai.side = -(units[0].ai.side || 1);
  // près de la destination, l'unité la plus avancée (si devant) va garder la bretelle
  const lead = units[0];
  if (truck.road.s > EXIT_GAP[0] - 1600 && truck.road.s < EXIT_GAP[0] - 300 && units.length >= 2 && !game.guardSent && lead.v.road.s > truck.road.s + 50) {
    game.guardSent = true; lead.ai.role = 'guard';
    game.radio?.(`${lead.v.name} : je prends position sur la bretelle de la sortie 18, il ne passera pas.`, 'pol');
  }
}
