// Boucle de jeu, règles de poursuite, menus, garage, mode libre, multijoueur (côté client)
import * as THREE from 'three';
import {
  VEHICLES, TEAM_VEHICLES, PAINTS, settings, saveSettings, laneD, SHOULDER_D, roadToWorld, roadYaw, worldToRoad, DEST, DEST_S,
  inTunnel, clamp, rng, fmtTime, REST_AREAS,
} from './config.js';
import { World } from './world.js';
import { Vehicle } from './vehicle.js';
import { Traffic } from './traffic.js';
import { AIDriver } from './ai.js';
import { Env } from './env.js';
import { Glows, Particles } from './fx.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { CameraRig, CAM_NAMES } from './camera.js';
import { HUD } from './hud.js';
import { Net, QUICK_CHAT } from './net.js';
import { buildPoliceCar, buildPlayerTruck, buildTrailer, makeWheel, buildPerson, initMaterials, MAT } from './models.js';

const $ = id => document.getElementById(id);
const DT = 1 / 60;
const _v = new THREE.Vector3(), _p = { x: 0, z: 0 };
const DIFF = { easy: { police: 2, speed: 150, skill: 0.7, block: false, time: 420 }, normal: { police: 3, speed: 170, skill: 1, block: true, time: 360 }, hard: { police: 5, speed: 195, skill: 1.25, block: true, time: 330 } };

export class Game {
  constructor(R, renderer, camera, rig) {
    this.R = R; this.renderer = renderer; this.camera = camera; this.rig = rig;
    initMaterials();
    this.scene = new THREE.Scene();
    this.scene.add(rig);
    this.phys = new R.World({ x: 0, y: -9.81, z: 0 });
    this.phys.timestep = DT;
    this.world = new World(this.scene, R, this.phys, 1);
    this.env = new Env(renderer, this.scene);
    this.traffic = new Traffic(this);
    this.glows = new Glows(this.scene); this.particles = new Particles(this.scene);
    this.audio = new Audio(); this.input = new Input(); this.camRig = new CameraRig(camera); this.hud = new HUD(); this.net = new Net();
    this.vehicles = []; this.police = []; this.fugitives = []; this.spikes = []; this.remotes = new Map();
    this.player = null; this.person = null; this.state = 'menu'; this.mode = 'chase'; this.team = settings.team;
    this.time = 0; this.acc = 0; this.menuS = 120; this.bust = 0; this.stats = { crashes: 0, topSpeed: 0, dist: 0 };
    this.lightsSetup();
    this.applyQuality();
    this.env.setTime(settings.time); this.env.setWeather(settings.weather);
    this.world.update(this.menuS - 200, this.menuS + 200, new THREE.Vector3(0, 0, this.menuS), 0, true);
    this.traffic.populate(this.menuS);
    this.netSetup();
  }

  // ---------- utilitaires ----------
  dynVehicles() { return this.vehicles; }
  roadPose(s, d) { roadToWorld(s, d, _p); return { x: _p.x, z: _p.z, yaw: roadYaw(s) }; }
  toRoad(x, z) { return worldToRoad(x, z, {}); }
  targetTruck() { return this.fugitives[0]?.v || (this.team === 'truck' ? this.player : null); }
  nearestPolice(pos) {
    let best = { d: 1e9, v: null };
    for (const p of this.police) { if (p.v === this.player) continue; const d = p.v.curPos.distanceTo(pos); if (d < best.d) best = { d, v: p.v }; }
    for (const r of this.remotes.values()) if (r.team === 'police') { const d = r.curPos.distanceTo(pos); if (d < best.d) best = { d, v: r }; }
    return best;
  }

  lightsSetup() {
    this.spots = [0, 1].map(() => { const s = new THREE.SpotLight(0xfff2dd, 0, 90, 0.42, 0.55, 1.4); this.scene.add(s, s.target); return s; });
    this.flashLights = [new THREE.PointLight(0x2060ff, 0, 30, 1.6), new THREE.PointLight(0xff2020, 0, 30, 1.6)];
    this.flashLights.forEach(l => this.scene.add(l));
  }
  applyQuality() {
    const q = settings.quality;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, q === 'high' ? 1.5 : q === 'medium' ? 1 : 0.75));
    this.renderer.shadowMap.enabled = settings.shadows;
    this.env.sun.castShadow = settings.shadows;
    this.env.sun.shadow.mapSize.set(q === 'high' ? 2048 : 1024, q === 'high' ? 2048 : 1024);
    if (this.env.sun.shadow.map) { this.env.sun.shadow.map.dispose(); this.env.sun.shadow.map = null; }
    this.camera.far = q === 'low' ? 2500 : 4000; this.camera.updateProjectionMatrix();
    this.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
  }

  // ---------- démarrage d'une partie ----------
  clearMatch() {
    for (const v of this.vehicles) v.dispose();
    this.vehicles = []; this.police = []; this.fugitives = []; this.spikes.forEach(s => this.scene.remove(s.mesh)); this.spikes = [];
    if (this.person) this.leaveFoot(true);
    this.player = null; this.bust = 0; this.audio.stopAllSirens?.();
    if (this.preview) { this.scene.remove(this.preview); this.preview = null; }
  }

  start(cfg) {
    this.audio.init();
    this.clearMatch();
    Object.assign(this, { mode: cfg.mode, team: cfg.team });
    const diff = this.diff = DIFF[settings.difficulty] || DIFF.normal;
    this.env.setTime(settings.time); this.env.setWeather(settings.weather);
    this.seed = cfg.seed ?? (Math.random() * 1e6 | 0);
    const r = rng(this.seed);
    // chantiers aléatoires
    const works = [];
    if (cfg.mode !== 'online' || true) {
      works.push({ s0: 1150 + r() * 400, dir: 1, lane: r() < 0.5 ? 0 : 2 });
      works.push({ s0: 4150 + r() * 350, dir: 1, lane: r() < 0.5 ? 0 : 2 });
      works.push({ s0: 2700 + r() * 400, dir: -1, lane: 2 });
      works.push({ s0: 6500 + r() * 300, dir: 1, lane: 2 });
      works.forEach(w => w.s1 = w.s0 + 220 + r() * 140);
    }
    for (const k of [...this.world.chunks.keys()]) this.world.unload(k);
    this.world.setRoadworks(works);

    const vid = cfg.vehicle || settings.vehicle[cfg.team];
    const paint = settings.paint[vid];
    let ps = 0, pd = laneD(1, 2);
    if (cfg.team === 'police' && cfg.mode === 'chase') { ps = -90; pd = SHOULDER_D(1); }
    if (cfg.mode === 'free') { ps = 40; }
    if (cfg.mode === 'online') { ps = (cfg.team === 'police' ? -80 : 0) + (this.net.id % 6) * 12; pd = laneD(1, this.net.id % 3); }
    this.world.update(ps - 300, ps + 600, new THREE.Vector3(0, 0, ps), 0, true);
    const pose = this.roadPose(ps, pd);
    this.player = this.addVehicle(vid, ps, pd, { paint });
    this.camRig.mode = 'chase'; this.camRig.pos.set(pose.x, 6, pose.z - 20);
    this.time = 0; this.timeLeft = diff.time; this.headStart = cfg.team === 'truck' ? 15 : 10; this.released = false;
    this.stats = { crashes: 0, topSpeed: 0, dist: 0, start: ps, busts: 0 };
    this.nextReinforce = 55; this.blockDone = !diff.block; this.ended = false; this.radioT = 0;
    this.unitN = 1;

    if (cfg.mode === 'chase') {
      if (cfg.team === 'truck') {
        const n = Math.min(2, diff.police);
        for (let i = 0; i < n; i++) this.addPolice(-70 - i * 22, SHOULDER_D(1), 'idle');
      } else {
        // suspect IA : camion avec un peu d'avance
        const tid = ['semi', 'flatbed', 'delivery'][Math.floor(r() * 3)];
        const fv = this.addVehicle(tid, 30, laneD(1, 1), { ai: true, name: 'Suspect' });
        const ai = new AIDriver(this, fv, 'flee'); ai.lane = 1; this.fugitives.push(ai);
        fv.setVelocityForward(18);
        this.police.push({ v: this.player, ai: null });
        const partner = this.addPolice(-120, laneD(1, 0), 'idle');
        partner.offset = 2;
      }
    }
    // trafic
    this.traffic.populate(ps + 200);
    // nettoyer le trafic au point de départ
    for (const c of this.traffic.cars) if (Math.abs(c.s - ps) < 60) this.traffic.remove(c);
    this.traffic.cars = this.traffic.cars.filter(c => !c.dead);

    this.player.headlights = this.env.night > 0.4;
    this.hud.setRole(cfg.team, cfg.mode);
    this.hud.show(true);
    this.setState('countdown');
    this.countdown = 3.5;
    this.player.input = { throttle: 0, brake: 0, steer: 0, handbrake: true };
    this.lastCfg = cfg;
    if (cfg.mode === 'chase') {
      if (cfg.team === 'truck') this.radio('Central : un camion suspect vient de quitter le dépôt. Patrouilles en alerte.', 'pol');
      else this.radio('Central : suspect à bord d’un poids lourd, direction Lyon. Interceptez-le avant la Plateforme Logistique (sortie 18).', 'pol');
    } else if (cfg.mode === 'free') this.hud.msg('Mode libre : roulez sans objectif. <b>Échap</b> pour le menu.');
  }

  addVehicle(id, s, d, opts = {}) {
    const p = this.roadPose(s, d);
    const v = new Vehicle(this, id, { x: p.x, z: p.z, yaw: p.yaw, ...opts });
    this.vehicles.push(v);
    return v;
  }
  addPolice(s, d, role) {
    const ids = ['sedan', 'suv', 'wagon'];
    const v = this.addVehicle(ids[this.unitN % 3], s, d, { ai: true, name: 'Unité ' + this.unitN });
    v.unit = this.unitN++;
    const ai = new AIDriver(this, v, role, { target: this.targetTruck(), skill: this.diff.skill, speedCap: this.diff.speed, offset: (this.police.length % 2 ? -1 : 1) * (1 + this.police.length * 0.5) });
    ai.lane = Math.floor(Math.random() * 3); ai.police2 = this.police.filter(p => p.ai).length % 2 === 1;
    this.police.push({ v, ai });
    v.siren = role !== 'idle';
    return ai;
  }

  radio(text, kind = '') { this.hud.msg('📻 ' + text, kind); this.audio.radio?.(); }

  setState(s) {
    this.state = s;
    document.body.dataset.state = s;
    $('pause').classList.toggle('on', s === 'pause');
  }

  // ---------- boucle ----------
  frame(dt) {
    dt = Math.min(dt, 0.1);
    const inp = this.input;
    if (inp.hit('Escape') || inp.hit('KeyP')) {
      if (this.state === 'play' || this.state === 'countdown') { this.prevState = this.state; this.setState('pause'); }
      else if (this.state === 'pause') this.setState(this.prevState || 'play');
    }
    const running = this.state === 'play' || this.state === 'countdown' || this.state === 'menu' || this.state === 'garage' || this.state === 'end';
    if (running) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= DT && n < 4) { this.fixed(DT); this.acc -= DT; n++; }
      if (n === 4) this.acc = 0;
    }
    const alpha = this.acc / DT;
    for (const v of this.vehicles) v.render(alpha, this.time);
    this.traffic.render(alpha);
    for (const r of this.remotes.values()) r.render?.();
    if (this.person) { this.person.mesh.position.copy(this.person.pos); this.person.mesh.rotation.y = this.person.yaw; }

    // caméra
    if (this.state === 'menu') this.menuCam(dt);
    else if (this.state === 'garage') this.garageCam(dt);
    else {
      if (inp.hit('KeyC') && this.player && !this.person) this.hud.toast(CAM_NAMES[this.camRig.cycle()]);
      this.camRig.lookBack = inp.down('KeyX');
      this.camRig.update(dt, this.player, inp, this.person);
    }
    const camPos = this.camera.position;
    const camRoad = worldToRoad(camPos.x, camPos.z, {});
    const tun = inTunnel(camRoad.s) && Math.abs(camRoad.d) < 17 && camPos.y < 8;
    this.env.tunnel += ((tun ? 1 : 0) - this.env.tunnel) * Math.min(1, dt * 3);
    const focus = this.player ? this.player.pos : (this.person ? this.person.pos : camPos);
    this.env.update(dt, focus, camPos, tun, this.audio);
    this.world.setWet(this.env.wet); this.world.setNight(Math.max(this.env.night, 0));
    if (this.world.beam) this.world.beam.material.opacity = 0.08 + 0.06 * Math.sin(this.time * 3);

    // feux & halos
    const night = this.env.night > 0.45 || this.env.tunnel > 0.5 || this.env.fogAmt > 0.6;
    const list = [];
    if (this.env.night > 0.3) this.world.lampGlows(camPos, list.length < 1 ? list : list);
    for (const v of this.vehicles) { if (v.ai) v.headlights = night || this.env.rainAmt > 0.5; v.lightPoints(list); }
    for (const r of this.remotes.values()) r.lightPoints?.(list);
    this.traffic.lightPoints(list, night || this.env.rainAmt > 0.6, camPos);
    this.glows.set(list, this.env.night > 0.3 || this.env.tunnel > 0.3 ? 1 : 0.55);
    this.updateLights();
    this.particles.points.material.uniforms.light.value = Math.max(0.12, 1 - this.env.night * 0.85) * (1 - this.env.tunnel * 0.4);
    this.particles.update(dt);

    // audio
    const pv = this.person ? null : this.player;
    this.audio.updatePlayer(this.state === 'play' || this.state === 'countdown' ? pv : null, dt, { cockpit: this.camRig.mode === 'cockpit', wet: this.env.wet, rain: this.env.rainAmt, tunnel: this.env.tunnel, trafficNear: this.traffic.near(camPos, 60).n });
    const fwd = _v.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.audio.setListener(camPos, fwd);
    for (const p of this.police) this.audio.updateSiren(p.v, p.v.siren && !p.v.disabled && this.state !== 'menu', p.v === this.player);
    for (const r of this.remotes.values()) this.audio.updateSiren(r, r.siren);

    if (this.state === 'play' || this.state === 'countdown' || this.state === 'end') this.hud.update(this);
    inp.endFrame();
  }

  fixed(dt) {
    this.time += dt;
    const inp = this.input, pl = this.player;
    // décompte
    if (this.state === 'countdown') {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const now = Math.ceil(this.countdown);
      if (now !== before && now > 0) { this.hud.big(String(now)); this.audio.beep(660, 0.15); }
      if (this.countdown <= 0) {
        this.setState('play'); this.hud.big('GO !', 'go'); this.audio.beep(1320, 0.35);
        if (this.mode === 'chase' && this.team === 'police') this.hud.msg(`Le suspect a <b>${this.headStart} s</b> d'avance — attendez le feu vert de la centrale.`);
        if (this.mode === 'chase' && this.team === 'truck') this.hud.msg(`Vous avez <b>${this.headStart} s</b> d'avance avant le départ de la police. Foncez !`);
        this.time = 0;
      }
    }
    // commandes joueur
    if (pl && !this.person) {
      const lockedPolice = this.state === 'countdown' || (this.mode === 'chase' && this.team === 'police' && this.state === 'play' && this.time < this.headStart);
      if (this.state === 'play' && !lockedPolice) pl.input = inp.drive();
      else if (this.state === 'countdown' || lockedPolice) { const d = inp.drive(); pl.input = { throttle: 0, brake: 0, steer: d.steer, handbrake: true }; }
      else pl.input = { throttle: 0, brake: pl.kmh > 3 && !pl.reverse ? 1 : 0, steer: 0, handbrake: true };
      if (this.state === 'play') this.playerKeys(pl);
    } else if (this.person) this.footStep(dt);

    // IA
    for (const p of this.police) if (p.ai) { p.ai.target = this.targetTruck(); p.ai.update(dt); }
    for (const f of this.fugitives) { if (this.state === 'countdown') { f.v.input = { throttle: 0, brake: 0, steer: 0, handbrake: false }; } else f.update(dt); }

    const env = { wet: this.env.wet };
    for (const v of this.vehicles) v.step(dt, env);
    const focusS = this.state === 'garage' ? this.garageS : pl ? pl.road.s : (this.person ? this.toRoad(this.person.pos.x, this.person.pos.z).s : this.menuS);
    this.traffic.step(dt, focusS, this.env.wet);
    this.phys.step();
    for (const v of this.vehicles) v.postStep(dt);
    this.updateRemotes(dt);

    // monde progressif
    let mn = focusS, mx = focusS;
    for (const v of this.vehicles) if (Math.abs(v.road.s - focusS) < 1500) { mn = Math.min(mn, v.road.s); mx = Math.max(mx, v.road.s); }
    this.world.update(mn, mx, this.camera.position, dt);

    // effets de collision
    for (const v of this.vehicles) {
      if (v.impact > 1.6) {
        const near = v.curPos.distanceTo(this.camera.position);
        if (near < 150) this.audio.crash(v.curPos, v.impact);
        if (v === pl) { this.camRig.shake = Math.min(1.5, v.impact * 0.15); }
        for (let i = 0; i < Math.min(14, v.impact * 2); i++) this.particles.emit(v.curPos.x + (Math.random() - 0.5) * 2, v.curPos.y + 0.5, v.curPos.z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 8, Math.random() * 5, (Math.random() - 0.5) * 8, 0.4, 0.12, 0, 0xffb040, 1);
      }
      this.vehicleFx(v, dt);
    }
    // herses
    for (const sp of this.spikes) for (const v of this.vehicles) {
      if (v.team !== 'truck' || v.spikes > 0) continue;
      if (Math.abs(v.road.s - sp.s) < 2.5 && Math.abs(v.road.d - sp.d) < sp.w / 2 + 1) {
        v.spikes = 1; this.audio.crash(v.curPos, 3);
        if (v === pl) this.hud.msg('💥 <b>Herse !</b> Pneus crevés : vitesse et adhérence réduites.', 'red');
        else this.radio('Le suspect a roulé sur la herse !', 'pol');
      }
    }
    if (this.state === 'play') this.rules(dt);
    if (pl) { this.stats.topSpeed = Math.max(this.stats.topSpeed, pl.kmh); }
    this.net.tick(dt, this.person ? null : pl);
  }

  vehicleFx(v, dt) {
    if (v.curPos.distanceToSquared(this.camera.position) > 250 * 250) return;
    const back = _v.set(0, 0, -v.def.len / 2).applyQuaternion(v.curQuat).add(v.curPos);
    if (v.slip > 0.3 && this.env.wet < 0.4 && Math.random() < v.slip) this.particles.emit(back.x, 0.3, back.z, (Math.random() - 0.5), 0.6, (Math.random() - 0.5), 1.8, 0.6, 1.6, 0xd8d8d8, 0.35);
    if (this.env.wet > 0.5 && v.kmh > 40 && Math.random() < 0.6) {
      const src = v.trailer ? v.trailer.curPos.clone().add(_v.set(0, 0, -v.def.trailer.len + 1.5).applyQuaternion(v.trailer.curQuat)) : back;
      this.particles.emit(src.x + (Math.random() - 0.5) * 2, 0.5, src.z, v.lastV.x * 0.3, 0.8, v.lastV.z * 0.3, 0.9, 0.8, 2.5, 0xd0d6dc, 0.13);
    }
    if (v.damage > 55 && Math.random() < (v.damage - 50) / 60) {
      const front = _v.set(0, 0.8, v.def.len / 2 - 0.6).applyQuaternion(v.curQuat).add(v.curPos);
      this.particles.emit(front.x, front.y, front.z, v.lastV.x * 0.2, 1.2, v.lastV.z * 0.2, 2.2, 0.5, 1.4, v.damage > 85 ? 0x303030 : 0x8a8a8a, 0.45);
    }
  }

  updateLights() {
    const pl = this.person ? null : this.player;
    for (let i = 0; i < 2; i++) {
      const s = this.spots[i];
      if (pl && pl.headlights) {
        const hw = pl.def.w * 0.36 * (i ? 1 : -1), y = (pl.def.team === 'truck' ? 1.1 : 0.8) - pl.bodyY;
        s.position.copy(_v.set(hw, y, pl.def.len / 2).applyQuaternion(pl.quat).add(pl.pos));
        s.target.position.copy(_v.set(hw * 1.5, -1.2, pl.def.len / 2 + 30).applyQuaternion(pl.quat).add(pl.pos));
        s.intensity = 120 * (0.4 + this.env.night * 0.6);
      } else s.intensity = 0;
    }
    // gyrophares : la voiture de police la plus proche de la caméra éclaire l'environnement
    let best = null, bd = 1e9;
    for (const p of this.police) if (p.v.siren) { const d = p.v.pos.distanceToSquared(this.camera.position); if (d < bd) { bd = d; best = p.v; } }
    for (const [i, l] of this.flashLights.entries()) {
      if (best && bd < 120 * 120) {
        l.position.copy(_v.set(i ? -0.5 : 0.5, best.model.roofH + 0.4 - best.bodyY, 0).applyQuaternion(best.quat).add(best.pos));
        l.intensity = ((i ? best.flashB : best.flashA) ? 60 : 0) * (0.35 + this.env.night * 0.65);
      } else l.intensity = 0;
    }
  }

  playerKeys(v) {
    const inp = this.input;
    if (inp.hit('KeyL')) { v.headlights = !v.headlights; this.hud.toast(v.headlights ? 'Phares allumés' : 'Phares éteints'); }
    if (inp.hit('KeyE') && v.isPolice) { v.siren = !v.siren; this.hud.toast(v.siren ? 'Gyrophares + sirène' : 'Sirène coupée'); }
    if (inp.hit('KeyV')) { v.wiping = !v.wiping; this.hud.toast(v.wiping ? 'Essuie-glaces' : 'Essuie-glaces arrêtés'); }
    v.horn = inp.down('KeyH');
    if (v.horn && !this._hornT) { this._hornT = 1; }
    if (!v.horn) this._hornT = 0;
    if (this.env.rainAmt > 0.4 && !v._autoWipe) { v.wiping = true; v._autoWipe = true; }
    if (inp.hit('KeyR')) this.respawn(v);
    if (v.flipT > 3) { this.respawn(v); this.hud.msg('Véhicule remis sur la route.'); }
    if (inp.hit('KeyF') && v.kmh < 8) this.enterFoot(v);
    if (inp.hit('KeyM')) { this.hud.mapZoom = this.hud.mapZoom > 0.5 ? 0.25 : this.hud.mapZoom > 0.3 ? 1.1 : 0.55; this.hud.toast('Zoom carte'); }
    for (let i = 0; i < 6; i++) if (inp.hit('Digit' + (i + 1)) && this.net.room) this.net.chat(i);
  }

  respawn(v) {
    const lane = clamp(Math.round((Math.abs(v.road.d) - 3) / 3.6), 0, 2);
    let s = v.road.s;
    if (v.road.d > 0 && this.mode !== 'free') s = s; // retour côté sens de circulation correct
    v.resetOnRoad(s, laneD(1, lane));
    if (this.mode === 'chase') { this.timeLeft -= 5; this.hud.toast('Repositionnement (−5 s)'); }
  }

  // ---------- à pied ----------
  enterFoot(v) {
    const R = this.R;
    const side = _v.set(v.def.w / 2 + 1.0, 0, v.def.cab.z).applyQuaternion(v.quat).add(v.pos);
    const body = this.phys.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(side.x, 0.95, side.z));
    const col = this.phys.createCollider(R.ColliderDesc.capsule(0.55, 0.32), body);
    const ctrl = this.phys.createCharacterController(0.05);
    ctrl.enableAutostep(0.4, 0.2, true); ctrl.enableSnapToGround(0.5); ctrl.setApplyImpulsesToDynamicBodies(true);
    const mesh = buildPerson(v.isPolice ? 0x1d2f5a : 0x5a4a2e);
    this.scene.add(mesh);
    this.person = { body, col, ctrl, mesh, pos: new THREE.Vector3(side.x, 0, side.z), yaw: v.yaw - Math.PI / 2, vy: 0, vehicle: v, walk: 0 };
    v.input = { throttle: 0, brake: 0, steer: 0, handbrake: true };
    this.camRig.orbit.yaw = v.yaw; this.hud.toast('À pied — F pour remonter');
  }
  leaveFoot(silent) {
    const p = this.person; if (!p) return;
    this.phys.removeCharacterController(p.ctrl); this.phys.removeRigidBody(p.body); this.scene.remove(p.mesh);
    this.person = null;
    if (!silent) this.hud.toast('De retour au volant');
  }
  footStep(dt) {
    const p = this.person, inp = this.input;
    if (this.player) this.player.input = { throttle: 0, brake: 0, steer: 0, handbrake: true };
    const f = (inp.down('KeyW', 'ArrowUp') ? 1 : 0) - (inp.down('KeyS', 'ArrowDown') ? 1 : 0);
    const s = (inp.down('KeyA', 'ArrowLeft') ? 1 : 0) - (inp.down('KeyD', 'ArrowRight') ? 1 : 0);
    const run = inp.down('ShiftLeft') ? 6.5 : 3.2;
    const cy = this.camRig.orbit.yaw;
    let mx = Math.sin(cy) * f + Math.cos(cy) * s, mz = Math.cos(cy) * f - Math.sin(cy) * s;
    const l = Math.hypot(mx, mz);
    if (l > 0) { mx /= l; mz /= l; p.yaw = Math.atan2(mx, mz); }
    p.vy -= 9.81 * dt;
    const mv = { x: mx * run * dt, y: p.vy * dt, z: mz * run * dt };
    p.ctrl.computeColliderMovement(p.col, mv);
    const c = p.ctrl.computedMovement(), t = p.body.translation();
    if (p.ctrl.computedGrounded()) p.vy = 0;
    p.body.setNextKinematicTranslation({ x: t.x + c.x, y: t.y + c.y, z: t.z + c.z });
    p.pos.set(t.x + c.x, t.y + c.y - 0.87, t.z + c.z);
    if (this.input.hit('KeyF') && this.state === 'play') {
      // remonter dans le véhicule le plus proche du joueur (le sien)
      if (p.pos.distanceTo(p.vehicle.curPos) < 6 + p.vehicle.def.len / 2) { this.leaveFoot(); }
      else this.hud.toast('Trop loin du véhicule');
    }
  }

  // ---------- règles de la poursuite ----------
  rules(dt) {
    const pl = this.player;
    if (this.mode === 'free' || this.mode === 'online') { if (this.mode === 'online') this.onlineRules(dt); return; }
    this.timeLeft -= dt;
    const truck = this.targetTruck();
    // libération de la police après l'avance
    if (!this.released && this.time >= this.headStart) {
      this.released = true;
      for (const p of this.police) if (p.ai) { p.ai.role = 'chase'; p.v.siren = true; }
      if (this.team === 'truck') this.radio('Central : toutes les unités, poursuite engagée ! Sirènes activées.', 'pol');
      else { this.radio('Central : feu vert, poursuite autorisée ! (E : sirène)', 'pol'); pl.siren = true; }
    }
    // renforts
    if (this.released && this.time > this.nextReinforce) {
      this.nextReinforce += 50;
      const count = this.police.filter(p => p.ai && !p.v.disabled).length;
      if (count < this.diff.police - (this.team === 'police' ? 2 : 0) && truck) {
        const s = truck.road.s - 420;
        const ai = this.addPolice(s, laneD(1, 0), 'chase');
        ai.v.setVelocityForward(40);
        this.radio(`Unité ${ai.v.unit} en renfort, arrive par l'arrière.`, 'pol');
      }
    }
    // barrage + herse devant le camion
    if (!this.blockDone && this.released && this.time > 75 && truck && truck.road.s < DEST.s0 - 1500) {
      this.blockDone = true;
      let bs = truck.road.s + 1100;
      if ((bs > 2950 && bs < 3650) || (bs > 5750 && bs < 6350)) bs += 700;
      const a = this.addPolice(bs, laneD(1, 0) - 0.4, 'roadblock'), b = this.addPolice(bs + 4, laneD(1, 1), 'roadblock');
      for (const ai of [a, b]) { ai.v.siren = true; ai.v.resetOnRoad(ai.v.road.s, ai.v.road.d, roadYaw(ai.v.road.s) + 1.2); }
      this.addSpike(bs - 12, laneD(1, 2) - 1.2, 6.5);
      this.radio(`Barrage installé au PK ${(bs / 1000).toFixed(1)} avec herse. Voies de gauche bloquées.`, 'pol');
      this.roadblock = { s: bs, units: [a, b] };
    }
    if (this.roadblock && truck && truck.road.s > this.roadblock.s + 30) { for (const ai of this.roadblock.units) if (ai.role === 'roadblock') ai.role = 'chase'; this.roadblock = null; }
    // téléportation des unités trop distancées (hors de vue)
    for (const p of this.police) if (p.ai && truck && p.ai.role === 'chase' && truck.road.s - p.v.road.s > 1300) {
      const v = p.v; v.resetOnRoad(truck.road.s - 700, laneD(1, 0)); v.setVelocityForward(40);
    }
    // interpellation
    if (truck) {
      let close = false;
      for (const p of this.police) {
        if (p.v.disabled) continue;
        let d = p.v.curPos.distanceTo(truck.curPos);
        if (truck.trailer) d = Math.min(d, p.v.curPos.distanceTo(truck.trailer.curPos));
        if (d < 15) close = true;
      }
      const slow = truck.kmh < 14;
      if (close && slow && this.released) this.bust = Math.min(1, this.bust + dt / 3.2);
      else this.bust = Math.max(0, this.bust - dt / 5);
      if (truck.disabled) this.bust = 1;
      if (truck.upright < 0.3 && truck.kmh < 5) this.bust = Math.min(1, this.bust + dt / 2);
      if (this.bust >= 1) return this.finish(this.team === 'police', this.team === 'police' ? 'Suspect interpellé !' : 'Vous avez été interpellé.', truck.disabled ? 'Le camion est hors d’usage.' : 'La police a immobilisé le camion.');
      // arrivée
      const rd = truck.road;
      if (rd.s > DEST.s0 && rd.s < DEST.s1 && rd.d < DEST.d0 + 2 && rd.d > DEST.d1) {
        return this.finish(this.team === 'truck', this.team === 'truck' ? 'Livraison réussie !' : 'Le suspect s’est échappé.', 'Le camion a atteint la Plateforme Logistique.');
      }
    }
    if (this.team === 'police' && pl.disabled) return this.finish(false, 'Véhicule hors service', 'Votre voiture de police est trop endommagée.');
    if (this.timeLeft <= 0) return this.finish(this.team === 'police', this.team === 'police' ? 'Livraison empêchée !' : 'Temps écoulé', 'Le camion n’a pas atteint sa destination à temps.');
    // radio d'ambiance
    this.radioT -= dt;
    if (this.radioT <= 0 && this.released && truck) {
      this.radioT = 22 + Math.random() * 15;
      const near = this.nearestPolice(truck.curPos);
      const msgs = [`Suspect au PK ${(truck.road.s / 1000).toFixed(1)}, ${Math.round(truck.kmh)} km/h.`, near.v ? `${near.v.name} à ${Math.round(near.d)} m du suspect.` : 'Aucune unité au contact.', 'Attention au trafic dense, prudence.', 'Hélicoptère indisponible, météo défavorable.'];
      this.radio(msgs[Math.floor(Math.random() * msgs.length)], 'pol');
    }
  }

  addSpike(s, d, w) {
    const p = this.roadPose(s, d);
    const mesh = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, 0.4), new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.6 }));
    mesh.add(base);
    for (let i = 0; i < w / 0.25; i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.15, 4), MAT.body); c.position.set(-w / 2 + i * 0.25, 0.08, 0); mesh.add(c); }
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, 0.1), new THREE.MeshBasicMaterial({ color: 0xffd020 })); stripe.position.y = 0.05; mesh.add(stripe);
    mesh.position.set(p.x, 0.04, p.z); mesh.rotation.y = p.yaw;
    this.scene.add(mesh);
    this.spikes.push({ s, d, w, mesh });
  }

  onDisabled(v) {
    if (this.state !== 'play') return;
    if (v.isPolice && v !== this.player) this.radio(`${v.name} hors service !`, 'pol');
    if (v === this.player && this.team === 'truck') this.hud.msg('Votre camion est hors d’usage !', 'red');
  }
  onTrafficCrash(car) {
    if (this.state === 'play' && Math.random() < 0.35) this.radio('Accident signalé, véhicules civils impliqués.', 'pol');
  }

  finish(win, title, sub) {
    if (this.ended) return;
    this.ended = true;
    this.setState('end');
    const pl = this.player;
    $('end-title').textContent = title; $('end-sub').textContent = sub;
    $('end').className = 'screen on ' + (win ? 'win' : 'lose');
    $('end-badge').textContent = win ? 'VICTOIRE' : 'DÉFAITE';
    const el = this.lastCfg ? (DIFF[settings.difficulty].time - this.timeLeft) : 0;
    $('end-stats').innerHTML = [
      ['Temps', fmtTime(el)], ['Distance', ((pl.road.s - this.stats.start) / 1000).toFixed(2) + ' km'], ['Vitesse max', Math.round(this.stats.topSpeed) + ' km/h'],
      ['Accidents causés', this.stats.crashes], ['État du véhicule', Math.round(100 - pl.damage) + ' %'], ['Équipe', this.team === 'truck' ? 'Camion' : 'Police'],
    ].map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('');
    this.audio.beep(win ? 880 : 220, 0.6, 0.2);
    for (const p of this.police) if (p.ai) p.ai.role = 'idle';
    for (const f of this.fugitives) f.role = 'idle';
  }

  // ---------- menu / garage ----------
  toMenu() {
    this.clearMatch();
    this.hud.show(false);
    this.setState('menu');
    this.env.setTime(settings.time); this.env.setWeather(settings.weather);
    this.menuS = 150;
    for (const k of [...this.world.chunks.keys()]) this.world.unload(k);
    this.world.setRoadworks([]);
    this.world.update(this.menuS - 200, this.menuS + 300, new THREE.Vector3(0, 0, this.menuS), 0, true);
    this.traffic.populate(this.menuS);
  }
  menuCam(dt) {
    this.menuS += dt * 24;
    const t = this.time * 0.05;
    roadToWorld(this.menuS, -24 + Math.sin(t) * 6, _p);
    this.camera.position.set(_p.x, 7 + Math.sin(t * 1.3) * 2, _p.z);
    roadToWorld(this.menuS + 45, -4, _p);
    this.camera.lookAt(_p.x, 1.5, _p.z);
    this.camera.fov = 55; this.camera.updateProjectionMatrix();
    this.world.update(this.menuS - 100, this.menuS + 100, this.camera.position, 0);
    if (this.menuS > 2600) { this.menuS = 150; this.traffic.populate(this.menuS); }
  }

  openGarage(team) {
    this.clearMatch();
    this.setState('garage');
    this.garageTeam = team || settings.team;
    this.garageS = (REST_AREAS[0].s0 + REST_AREAS[0].s1) / 2 + 40;
    this.world.update(this.garageS - 100, this.garageS + 100, new THREE.Vector3(0, 0, this.garageS), 0, true);
    this.garageYaw = 0.8;
    this.showPreview(settings.vehicle[this.garageTeam]);
  }
  showPreview(id) {
    if (this.preview) this.scene.remove(this.preview);
    const def = VEHICLES[id], paint = settings.paint[id];
    const g = new THREE.Group();
    const m = def.team === 'police' ? buildPoliceCar(def, paint) : buildPlayerTruck(def, paint);
    g.add(m.group);
    if (m.lights) { m.lights.blue.emissiveIntensity = 6; m.lights.red.emissiveIntensity = 6; }
    for (const [x, z] of def.wheels) { const w = makeWheel(def.wheelR, def.team === 'truck' ? 0.38 : 0.26); w.position.set(x, def.wheelR, z); g.add(w); }
    if (def.trailer) {
      const t = buildTrailer(def); t.group.position.set(0, 0, def.trailer.kingpin); g.add(t.group);
      for (const az of def.trailer.axles) for (const sx of [1, -1]) { const w = makeWheel(0.5, 0.4); w.position.set(sx, 0.5, def.trailer.kingpin + az); g.add(w); }
    }
    const p = this.roadPose(this.garageS, -45);
    g.position.set(p.x, 0.02, p.z); g.rotation.y = p.yaw + Math.PI / 2;
    this.scene.add(g); this.preview = g; this.previewDef = def;
  }
  garageCam(dt) {
    const m = this.input.mouse;
    if (m.down) this.garageYaw -= m.dx * 0.006; else this.garageYaw += dt * 0.15;
    const def = this.previewDef, c = this.preview.position;
    const dist = def.trailer ? 26 : def.team === 'truck' ? 13 : 7.5;
    const cz = def.trailer ? -6 : 0;
    const center = _v.set(0, 0, cz).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.preview.rotation.y).add(c);
    this.camera.position.set(center.x + Math.sin(this.garageYaw) * dist, (def.team === 'truck' ? 3.2 : 1.7) + (def.trailer ? 3 : 0), center.z + Math.cos(this.garageYaw) * dist);
    this.camera.lookAt(center.x, def.team === 'truck' ? 1.8 : 0.8, center.z);
    this.camera.fov = 50; this.camera.updateProjectionMatrix();
  }

  // ---------- multijoueur ----------
  netSetup() {
    const n = this.net;
    n.on('chat', m => this.hud.msg(`💬 <b>${m.name}</b> : ${QUICK_CHAT[m.i] || ''}`));
    n.on('left', m => { const r = this.remotes.get(m.id); if (r) { r.dispose(); this.remotes.delete(m.id); } });
    n.on('close', () => { for (const r of this.remotes.values()) r.dispose(); this.remotes.clear(); });
    n.on('event', m => { if (m.e === 'busted' && this.state === 'play') this.hud.msg('🚨 Un camion a été interpellé !', 'pol'); });
  }
  updateRemotes(dt) {
    if (!this.net.room) return;
    for (const [id, p] of this.net.players) {
      if (id === this.net.id || !p.state) continue;
      let r = this.remotes.get(id);
      if (!r || r.vid !== p.state.id) { if (r) r.dispose(); r = new RemoteCar(this, p); this.remotes.set(id, r); }
      r.team = p.team; r.apply(p.state, dt);
    }
  }
  onlineRules(dt) {
    const pl = this.player;
    if (this.team !== 'truck') return;
    let close = false;
    for (const r of this.remotes.values()) if (r.team === 'police' && r.curPos.distanceTo(pl.curPos) < 15) close = true;
    if (close && pl.kmh < 14) this.bust = Math.min(1, this.bust + dt / 3.2); else this.bust = Math.max(0, this.bust - dt / 5);
    if (this.bust >= 1) { this.net.send({ t: 'event', e: 'busted' }); this.finish(false, 'Interpellé !', 'Un joueur de la police vous a immobilisé.'); }
    const rd = pl.road;
    if (rd.s > DEST.s0 && rd.s < DEST.s1 && rd.d < DEST.d0 + 2 && rd.d > DEST.d1) { this.net.send({ t: 'event', e: 'delivered' }); this.finish(true, 'Livraison réussie !', 'Vous avez atteint la Plateforme Logistique.'); }
  }
}

// Véhicule d'un autre joueur (affichage interpolé + corps cinématique pour les collisions)
class RemoteCar {
  constructor(game, p) {
    const s = p.state, def = VEHICLES[s.id] || VEHICLES.sedan;
    this.game = game; this.vid = s.id; this.def = def; this.name = p.name; this.team = p.team;
    const m = def.team === 'police' ? buildPoliceCar(def) : buildPlayerTruck(def);
    this.model = m; this.mesh = new THREE.Group(); this.mesh.add(m.group);
    for (const [x, z] of def.wheels) { const w = makeWheel(def.wheelR); w.position.set(x, def.wheelR, z); this.mesh.add(w); }
    game.scene.add(this.mesh);
    const R = game.R;
    this.body = game.phys.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
    game.phys.createCollider(R.ColliderDesc.cuboid(def.w / 2, def.h / 2, def.len / 2).setTranslation(0, def.h / 2, 0), this.body);
    if (def.trailer) { const t = buildTrailer(def); this.tmesh = t.group; game.scene.add(this.tmesh); }
    this.curPos = new THREE.Vector3(); this.target = new THREE.Vector3(); this.q = new THREE.Quaternion(); this.tq = new THREE.Quaternion(); this.siren = false; this.lightT = 0;
  }
  apply(s, dt) {
    this.target.set(s.p[0], s.p[1], s.p[2]); this.tq.set(...s.q);
    // extrapolation légère avec la vitesse
    this.target.x += s.v[0] * 0.05; this.target.z += s.v[2] * 0.05;
    if (this.curPos.distanceTo(this.target) > 30) this.curPos.copy(this.target); else this.curPos.lerp(this.target, Math.min(1, dt * 12));
    this.q.slerp(this.tq, Math.min(1, dt * 12));
    this.siren = !!s.sir;
    const y = this.curPos.y - (this.def.wheelR + 0.25);
    this.body.setNextKinematicTranslation({ x: this.curPos.x, y, z: this.curPos.z });
    this.body.setNextKinematicRotation({ x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w });
    if (this.tmesh && s.tp) { this.tmesh.position.set(s.tp[0], s.tp[1] - 1, s.tp[2]); this.tmesh.quaternion.set(...s.tq); }
    this.pos = this.curPos;
  }
  render() {
    this.mesh.position.set(this.curPos.x, this.curPos.y - (this.def.wheelR + 0.25), this.curPos.z); this.mesh.quaternion.copy(this.q);
    if (this.model.lights) { this.lightT += 1 / 60; const ph = (this.lightT * 2.6) % 1; this.model.lights.blue.emissiveIntensity = this.siren && ph < 0.3 ? 9 : 0.15; this.model.lights.red.emissiveIntensity = this.siren && ph > 0.5 && ph < 0.8 ? 9 : 0.15; }
  }
  dispose() { this.game.scene.remove(this.mesh); if (this.tmesh) this.game.scene.remove(this.tmesh); this.game.phys.removeRigidBody(this.body); this.game.audio.updateSiren(this, false); }
}
