// Pilotes IA (police et camion en fuite) : poursuite pure + choix de voie selon l'espace libre
import { laneD, SHOULDER_D, roadToWorld, roadYaw, clamp, DEST, DEST_S, worldToRoad } from './config.js';

const _p = { x: 0, z: 0 };

export class AIDriver {
  constructor(game, veh, role, opts = {}) {
    this.game = game; this.v = veh; this.role = role; // 'chase' | 'flee' | 'roadblock' | 'cruise'
    this.target = opts.target || null; this.lane = 1; this.laneT = 0; this.stuckT = 0; this.revT = 0;
    this.skill = opts.skill ?? 1; this.offset = opts.offset ?? 0; this.dir = 1;
    this.speedCap = opts.speedCap ?? 999; this.state = 'drive'; this.boxT = 0;
  }

  // distance libre devant dans une bande latérale
  freeAhead(d, w = 2.6, maxD = 180, ignore) {
    const me = this.v, s0 = me.road.s;
    let gap = maxD, ov = 0;
    for (const o of this.game.traffic.cars) {
      if (Math.abs(o.d - d) > (o.w + w) / 2) continue;
      const ds = (o.s - s0) * this.dir - o.len / 2 - me.def.len / 2;
      if (ds > -2 && ds < gap) { gap = Math.max(0, ds); ov = o.wreck ? 0 : o.v * o.dir * this.dir; }
    }
    for (const o of this.game.dynVehicles()) {
      if (o === me || o === ignore) continue;
      if (Math.abs(o.road.d - d) > (o.def.w + w) / 2) continue;
      const ds = (o.road.s - s0) * this.dir - o.def.len / 2 - me.def.len / 2;
      if (ds > -2 && ds < gap) { gap = Math.max(0, ds); ov = o.speed; }
      if (o.trailer) { const tr = o.trailer.curPos, rd = worldToRoad(tr.x, tr.z, {}); if (Math.abs(rd.d - d) < (o.def.w + w) / 2) { const dt2 = (rd.s - s0) * this.dir - o.def.trailer.len / 2 - me.def.len / 2; if (dt2 > -2 && dt2 < gap) { gap = Math.max(0, dt2); ov = o.speed; } } }
    }
    for (const wk of this.game.world.roadworks) {
      if (wk.dir !== this.dir || Math.abs(laneD(wk.dir, wk.lane) - d) > 2.8) continue;
      const ds = (wk.s0 - 60 - s0) * this.dir;
      if (ds > -(wk.s1 - wk.s0) && ds < gap) { gap = Math.max(0, ds); ov = 0; }
    }
    return { gap, ov };
  }

  update(dt) {
    const v = this.v, inp = v.input, g = this.game;
    if (v.disabled || this.role === 'roadblock' || this.role === 'idle') { inp.throttle = 0; inp.brake = Math.abs(v.speed) > 1 ? 1 : 0; inp.steer = 0; inp.handbrake = true; return; }
    inp.handbrake = false;
    const s = v.road.s, d = v.road.d, spd = v.speed;

    // désincarcération : marche arrière si bloqué
    if (this.revT > 0) {
      this.revT -= dt; inp.throttle = 0; inp.brake = 1; inp.steer = -this.revSteer;
      if (this.revT <= 0) this.stuckT = 0;
      return;
    }
    if (Math.abs(spd) < 1.2 && g.time > 3) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    if (this.stuckT > 2.2) { this.revT = 1.6; this.revSteer = Math.sign(d - this.wantD || 1) * 0.7; this.stuckT = 0; return; }

    let wantD = laneD(1, this.lane), wantV = v.def.vmax / 3.6, aimPoint = null;
    const lanes = [laneD(1, 0), laneD(1, 1), laneD(1, 2), SHOULDER_D(1)];
    const tgt = this.target;

    // choix de voie : la plus dégagée
    this.laneT -= dt;
    if (this.laneT <= 0) {
      this.laneT = 0.5 + Math.random() * 0.5;
      let best = this.lane, bestScore = -1e9;
      lanes.forEach((ld, i) => {
        if (i === 3 && this.role !== 'chase' && this.role !== 'flee') return;
        const fa = this.freeAhead(ld, v.def.w + 0.6, 220, tgt);
        let sc = fa.gap + fa.ov * 4 - Math.abs(ld - d) * 3 - (i === 3 ? 45 : 0) + (i === this.lane ? 15 : 0);
        if (sc > bestScore) { bestScore = sc; best = i; }
      });
      this.lane = best;
    }
    wantD = lanes[this.lane];

    if (this.role === 'chase' && tgt && !tgt.disabled) {
      const ds = tgt.road.s - s;
      const tlen = tgt.trailer ? tgt.def.trailer.len + 1 : 0;
      const tv = Math.max(0, tgt.speed);
      const leftLim = laneD(1, 0) + 1.2, rightLim = SHOULDER_D(1) - 0.5;
      if (ds > tlen + 30) {
        // approche : voie la plus libre, puis convergence vers la cible
        if (ds < 120) wantD = wantD + (tgt.road.d - wantD) * 0.5;
        wantV = Math.min(wantV, ds > 900 ? 99 : this.speedCap / 3.6);
      } else if (ds > -5) {
        // derrière ou à hauteur : dépasser par un côté (choix du côté le plus large)
        if (!this.side) { this.side = tgt.road.d > laneD(1, 1) ? -1 : 1; if (this.police2 && Math.random() < 0.7) this.side = -this.side; }
        let wd = tgt.road.d + this.side * 3.8;
        if (wd > leftLim || wd < rightLim) { this.side = -this.side; wd = tgt.road.d + this.side * 3.8; }
        wantD = clamp(wd, rightLim, leftLim);
        wantV = tv + (ds > tlen ? clamp((ds - tlen) * 0.4, 6, 20) : 9 * this.skill);
        // coup de volant (PIT) quand on est à hauteur de la cabine
        if (ds < 3 && ds > -4 && Math.abs(tgt.road.d - d) < 4.6) { wantD = tgt.road.d + this.side * 1.2; }
      } else {
        // devant : se rabattre devant le camion et freiner (bouchon roulant)
        this.side = 0;
        wantD = tgt.road.d;
        wantV = ds > -16 ? Math.max(0, tv - 7 * this.skill) : Math.max(0, tv - clamp((-ds - 10) * 0.25, 3, 20));
      }
      if (tgt.speed < 4 && Math.abs(ds) < 18) wantV = 0;
      this.ignoreTgt = ds > -5;
    } else if (this.role === 'flee') {
      wantV = v.def.vmax / 3.6;
      // gêner la police qui remonte
      let threat = null, td = 1e9;
      for (const p of g.police) { const ds = s - p.v.road.s; if (ds > -4 && ds < 45 && ds < td) { td = ds; threat = p.v; } }
      if (threat && Math.abs(threat.road.d - d) < 6 && Math.random() < 0.9) wantD = clamp(threat.road.d, laneD(1, 2) - 1, laneD(1, 0) + 0.5);
      // rejoindre la plateforme
      if (s > DEST.s0 - 220) {
        const ms = (DEST.s0 + DEST.s1) / 2, md = (DEST.d0 + DEST.d1) / 2;
        if (s < DEST.s0 - 40) { wantD = -14 - (s - (DEST.s0 - 220)) / 180 * 8; wantV = 18; }
        else { roadToWorld(ms + 20, md, _p); aimPoint = { x: _p.x, z: _p.z }; wantV = 9; }
      }
    } else if (this.role === 'cruise') {
      wantV = Math.min(wantV, this.speedCap / 3.6);
    }

    // évitement : ne pas foncer dans l'obstacle de la voie choisie (sauf la cible en poursuite)
    const fa = this.freeAhead(d * 0.5 + wantD * 0.5, v.def.w + 0.3, 160, this.role === 'chase' && this.ignoreTgt ? tgt : null);
    const safeV = fa.ov + Math.sqrt(Math.max(0, 2 * 7 * (fa.gap - 6)));
    wantV = Math.min(wantV, Math.max(0, safeV));
    this.wantD = wantD;

    // direction : poursuite pure vers un point à distance d'anticipation
    const look = clamp(Math.abs(spd) * 0.9, 9, 45);
    if (!aimPoint) { roadToWorld(s + look, wantD, _p); aimPoint = _p; }
    const dx = aimPoint.x - v.curPos.x, dz = aimPoint.z - v.curPos.z;
    let ang = Math.atan2(dx, dz) - v.yaw; ang = Math.atan2(Math.sin(ang), Math.cos(ang));
    const wb = Math.abs(v.def.wheels[0][1] - v.def.wheels[2][1]);
    const steerA = Math.atan2(2 * wb * Math.sin(ang), Math.hypot(dx, dz));
    const maxSteer = v.def.steer * (1 - 0.72 * clamp(Math.abs(spd) / 38));
    inp.steer = clamp(steerA / Math.max(maxSteer, 0.05), -1, 1);

    // gaz / frein
    const ev = wantV - spd;
    if (ev > 0.5) { inp.throttle = clamp(ev * 0.25, 0.25, 1); inp.brake = 0; }
    else if (ev < -1.5) { inp.throttle = 0; inp.brake = clamp(-ev * 0.12, 0.1, 1); }
    else { inp.throttle = 0.1; inp.brake = 0; }
    if (spd < -0.5 && wantV > 0) { inp.brake = 0; inp.throttle = 1; }
    if (wantV < 0.6 && Math.abs(spd) < 1.2) { inp.throttle = 0; inp.brake = 0; inp.handbrake = true; this.stuckT = 0; }
  }
}
