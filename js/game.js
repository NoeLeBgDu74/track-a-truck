// Boucle de jeu, règles de poursuite, coop, cinématique, menus, garage, mode libre, multijoueur
import * as THREE from 'three';
import {
  VEHICLES, TEAM_VEHICLES, PAINTS, settings, saveSettings, laneD, SHOULDER_D, roadToWorld, roadYaw, worldToRoad, DEST, DEST_S,
  inTunnel, clamp, rng, fmtTime, REST_AREAS, EXIT_GAP, TUNNELS, MISSIONS, profile, saveProfile, ACHIEVEMENTS, VILLAGE, D77, EXIT15, YARD_END, YARD_START,
} from './config.js';
import { Voice } from './voice.js';
import { World } from './world.js';
import { Vehicle } from './vehicle.js';
import { Traffic } from './traffic.js';
import { AIDriver, assignTactics } from './ai.js';
import { Env } from './env.js';
import { Glows, Particles } from './fx.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { CameraRig, CAM_NAMES } from './camera.js';
import { HUD } from './hud.js';
import { Net, QUICK_CHAT } from './net.js';
import { Coop, ACTIONS, GAGS } from './coop.js';
import { Mini } from './minigame.js';
import { Listener, understand } from './speech.js';
import { Admin } from './admin.js';
import { Services } from './services.js';
import { Works } from './works.js';
import { Talk } from './talk.js';
import { Toll } from './toll.js';
import { Brain, directorTick, copilotReply, copilotBanter, refillLines, pickLine } from './brain.js';
import { Cinematic, storyShots } from './cine.js';
import { Showroom } from './showroom.js';
import { buildPoliceCar, buildPlayerTruck, buildTrailer, makeWheel, buildPerson, buildSeated, initMaterials, MAT } from './models.js';

const $ = id => document.getElementById(id);
const DT = 1 / 60;
const _v = new THREE.Vector3(), _p = { x: 0, z: 0 };
const DIFF = { easy: { police: 2, speed: 150, skill: 0.7, block: false, time: 420 }, normal: { police: 3, speed: 170, skill: 1, block: true, time: 360 }, hard: { police: 5, speed: 195, skill: 1.25, block: true, time: 330 } };
let UID = 1;

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
    this.admin = new Admin(this); this.services = new Services(this); this.works = new Works(this); this.talk = new Talk(this); this.toll = new Toll(this);
    this.glows = new Glows(this.scene); this.particles = new Particles(this.scene);
    this.audio = new Audio(); this.input = new Input(); this.camRig = new CameraRig(camera); this.hud = new HUD(); this.net = new Net();
    this.cine = new Cinematic(this);
    this.vehicles = []; this.police = []; this.fugitives = []; this.spikes = []; this.bananas = []; this.remotes = new Map();
    this.player = null; this.person = null; this.state = 'menu'; this.mode = 'chase'; this.team = settings.team;
    this.time = 0; this.acc = 0; this.menuS = 120; this.bust = 0; this.stats = { crashes: 0, topSpeed: 0, dist: 0 };
    this.mirror = false; this.coop = null; this.confuseT = 0; this.said = {}; this.heat = 0; this.slow = 0; this.slowCd = 0; this.cartons = []; this.cheeses = [];
    this.heli = this.buildHeli();
    this.world.gamePlayer = () => this.player;
    this.env.onChange = w => this.state === 'play' && this.hud.toast({ clear: '☀ Le ciel se dégage', rain: '🌧 Il commence à pleuvoir', fog: '🌫 Le brouillard tombe', storm: '⛈ Un orage éclate !' }[w]);
    this.bayMark = this.buildBayMark();
    this.lightsSetup();
    this.applyQuality();
    this.env.setTime(settings.time); this.env.setWeather(settings.weather);
    this.showroom = new Showroom(renderer);
    this.netSetup();
  }

  // ---------- utilitaires ----------
  dynVehicles() { return this.vehicles; }
  trafficObs() { if (this._obsT !== this.time) { this._obs = this.traffic.buildObstacles(); this._obsT = this.time; } return this._obs; }
  roadPose(s, d) { roadToWorld(s, d, _p); return { x: _p.x, z: _p.z, yaw: roadYaw(s) }; }
  toRoad(x, z) { return worldToRoad(x, z, {}); }
  targetTruck() { return this.fugitives[0]?.v || (this.team === 'truck' ? this.player : null); }
  nearestPolice(pos) {
    let best = { d: 1e9, v: null };
    for (const p of this.police) { if (p.v === this.player) continue; const d = p.v.curPos.distanceTo(pos); if (d < best.d) best = { d, v: p.v }; }
    for (const r of this.remotes.values()) if (r.team === 'police') { const d = r.curPos.distanceTo(pos); if (d < best.d) best = { d, v: r }; }
    return best;
  }
  // message radio contextuel avec délai minimum entre deux répétitions
  say(key, text, cd = 25, kind = 'pol') { if ((this.said[key] || -99) > this.time - cd) return; this.said[key] = this.time; this.radio(text, kind); }

  lightsSetup() {
    this.spots = [0, 1].map(() => { const s = new THREE.SpotLight(0xfff2dd, 0, 90, 0.42, 0.55, 1.4); this.scene.add(s, s.target); return s; });
    this.flashLights = [new THREE.PointLight(0x2060ff, 0, 30, 1.6), new THREE.PointLight(0xff2020, 0, 30, 1.6)];
    this.flashLights.forEach(l => this.scene.add(l));
    this.cabLight = new THREE.PointLight(0xffe2b8, 0, 3.2, 1.5); this.scene.add(this.cabLight);
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
  rival() { let best = null; for (const r of this.remotes.values()) { const d = this.player ? r.curPos.distanceTo(this.player.curPos) : 0; if (!best || d < best.d) best = { r, d }; } return best; }

  clearMatch() {
    for (const v of this.vehicles) v.dispose();
    this.vehicles = []; this.police = []; this.fugitives = []; this.spikes.forEach(s => this.scene.remove(s.mesh)); this.spikes = [];
    this.bananas.forEach(b => this.scene.remove(b.mesh)); this.bananas = [];
    this.cartons?.forEach(c => { this.scene.remove(c.mesh); this.phys.removeRigidBody(c.body); }); this.cartons = []; this.netTraffic = false; this.duel = null; this.netBustT = undefined; this.fugGad = null; this.slicks?.forEach(sl => this.scene.remove(sl.mesh)); this.slicks = []; this.smokeT = null; this.parkInfo = null; this.parkHint = false; this.lotT = 0; if (this.bayMark) this.bayMark.visible = false;
    this.mirrorProps?.forEach(m => this.scene.remove(m)); this.mirrorProps = []; this.bubbleList?.forEach(b => this.scene.remove(b.sp)); this.bubbleList = []; this.heliTarget = null; this.heliT = 0;
    if (this.heli) { this.heli.visible = false; this.heliOn = false; this.heliSpot.intensity = 0; } this.audio.rotor?.(0); this.slow = 0; document.body.classList.remove('slowmo'); this.allies = []; this.mission = null; Voice.stop();
    if (this.person) this.leaveFoot(true);
    this.player = null; this.bust = 0; this.audio.stopAllSirens?.(); this.audio.music?.('off'); this.audio.buzz?.(false);
    if (this.preview) { this.scene.remove(this.preview); this.preview = null; }
    this.coop = null; this.coopAI = null; this.crew = null; this.crewV = null; this.mirror = false; this.guardSent = false; this.confuseT = 0; this.said = {}; this.score = 0; this.combo = 0;
    this.cine.on && this.cine.finish();
    this.listen?.stop(); this.crewAnim = [null, null]; this.noHands = 0; this.aiCmd = null; this.brainT = 4; this.banterT = 40; this.iaSpike = false;
    document.body.classList.remove('coop');
    this.hud.unhook?.();
  }

  start(cfg) {
    document.querySelectorAll('.screen.on').forEach(e => e.classList.remove('on')); // aucun menu ne reste affiché (bug multi)
    this.audio.init();
    this.clearMatch();
    Object.assign(this, { mode: cfg.mode, team: cfg.mode === 'coop' ? 'truck' : cfg.team });
    const M = this.mission = cfg.mission ? MISSIONS.find(m => m.id === cfg.mission) : null;
    const diff = this.diff = DIFF[M ? M.diff : settings.difficulty] || DIFF.normal;
    this.env.setTime(M ? M.time : (cfg.time || settings.time)); this.env.setWeather(M ? M.weather : (cfg.weather || settings.weather));
    this.seed = cfg.seed ?? (Math.random() * 1e6 | 0);
    const r = rng(this.seed);
    const works = [];
    works.push({ s0: 1150 + r() * 400, dir: 1, lane: r() < 0.5 ? 0 : 2 });
    works.push({ s0: 4150 + r() * 350, dir: 1, lane: r() < 0.5 ? 0 : 2 });
    works.push({ s0: 2950 + r() * 300, dir: -1, lane: 2 }); // après la gare de péage (PK 2,7)
    works.push({ s0: 6500 + r() * 300, dir: 1, lane: 2 });
    works.forEach(w => w.s1 = w.s0 + 220 + r() * 140);
    this.world.targetBay = Math.floor(r() * YARD_END.bays.length);
    for (const k of [...this.world.chunks.keys()]) this.world.unload(k);
    this.world.setRoadworks(works);
    this.lastCfg = cfg; this.parkT = 0;
    this.time = 0; this.timeLeft = (M?.limit ?? diff.time) + (cfg.mode === 'coop' ? 120 : 0); this.timeTotal = this.timeLeft;
    this.heat = (M?.heat || 0) * 20; this.cargo = 100; this.allies = []; this.playerArrived = false; this.nextBlock = 75; this.heliOn = false; this.heliT = 0; this.headStart = this.team === 'truck' ? 15 : 10; this.released = false;
    this.stats = { crashes: 0, topSpeed: 0, dist: 0, start: 0, busts: 0 };
    this.nextReinforce = 55; this.blockDone = !diff.block && !(M?.heat >= 3); this.ended = false; this.radioT = 18; this.tacticT = 0;
    document.getElementById('convoy-board')?.remove();
    this.patrol = null; this.arrest = null; this.check = null; if (this.checkMesh) { this.scene.remove(this.checkMesh); this.checkMesh = null; }
    (this.officers || []).forEach(o => this.scene.remove(o.grp)); this.officers = [];
    (this.riders || []).forEach(r => this.scene.remove(r.piv)); this.riders = [];
    this.services?.clear(); this.works?.clear(); this.toll?.clear();
    this.unitN = 1; this.score = 0; this.combo = 0; this.comboT = 0;

    if (cfg.mirror) return this.startMirror(cfg);

    const vid = cfg.mode === 'coop' ? (cfg.vehicle || settings.vehicle.truck) : (cfg.vehicle || settings.vehicle[cfg.team]);
    const paint = settings.paint[vid];
    let ps = 0, pd = laneD(1, 2);
    if (this.team === 'police' && cfg.mode === 'chase') { ps = -90; pd = SHOULDER_D(1); }
    if (cfg.mode === 'free') ps = 40;
    const fromYard = this.team === 'truck' && (cfg.mode === 'chase' || cfg.mode === 'coop');
    if (fromYard) { ps = -385; pd = -62; } // départ dans la cour du dépôt MégaCorp
    if (cfg.mode === 'online') { const k = [...this.net.players.keys(), this.net.id].sort().indexOf(this.net.id); ps = (cfg.team === 'police' ? -90 : 0) - k * 14; pd = laneD(1, k % 3); }
    this.stats.start = ps;
    this.world.update(ps - 300, ps + 600, new THREE.Vector3(0, 0, ps), 0, true);
    const pose = this.roadPose(ps, pd);
    this.player = this.addVehicle(vid, ps, pd, { paint, interior: true });
    this.camRig.mode = 'chase'; this.camRig.pos.set(pose.x, 6, pose.z - 20);

    this.convoy = !!cfg.convoy;
    if (cfg.mode === 'chase' || cfg.mode === 'coop' || this.convoy) {
      if (this.team === 'truck') {
        // contrôle routier obligatoire : la police attend sur la bande d'arrêt d'urgence, la poursuite démarre au contrôle
        this.check = { s: 650, state: 'wait', t: 0, said: 0 };
        this.headStart = 1e9;
        this.buildCheckpoint(this.check.s);
        const n = Math.max(2, Math.min(3, diff.police));
        for (let i = 0; i < n; i++) { const ai = this.addPolice(this.check.s + 14 + i * 16, SHOULDER_D(1) + 0.4, 'idle'); ai.v.siren = false; ai.v.checkLights = true; }
      } else {
        const tid = ['semi', 'flatbed', 'delivery'][Math.floor(r() * 3)];
        const fv = this.addVehicle(tid, 30, laneD(1, 1), { ai: true, name: 'Suspect' });
        const ai = new AIDriver(this, fv, 'flee'); ai.lane = 1; this.fugitives.push(ai);
        this.police.push({ v: this.player, ai: null });
        this.addPolice(-120, laneD(1, 0), 'idle');
      }
    }
    if (M?.obj === 'convoy') {
      for (const [id, ds] of [['flatbed', -34], ['delivery', -62]]) {
        const v = this.addVehicle(id, ps + ds, pd + 4, { ai: true, name: id === 'flatbed' ? 'Plateau de Dédé' : 'Porteur de Jojo' });
        const ai = new AIDriver(this, v, 'flee'); ai.lane = 1; ai.useBis = false; this.allies.push({ v, ai, status: 'run', bust: 0 });
      }
    }
    if (cfg.mode === 'coop') {
      const local = cfg.coop || 'solo';
      const names = local === 'online' ? [this.net.me.name, ([...this.net.players.values()][0]?.name) || 'Gégé'] : ['Marcel', 'Gégé'];
      this.coop = new Coop(this, { names, humans: local === 'solo' ? [true, false] : [true, true], online: local === 'online' });
      this.coopKind = local;
      this.coopAI = new AIDriver(this, this.player, 'flee');
      this.makeCrew(this.player);
      document.body.classList.add('coop');
      this.startVoiceChat();
      if (local === 'online') this.hookNetHud();
    }
    this.netTraffic = cfg.mode === 'online' && !this.net.host;
    this.duel = cfg.mode === 'online' ? (this.team === 'truck' ? { oil: 2, nails: 2, smoke: 1 } : { spike: 2, mega: 0 }) : null;
    if (this.netTraffic) this.traffic.clear(); else this.traffic.populate(ps + 200);
    // pannes sur la BAU (le camion qui roule sur la bande d'arrêt d'urgence doit les éviter)
    if (cfg.mode !== 'online' && !cfg.mirror) for (let i = 0; i < 3; i++) {
      const bs = 900 + r() * 6000; if (TUNNELS.some(([a, b]) => bs > a - 50 && bs < b + 50) || (bs > EXIT15[0] - 100 && bs < EXIT15[1] + 50) || (bs > EXIT_GAP[0] - 100) || REST_AREAS.some(ra => bs > ra.s0 - 80 && bs < ra.s1 + 80)) continue;
      const car = this.traffic.spawn(bs, 1, 2, { v: 0 }); car.broken = true; car.v0 = 0; car.lane = 3; car.d = SHOULDER_D(1) + 0.3; car.hazard = 1e9;
      this.traffic.kinematics(car, 0); car.prev.copy(car.cur);
      const tri = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.05, 3), new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff2020, emissiveIntensity: 0.6 }));
      const tp = this.roadPose(bs - 30, SHOULDER_D(1)); tri.position.set(tp.x, 0.35, tp.z); tri.rotation.set(Math.PI / 2, 0, tp.yaw); this.scene.add(tri); this.spikes.push({ s: -1e9, d: 0, w: 0, mesh: tri });
      const guy = buildPerson(0xf5a020); const gp = this.roadPose(bs + 3, SHOULDER_D(1) - 2.2); guy.position.set(gp.x, 0, gp.z); guy.rotation.y = gp.yaw + 2; this.scene.add(guy); this.spikes.push({ s: -1e9, d: 0, w: 0, mesh: guy });
    }
    for (const c of this.traffic.cars) if (Math.abs(c.s - ps) < 70) this.traffic.remove(c);
    this.traffic.cars = this.traffic.cars.filter(c => !c.dead);

    this.player.headlights = this.env.night > 0.4;
    this.hud.setRole(this.team, cfg.mode === 'coop' ? 'chase' : cfg.mode);
    this.hud.show(true);
    this.player.input = { throttle: 0, brake: 0, steer: 0, handbrake: true };
    const story = (cfg.mode === 'chase' || cfg.mode === 'coop') && cfg.cine !== false;
    if (story) {
      this.setState('cine');
      if (this.coop && this.coopKind === 'online') this.net.send({ t: 'cine' });
      this.cine.play(storyShots(this, cfg.mode === 'coop' ? 'coop' : this.team, this.coop?.names), () => this.beginCountdown());
    } else this.beginCountdown();
  }

  beginCountdown() {
    this.setState('countdown'); this.countdown = 3.5;
    const cfg = this.lastCfg;
    if (cfg.mode === 'chase' || cfg.mode === 'coop') {
      if (this.team === 'truck') this.radio('Central : un camion suspect vient de quitter le dépôt. Patrouilles en alerte.', 'pol');
      else this.radio('Central : suspect à bord d’un poids lourd, direction Lyon. Interceptez-le avant la sortie 18.', 'pol');
    } else if (cfg.mode === 'free') this.hud.msg('Mode libre : roulez sans objectif. <b>Échap</b> pour le menu.');
    else if (this.convoy) this.hud.msg('🚛🚛 <b>Convoi</b> : chacun son camion ! Passe le contrôle routier, sème la police et livre la plateforme <b>avant les autres</b>. Radio CB : <kbd>V</kbd>. Gadgets : huile, clous, fumigène.');
    else if (cfg.mode === 'online') this.hud.msg(this.team === 'truck' ? '🚛 <b>Duel</b> : livre la Plateforme Logistique (sortie 18) avant la fin du chrono. Gadgets : <b>9</b> huile ×2, <b>0</b> clous ×2, <b>G</b> fumigène ×1.' : '🚔 <b>Duel</b> : immobilise le camion (moins de 14 km/h à ton contact). <b>9</b> herse ×2 (pose-la devant lui !), <b>0</b> mégaphone, <b>G</b> sirène.');
    if (this.coop) this.coopMsg(this.coopKind === 'solo'
      ? `🚛 Tu es <b>${this.coop.names[0]}</b>, ${this.coop.names[1]} (IA) est ton copilote. <b>Tab</b> = relais : il conduit et c’est toi qui gères la cabine (touches 1-7).`
      : this.coopKind === 'local' ? '🚛 Coop sur ce PC : un joueur conduit au clavier (ZQSD), l’autre gère la cabine à la souris (ou touches 1-7). <b>Tab</b> = relais.'
        : '🚛 Coop en ligne : le conducteur conduit, le copilote gère la cabine (1-7). <b>Tab</b> = relais. <b>V</b> = parler à la radio CB.');
  }

  addVehicle(id, s, d, opts = {}) {
    const p = this.roadPose(s, d);
    const v = new Vehicle(this, id, { x: p.x, z: p.z, yaw: p.yaw, ...opts });
    v.uid = opts.uid ?? UID++;
    this.vehicles.push(v);
    return v;
  }
  addPolice(s, d, role) {
    const ids = ['sedan', 'suv', 'wagon'], moto = (this.wanted || 0) >= 4 && role === 'chase' && Math.random() < 0.55;
    const v = this.addVehicle(moto ? 'moto' : ids[this.unitN % 3], s, d, { ai: true, name: (moto ? 'Motard ' : 'Unité ') + this.unitN });
    v.unit = this.unitN++;
    const ai = new AIDriver(this, v, role, { target: this.targetTruck(), skill: this.diff.skill, speedCap: this.diff.speed });
    ai.lane = Math.floor(Math.random() * 3);
    this.police.push({ v, ai });
    v.siren = role !== 'idle';
    return ai;
  }

  radio(text, kind = '') { this.hud.msg('📻 ' + text, kind); this.audio.radio?.(); if (kind === 'pol') Voice.say(text, { pitch: 0.75, rate: 1.18, voice: 1 }); }
  coopMsg(text, kind = '') { this.hud.msg(text, kind); if (/«|»|:/.test(text)) Voice.say(text.replace(/^.*?(«|:)/, ''), { pitch: 1.15, rate: 1.15, voice: 0 }); }

  setState(s) {
    this.state = s;
    document.body.dataset.state = s;
    $('pause').classList.toggle('on', s === 'pause');
  }

  // ---------- boucle ----------
  frame(dt) {
    this.frameN = (this.frameN || 0) + 1;
    dt = Math.min(dt, 0.1) * (this.timeScale || 1);
    this.admin.step(dt);
    this.slowCd = Math.max(0, this.slowCd - dt);
    if (this.slow > 0) { this.slow -= dt; dt *= 0.3; if (this.slow <= 0) document.body.classList.remove('slowmo'); }
    const inp = this.input;
    if ((inp.hit('Escape') || inp.hit('KeyP')) && !this.cine.on) {
      if (this.state === 'play' || this.state === 'countdown') { this.prevState = this.state; this.setState('pause'); }
      else if (this.state === 'pause') this.setState(this.prevState || 'play');
    }
    // radio CB : V pour parler
    if (this.net.stream) this.net.setPTT(inp.down('KeyV'));
    if (this.mirror) { this.renderScene = null; this.renderCamera = null; return this.mirrorFrame(dt); }
    if (this.state === 'menu') { // écran d'accueil : salle d'exposition dédiée (pas la partie)
      this.time += dt; this.showroom.update(dt);
      this.renderScene = this.showroom.scene; this.renderCamera = this.showroom.camera;
      inp.endFrame(); return;
    }
    this.renderScene = null; this.renderCamera = null;

    if (this.state !== 'pause') {
      this.acc += dt;
      let n = 0;
      while (this.acc >= DT && n < 4) { this.fixed(DT); this.acc -= DT; n++; }
      if (n === 4) this.acc = 0;
    }
    const alpha = this.acc / DT;
    this.renderWorld(alpha, dt);
    inp.endFrame();
  }

  renderWorld(alpha, dt) {
    const inp = this.input;
    for (const v of this.vehicles) v.render(alpha, this.time);
    this.traffic.render(alpha);
    const inCab = this.player && !this.person && (this.camRig.mode === 'cockpit' || (this.coop && this.coopMyRole() === 'cop'));
    for (const v of this.vehicles) if (v.interior) v.interior.update(dt, this, v === this.player && (inCab || v.curPos.distanceToSquared(this.camera.position) < 400));
    if (this.cabLight) { const on = inCab && ['play', 'countdown', 'end'].includes(this.state); this.cabLight.intensity = on ? 0.6 + this.env.night * 1.4 + this.env.tunnel * 0.6 : 0; if (on) this.cabLight.position.copy(_v.set(0, this.player.cabPos.y + 0.35, this.player.cabPos.z + 0.2).applyQuaternion(this.player.quat).add(this.player.pos)); }
    for (const r of this.remotes.values()) r.render?.();
    for (const b of this.bananas) b.mesh.rotation.y += dt * 2;
    if (this.person) { this.person.mesh.position.copy(this.person.pos); this.person.mesh.rotation.y = this.person.yaw; }

    // caméra
    if (this.cine.on) this.cine.update(dt, inp);
    else if (this.slow > 0 && this.player) {
      const v = this.player, a = this.slowA + (2.4 - this.slow) * 0.5, c = v.trailer ? v.trailer.pos.clone().lerp(v.pos, 0.6) : v.pos;
      this.camera.position.set(c.x + Math.sin(a) * 16, c.y + 6 + (2.4 - this.slow) * 2, c.z + Math.cos(a) * 16); this.camera.lookAt(c.x, c.y + 1.5, c.z);
      this.camera.fov = 45; this.camera.updateProjectionMatrix();
    }
    else if (this.state === 'menu') this.menuCam(dt);
    else if (this.state === 'garage') this.garageCam(dt);
    else {
      const copCam = this.coop && this.player && this.coopMyRole() === 'cop' && ['play', 'countdown', 'end'].includes(this.state);
      if (copCam) {
        this.camRig.updateCopilot(dt, this.player, inp, this.coop.roof);
        if (this.coop.roof && inp.mouse.clicked && document.pointerLockElement) this.coopAct('throw');
        if (inp.mouse.clicked && !document.pointerLockElement) { try { const r = $('c').requestPointerLock?.(); r?.catch?.(() => { }); } catch (e) { } }
      } else {
        if (document.pointerLockElement && this.coop) document.exitPointerLock?.();
        if (inp.hit('KeyC') && this.player && !this.person) this.hud.toast(CAM_NAMES[this.camRig.cycle()]);
        this.camRig.lookBack = inp.down('KeyX');
        this.camRig.update(dt, this.player, inp, this.person);
        if (this.arrest?.truck) { const A = this.arrest, c = A.truck.curPos; A.angle += dt * 0.18; const r = 16, a = A.truck.yaw + 0.9 + A.angle; this.camera.position.set(c.x + Math.sin(a) * r, 5.5, c.z + Math.cos(a) * r); this.camera.lookAt(c.x, 1.5, c.z); }
      }
      if (this.coop) { this.coopCamFx(dt); this.updateCrew(dt, copCam); }
    }
    const camPos = this.camera.position;
    const camRoad = worldToRoad(camPos.x, camPos.z, {});
    const tun = inTunnel(camRoad.s) && Math.abs(camRoad.d) < 17 && camPos.y < 8;
    this.env.tunnel += ((tun ? 1 : 0) - this.env.tunnel) * Math.min(1, dt * 3);
    const focus = this.player ? this.player.pos : (this.person ? this.person.pos : camPos);
    this.env.update(dt, focus, camPos, tun, this.audio);
    this.world.setWet(this.env.wet); this.world.setNight(Math.max(this.env.night, 0));
    if (this.world.beam) this.world.beam.material.opacity = 0.08 + 0.06 * Math.sin(this.time * 3);
    if (this.mirror) this.world.update(this.player ? this.player.road.s : camRoad.s, this.player ? this.player.road.s : camRoad.s, camPos, dt);

    // feux & halos
    const night = this.env.night > 0.45 || this.env.tunnel > 0.5 || this.env.fogAmt > 0.6;
    const list = [];
    if (this.env.night > 0.3) this.world.lampGlows(camPos, list);
    for (const v of this.vehicles) { if (v.ai) v.headlights = night || this.env.rainAmt > 0.5; v.lightPoints(list); }
    this.traffic.lightPoints(list, night || this.env.rainAmt > 0.6, camPos);
    this.services.lightPoints(list); this.works.lightPoints(list);
    if (this.state !== 'menu') { this.works.step(dt); this.toll.step(dt); }
    this.talk.step();
    this.glows.set(list, this.env.night > 0.3 || this.env.tunnel > 0.3 ? 1 : 0.55);
    this.updateLights();
    this.particles.points.material.uniforms.light.value = Math.max(0.12, 1 - this.env.night * 0.85) * (1 - this.env.tunnel * 0.4);
    this.particles.update(dt);

    // audio
    const pv = this.person ? null : this.player;
    const playing = ['play', 'countdown', 'cine'].includes(this.state);
    this.audio.updatePlayer(playing ? pv : null, dt, { cockpit: this.camRig.mode === 'cockpit', wet: this.env.wet, rain: this.env.rainAmt, tunnel: this.env.tunnel, trafficNear: this.traffic.near(camPos, 60).n });
    const fwd = _v.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.audio.setListener(camPos, fwd);
    const tkY = this.targetTruck?.();
    for (const p of this.police) { p.v.yelp = tkY && p.v !== tkY && p.v.curPos.distanceToSquared(tkY.curPos) < 60 * 60; this.audio.updateSiren(p.v, p.v.siren && !p.v.disabled && this.state !== 'menu', p.v === this.player); }
    for (const r of this.remotes.values()) this.audio.updateSiren(r, r.siren);

    if (['play', 'countdown', 'end'].includes(this.state)) this.hud.update(this);
    if (this.coop) this.coop.render();
    // rétroviseurs réels quand on est dans la cabine
    const pv2 = this.player;
    if (pv2?.interior && !this.person && (this.camRig.mode === 'cockpit' || (this.coop && this.coopMyRole() === 'cop')) && ['play', 'countdown', 'end'].includes(this.state)) { this.mirFrame = (this.mirFrame || 0) + 1; if (settings.quality === 'high' || (settings.quality === 'medium' && this.mirFrame % 2 === 0)) pv2.interior.renderMirrors(this.renderer, this.scene); }
  }


  // ---------- voix dans la cabine : micro ouvert obligatoire + compréhension de la parole ----------
  myIdx() { return this.mirror ? 1 : 0; }
  async startVoiceChat() {
    this.crewAnim = [null, null];
    const n = this.net; n.open = true;
    const ok = await n.enableVoice();
    if (!ok) this.hud.msg('🎙️ <b>Micro obligatoire</b> pour parler dans la cabine : autorise le micro (icône 🔒 de la barre d’adresse) puis relance.', 'red');
    else { n.applyMic(); n.voiceSync(); if (this.coopKind === 'online') this.hud.toast('🎙️ Micro ouvert : vous vous entendez dans la cabine'); }
    this.listen = new Listener(t => this.handleSpeech(this.coopKind === 'local' ? this.coop?.driver ?? 0 : this.myIdx(), t, true));
    if (this.listen.ok && settings.voiceCmd) { this.listen.start(); this.hud.msg('🗣️ Commandes vocales actives : dis « sans les mains », « attention », « klaxonne », « un sandwich », « relais », « à gauche »… ton routier réagit.'); }
  }
  handleSpeech(idx, text, local) {
    const c = this.coop; if (!c || !text) return;
    const intents = understand(text), me = c.chars[idx], other = c.chars[1 - idx], drv = idx === c.driver;
    if (local && !intents.length) { const n = this.talk.candidates()[0]; if (n && n.d < 30) { this.talk.heard(text); return; } } // phrase pour un PNJ proche
    this.hud.msg(`🗣️ <b>${me.name}</b> : « ${text} »`, 'speech');
    if (local && this.coopKind === 'online') this.net.send({ t: 'speech', idx, text });
    const anim = (i, type, dur = 2.5) => this.crewAnim[i] = { type, t: 0, dur };
    const reply = (line) => { if ((!c.humans[1 - idx] || this.coopKind === 'local') && !(Brain.enabled() && !this.mirror)) this.coopMsg(`${other.name} : « ${line} »`); };
    const act = (id) => { if (!this.mirror) c.action(id, 'voice'); };
    const aiOther = !c.humans[1 - idx] || this.coopKind === 'local';
    if (aiOther && Brain.enabled() && !this.mirror) {
      copilotReply(this, text, me.name, other.name).then(r => {
        if (!r || !this.coop) { if (!intents.length) { anim(1 - idx, 'shrug', 1.6); reply('Hein ? J’ai rien compris.'); } return; }
        if (r.reponse) { this.coopMsg(`${other.name} : « ${String(r.reponse).slice(0, 160)} »`); }
        if (r.geste && r.geste !== 'aucun') anim(1 - idx, r.geste, 2.5);
        const a = String(r.action || 'aucune'); if (a !== 'aucune' && !intents.length) { try { c.action(a, 'voice'); } catch (e) { } }
      });
      if (!intents.length) return;
    }
    if (!intents.length) { anim(1 - idx, 'shrug', 1.6); if (Math.random() < 0.35) reply(['Hein ? J’ai rien compris.', 'Quoi ? Répète, y a le moteur.', 'Ouais… ouais… si tu le dis.', 'C’est toi qui vois.'][Math.floor(Math.random() * 4)]); return; }
    const i0 = intents[0];
    for (const it of intents.slice(0, 2)) switch (it) {
      case 'nohands': anim(idx, 'nohands', 3); if (drv && !this.mirror) { this.noHands = 3; if (this.player.kmh > 80) this.unlock('nohands'); } reply(drv ? 'NON MAIS T’ES MALADE ?! REPRENDS LE VOLANT !' : 'Bravo… et moi je fais quoi, j’applaudis ?'); if (drv) anim(1 - idx, 'scared', 3); break;
      case 'scared': anim(0, 'scared', 2.2); anim(1, 'scared', 2.2); if (!this.mirror && !c.humans[c.driver]) this.aiCmd = { brake: 1.8 }; if (i0 === it) reply(['AAAAH !', 'QUOI ?! OÙ ÇA ?!', 'Je freine, je freine !'][Math.floor(Math.random() * 3)]); break;
      case 'faster': anim(idx, 'point', 1.5); if (!this.mirror && !c.humans[c.driver]) this.aiCmd = { faster: 6 }; reply('Accroche-toi à ton sandwich !'); break;
      case 'slower': if (!this.mirror && !c.humans[c.driver]) this.aiCmd = { slower: 6 }; reply('Ok, ok, je lève le pied.'); break;
      case 'left': case 'right': anim(idx, it === 'left' ? 'pointL' : 'pointR', 1.8); if (!this.mirror && !c.humans[c.driver] && this.coopAI) { this.coopAI.lane = Math.max(0, Math.min(3, this.coopAI.lane + (it === 'left' ? -1 : 1))); this.coopAI.laneT = 4; } break;
      case 'horn': if (!this.mirror && this.player) { this.player.hornStuck = 1; setTimeout(() => this.player && (this.player.hornStuck = c.gag?.id === 'horn' ? 1 : 0), 600); } anim(c.driver, 'thumbs', 1); break;
      case 'radio': act('radio'); anim(idx, 'dance', 3); break;
      case 'sing': anim(idx, 'dance', 4); this.audio.sing?.(); me.moral = Math.min(100, me.moral + 10); break;
      case 'dance': anim(0, 'dance', 4); anim(1, 'dance', 4); break;
      case 'eat': act('sandwich'); anim(1 - idx, 'thumbs', 1.5); break;
      case 'coffee': act('coffee'); break;
      case 'wake': act('slap'); break;
      case 'banana': act(c.roof ? 'throw' : 'banana'); anim(1 - c.driver, 'throw', 1.2); break;
      case 'swap': act('swap'); break;
      case 'lights': if (!this.mirror && this.player) this.player.headlights = !this.player.headlights; break;
      case 'wipers': if (!this.mirror && this.player) this.player.wiping = !this.player.wiping; break;
      case 'hello': anim(idx, 'wave', 2); anim(1 - idx, 'wave', 2); reply(['Salut l’ami !', 'Yo !', 'Bien le bonjour !'][Math.floor(Math.random() * 3)]); break;
      case 'thanks': anim(1 - idx, 'thumbs', 2); reply('Merci ! On forme une sacrée équipe.'); other.moral = Math.min(100, other.moral + 8); break;
      case 'insult': anim(1 - idx, 'offended', 3); reply(['Pardon ?! Je te signale que c’est moi qui ai les sandwichs.', 'Je boude. Officiellement.', 'Répète un peu pour voir ?'][Math.floor(Math.random() * 3)]); other.moral = Math.max(0, other.moral - 10); break;
      case 'police': anim(0, 'lookback', 2); anim(1, 'lookback', 2); reply(this.nearestPolice(this.player.curPos).d < 200 ? 'Ils sont juste derrière ! Fonce !' : 'Je les vois pas… pour l’instant.'); break;
      case 'look': anim(1 - idx, 'lookL', 2); reply('Où ça ? Ah ouais, joli.'); break;
      case 'laugh': anim(0, 'laugh', 2); anim(1, 'laugh', 2); break;
      case 'cheese': reply('Le fromage va bien. Il sent toujours autant.'); break;
      case 'where': { const left = Math.max(0, DEST_S - this.player.road.s); reply(left > 50 ? `Encore ${(left / 1000).toFixed(1)} kilomètres, et il nous reste ${fmtTime(this.timeLeft)}.` : 'On y est presque !'); break; }
      case 'sleep': anim(idx, 'sleep', 3); reply(drv ? 'TU DORS PAS AU VOLANT !' : 'Fais de beaux rêves…'); break;
    }
  }

  // ---------- équipage visible dans la cabine (coop) ----------
  makeCrew(v) {
    if (!v) return;
    this.crew?.forEach(c => c.group.parent?.remove(c.group));
    this.crew = [buildSeated(0x3a5a8a, 0xd8462b), buildSeated(0x6b7b3a, 0x1f5fa8)];
    for (const c of this.crew) { v.mesh.add(c.group); c.seatX = 0; c.pos = new THREE.Vector3(); }
    this.crewV = v;
  }
  updateCrew(dt, copCam) {
    const v = this.crewV, c = this.coop; if (!v || !this.crew || !c) return;
    const def = v.def, t = this.time, baseY = def.cab.y - v.bodyY - 0.75, z = def.cab.z - 0.05;
    const myRole = this.coopMyRole(), cockpit = this.camRig.mode === 'cockpit' && !copCam;
    this.crew.forEach((m, i) => {
      const isDrv = i === c.driver, ch = c.chars[i];
      const wantX = isDrv ? def.cab.x : -def.cab.x;
      // relais à la volée : les deux routiers s'enjambent
      m.seatX += (wantX - m.seatX) * Math.min(1, dt * (c.swapT > 0 ? 2.5 : 8));
      const crossing = Math.abs(m.seatX - wantX) > 0.08;
      m.group.position.set(m.seatX, baseY + (crossing ? 0.25 + Math.sin(t * 12) * 0.05 : 0), z);
      const H = m.head.rotation, L = m.armL.rotation, R = m.armR.rotation;
      H.set(0, 0, 0); L.set(0, 0, 0); R.set(0, 0, 0);
      if (isDrv) {
        L.x = R.x = -1.15; L.z = 0.25 + v.steer * 0.5; R.z = -0.25 + v.steer * 0.5;
        if (ch.asleep > 0) { H.x = 0.75; H.z = 0.35; L.x = R.x = -0.2; }
        else if (ch.micro > 0) { H.x = 0.35 + Math.sin(t * 6) * 0.25; }
        const g = c.gag?.id;
        if (g === 'bee') { L.x = -2.4 + Math.sin(t * 22) * 0.8; R.x = -2.2 + Math.cos(t * 19) * 0.8; H.y = Math.sin(t * 9) * 0.6; }
        if (g === 'phone') { L.x = -2.6; L.z = 0.9; H.z = 0.25; }
        if (g === 'sing') { H.x = -0.2 + Math.sin(t * 10) * 0.15; H.z = Math.sin(t * 5) * 0.2; }
        if (g === 'sneeze' && c.gag.t < 0.5) H.x = 0.6;
        if (g === 'stink') { R.x = -2.8; R.z = 0.4; }
        if (g === 'hiccup') m.group.position.y += Math.max(0, Math.sin(t * 5)) * 0.04;
        if (ch.envie > 85) m.group.position.x += Math.sin(t * 14) * 0.03;
        if (crossing) { L.x = R.x = -2.5; }
      } else {
        // copilote : regarde autour, s'agite quand il prépare quelque chose
        H.y = Math.sin(t * 0.4 + i) * 0.5; H.x = Math.sin(t * 0.3) * 0.1;
        if (c.prep) { L.x = -1.3 + Math.sin(t * 8) * 0.3; R.x = -1.1 + Math.cos(t * 7) * 0.3; H.x = 0.4; }
        if (c.drv.asleep > 0) { R.x = -1.5; R.z = -1.2 + Math.sin(t * 15) * 0.4; H.y = 0.8; }
      }
      // réactions déclenchées par la voix
      const A = this.crewAnim?.[i];
      if (A) {
        A.t += dt; const k = A.t;
        switch (A.type) {
          case 'nohands': L.x = R.x = -2.95; L.z = 0.35; R.z = -0.35; H.x = -0.25; break;
          case 'scared': L.x = R.x = -2.5; L.z = 0.7; R.z = -0.7; H.x = -0.3; m.group.position.x += Math.sin(t * 40) * 0.015; break;
          case 'wave': R.x = -2.8; R.z = -0.3 + Math.sin(t * 12) * 0.5; break;
          case 'thumbs': R.x = -1.7; R.z = -0.2; H.x = 0.1; break;
          case 'dance': L.x = -1.5 + Math.sin(t * 9) * 1.2; R.x = -1.5 - Math.sin(t * 9) * 1.2; H.z = Math.sin(t * 9) * 0.3; m.group.position.y += Math.abs(Math.sin(t * 9)) * 0.04; break;
          case 'pointL': L.x = -1.5; L.z = 1.3; H.y = 0.6; break;
          case 'pointR': R.x = -1.5; R.z = -1.3; H.y = -0.6; break;
          case 'point': R.x = -1.6; H.x = -0.1; break;
          case 'shrug': L.x = R.x = -0.6; L.z = 0.8; R.z = -0.8; H.z = 0.2; break;
          case 'laugh': H.x = -0.3 + Math.sin(t * 20) * 0.15; break;
          case 'lookback': H.y = isDrv ? 1.3 : -1.6; break;
          case 'lookL': H.y = 0.9; break;
          case 'offended': H.y = (m.seatX > 0 ? 1 : -1) * 0.9; L.x = R.x = -1.3; L.z = -0.6; R.z = 0.6; break;
          case 'throw': R.x = -2.8 + Math.min(1, k * 3) * 1.8; break;
          case 'sleep': H.x = 0.7; break;
        }
        if (A.t > A.dur) this.crewAnim[i] = null;
      }
      // la bouche bouge quand le joueur parle (micro) ou quand l'IA parle
      let lv = 0;
      if (this.coopKind === 'online') lv = i === this.myIdx() ? this.net.myLevel() : Math.max(0, ...[...this.net.calls.keys()].map(id => this.net.peerLevel(id)));
      else if (i === 0 || this.coopKind === 'local') lv = this.net.myLevel() * (this.coopKind === 'local' ? (isDrv ? 1 : 0) : 1);
      if (!c.humans[i] && window.speechSynthesis?.speaking) lv = 0.5 + Math.sin(t * 22) * 0.5;
      m.mouthLv = Math.max(lv, (m.mouthLv || 0) * 0.8);
      if (m.mouth) m.mouth.scale.y = 0.6 + m.mouthLv * 4 * (0.6 + Math.abs(Math.sin(t * 17)) * 0.4);
      // ne pas voir l'intérieur de sa propre tête
      const mine = (copCam && !isDrv && (myRole === 'cop')) || (cockpit && isDrv && myRole !== 'cop');
      m.head.visible = !mine;
      m.group.visible = this.camRig.mode !== 'free' || true;
    });
  }

  coopCamFx(dt) {
    const c = this.coop, d = c.drv, cam = this.camera, t = this.time;
    let sway = 0;
    if (d.faim > 75) sway += (d.faim - 75) / 25 * 0.03;
    if (c.gag?.id === 'stink') sway += 0.02;
    if (c.swapT > 0) sway += 0.08;
    if (sway) { cam.rotation.z += Math.sin(t * 1.7) * sway; cam.position.y += Math.sin(t * 2.3) * sway * 3; }
  }

  fixed(dt) {
    this.time += dt;
    const inp = this.input, pl = this.player;
    if (this.state === 'countdown') {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const now = Math.ceil(this.countdown);
      if (now !== before && now > 0) { this.hud.big(String(now)); this.audio.beep(660, 0.15); }
      if (this.countdown <= 0) {
        this.setState('play'); this.hud.big('GO !', 'go'); this.audio.beep(1320, 0.35);
        let seen = false; try { seen = localStorage.getItem('tat_tuto') === '1'; localStorage.setItem('tat_tuto', '1'); } catch (e) { }
        if (!seen && !this.mirror) ['🎮 <b>Z Q S D</b> (ou flèches) pour conduire, <b>Espace</b> frein à main.', '🎥 <b>C</b> change de caméra : essaie la vue <b>cabine</b> !', '🧭 Suis le GPS en bas à droite et la flèche verte de la carte.', '🚔 Sous 14 km/h au contact de la police pendant 3 s = arrestation. Ne t’arrête pas !', '🛣️ Astuce : la <b>sortie 15</b> mène à la D77, un itinéraire bis plus calme.'].forEach((t, i) => setTimeout(() => this.state === 'play' && this.hud.msg(t), 2500 + i * 4500));
        if (this.mode === 'chase' && this.team === 'police') this.hud.msg(`Le suspect a <b>${this.headStart} s</b> d'avance — attendez le feu vert de la centrale.`);
        if (this.team === 'truck' && (this.mode === 'chase' || this.mode === 'coop')) this.hud.msg(this.check ? '🚧 Un <b>contrôle routier</b> t’attend juste après le dépôt. Arrête-toi sur la bande d’arrêt d’urgence… et prie pour qu’ils n’ouvrent pas la remorque.' : `Vous avez <b>${this.headStart} s</b> d'avance avant le départ de la police. Foncez !`);
        this.time = 0;
      }
    }
    // commandes joueur
    if (pl && !this.person) {
      const lockedPolice = this.state !== 'play' || !!this.arrest || (this.mode === 'chase' && this.team === 'police' && this.time < this.headStart);
      let input;
      if (this.state === 'play' && !lockedPolice) {
        if (this.coop) input = this.coopDriverInput(dt);
        else input = inp.drive();
      } else if (this.state === 'countdown' || this.state === 'cine' || lockedPolice) input = { throttle: 0, brake: 0, steer: this.state === 'cine' ? 0 : inp.drive().steer, handbrake: true };
      if (this.state === 'end' || !input) input = { throttle: 0, brake: pl.kmh > 3 && !pl.reverse ? 1 : 0, steer: 0, handbrake: true };
      pl.input = input;
      if (this.state === 'play' && this.keyFrame !== this.frameN) { this.keyFrame = this.frameN; this.playerKeys(pl); } // une seule lecture des touches par image (sinon double bascule)
    } else if (this.person) this.footStep(dt);

    // IA
    this.tacticT -= dt;
    if (this.tacticT <= 0 && this.released) { this.tacticT = 1.5; assignTactics(this, this.targetTruck()); }
    this.confuseT = Math.max(0, this.confuseT - dt);
    for (const p of this.police) if (p.ai) { if (p.ai.frozen) { p.v.input = { throttle: 0, brake: 1, steer: 0, handbrake: true }; continue; } p.ai.target = this.targetTruck(); p.ai.update(dt); }
    for (const f of this.fugitives) { if (this.state !== 'play') f.v.input = { throttle: 0, brake: 0, steer: 0, handbrake: true }; else f.update(dt); }
    for (const a of this.allies) { if (this.state !== 'play' || a.status !== 'run') { a.v.input = { throttle: 0, brake: a.v.kmh > 2 ? 1 : 0, steer: 0, handbrake: true }; } else a.ai.update(dt); }

    const env = { wet: this.env.wet };
    for (const v of this.vehicles) v.step(dt, env);
    const focusS = this.state === 'garage' ? this.garageS : pl ? pl.road.s : (this.person ? this.toRoad(this.person.pos.x, this.person.pos.z).s : this.menuS);
    let tFocus = focusS; if (this.mode === 'online' && this.net.host && pl) { const rv = this.rival(); if (rv) { const rs = worldToRoad(rv.r.curPos.x, rv.r.curPos.z, {}).s; if (Math.abs(rs - focusS) < 1600) tFocus = (rs + focusS) / 2; } }
    this.traffic.step(dt, tFocus, this.env.wet);
    this.services.step(dt);
    if (this.coop && this.state === 'play' && pl && pl.coopPush) { /* poussée gérée dans coopDriverInput */ }
    this.phys.step();
    for (const v of this.vehicles) v.postStep(dt);
    this.updateRemotes(dt);

    let mn = focusS, mx = focusS;
    for (const v of this.vehicles) if (Math.abs(v.road.s - focusS) < 1500) { mn = Math.min(mn, v.road.s); mx = Math.max(mx, v.road.s); }
    this.world.update(mn, mx, this.camera.position, dt);

    for (const v of this.vehicles) {
      if (v.impact > 1.6) {
        const near = v.curPos.distanceTo(this.camera.position);
        if (near < 150) this.audio.crash(v.curPos, v.impact);
        if (v === pl) this.camRig.shake = Math.min(1.5, v.impact * 0.15);
        for (let i = 0; i < Math.min(14, v.impact * 2); i++) this.particles.emit(v.curPos.x + (Math.random() - 0.5) * 2, v.curPos.y + 0.5, v.curPos.z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 8, Math.random() * 5, (Math.random() - 0.5) * 8, 0.4, 0.12, 0, 0xffb040, 1);
      }
      this.vehicleFx(v, dt);
      if (v.impact > 2 && this.state === 'play') this.onImpact(v);
    }
    for (const sp of this.spikes) for (const v of this.vehicles) {
      if (v.team !== 'truck' || v.spikes > 0) continue;
      if (Math.abs(v.road.s - sp.s) < 2.5 && Math.abs(v.road.d - sp.d) < sp.w / 2 + 1) {
        v.spikes = 1; this.audio.crash(v.curPos, 3);
        if (v === pl) this.hud.msg('💥 <b>Herse !</b> Pneus crevés : vitesse et adhérence réduites.', 'red');
        else this.radio('Le suspect a roulé sur la herse !', 'pol');
      }
    }
    this.bananaStep(dt); this.propsStep(dt); this.heliStep(dt); this.bubblesStep(dt); this.updateBayMark(); this.gadgetsStep(dt);
    if (this.coop && (this.state === 'play')) this.coop.update(dt, pl);
    if (this.state === 'play') { this.rules(dt); this.nearMiss(dt); this.brainStep(dt); }
    if (pl) {
      this.stats.topSpeed = Math.max(this.stats.topSpeed, pl.kmh);
      if (this.state === 'play' && pl.road.d < -120 && pl.road.s > VILLAGE.s0 && pl.road.s < VILLAGE.s1) this.unlock('bis');
      // radars automatiques (tous les 2 km, sens +s) : flash au-delà de 135 km/h
      const rs = Math.round((pl.road.s - 1000) / 2000) * 2000 + 1000;
      if (this.state === 'play' && pl.road.d < 0 && pl.road.d > -16 && Math.abs(pl.road.s - rs) < 3 && this.lastRadar !== rs) {
        this.lastRadar = rs;
        if (pl.kmh > 135) { this.flashN = (this.flashN || 0) + 1; const f = document.getElementById('flash'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); this.audio.beep(2400, 0.05, 0.1); this.hud.msg(`📸 Flashé à <b>${Math.round(pl.kmh)} km/h</b> (limite 130).` + (this.team === 'truck' && this.mode !== 'free' ? ' La police est prévenue.' : '')); if (this.team === 'truck' && this.mode !== 'free') this.heat += 4; }
      }
      // « pschitt » des freins à air quand le poids lourd s'immobilise
      if (pl.team === 'truck') { if (pl.kmh > 8) this.airArm = true; if (this.airArm && pl.kmh < 1.5 && pl.brk > 0.1) { this.airArm = false; this.audio.hiss?.(); } }
    }
    if (this.coop && this.coopKind === 'online') this.sendSnapshot(dt);
    else if (this.mode === 'online') {
      this.net.tick(dt, this.person ? null : pl);
      if (this.net.host && this.net.connected) { this.trafT = (this.trafT || 0) - dt; if (this.trafT <= 0) { this.trafT = 1 / 7.5; this.net.send({ t: 'traf', tr: this.traffic.snapshot() }); } }
    }
  }

  // ---------- coop ----------
  coopMyRole() {
    if (!this.coop) return null;
    if (this.coopKind === 'local') return 'both';
    if (this.coopKind === 'solo') return this.coop.driver === 0 ? 'drv' : 'cop';
    const me = this.mirror ? 1 : 0;
    return this.coop.driver === me ? 'drv' : 'cop';
  }
  coopDriverInput(dt) {
    const c = this.coop, pl = this.player;
    let base;
    if (this.coopKind === 'solo' && c.driver === 1) { this.coopAI.update(dt); base = { ...pl.input }; }
    else if (this.coopKind === 'online' && c.driver === 1) base = this.remoteInput || { throttle: 0, brake: 0, steer: 0, handbrake: false };
    else base = this.input.drive();
    if (this.aiCmd && this.coopKind === 'solo' && c.driver === 1) {
      const a = this.aiCmd; if (a.brake > 0) { base.throttle = 0; base.brake = 1; a.brake -= dt; } else if (a.faster > 0) { base.throttle = 1; base.brake = 0; a.faster -= dt; } else if (a.slower > 0) { base.throttle = Math.min(base.throttle, 0.2); a.slower -= dt; } else this.aiCmd = null;
    }
    if (this.noHands > 0) { this.noHands -= dt; base.steer = Math.sin(this.time * 0.9) * 0.12; }
    const o = c.modify(base, dt, this.time);
    if (c.fuel <= 0) { // le copilote pousse le camion…
      o.throttle = 0;
      if (o.brake < 0.1 && pl.kmh < 7) { const f = pl.forward; pl.body.applyImpulse({ x: f.x * pl.mass * 0.9 * dt, y: 0, z: f.z * pl.mass * 0.9 * dt }, true); }
    }
    return o;
  }
  coopPad() {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    const gp = pads[1] || (this.coopMyRole() === 'cop' ? pads[0] : null); if (!gp) return;
    const map = { 0: 'sandwich', 1: 'coffee', 2: 'slap', 3: 'radio', 4: 'banana', 5: 'cb', 6: 'oil', 7: 'nails', 8: 'swap', 9: 'roof', 10: 'smoke' };
    this.padPrev ||= [];
    gp.buttons.forEach((b, i) => { if (b.pressed && !this.padPrev[i]) { if (Mini.on) Mini.pad(); else if (map[i]) this.coopAct(map[i]); } });
    this.padPrev = gp.buttons.map(b => b.pressed);
  }
  coopKeys() {
    const inp = this.input, role = this.coopMyRole();
    this.coopPad();
    if (Mini.on) { if (inp.hit('Space') || inp.hit('Enter') || ACTIONS.some(a => inp.hit('Digit' + a.k))) Mini.pad(); return; }
    if (inp.hit('Tab')) this.coopAct('swap');
    if (role === 'drv' && this.coopKind === 'online') return; // en ligne, seul le copilote gère la cabine
    ACTIONS.forEach(a => { if (inp.hit(a.code || 'Digit' + a.k) || inp.hit('Numpad' + a.k)) this.coopAct(a.id); });
  }
  coopAct(id, skipMini) {
    if (!this.coop) return;
    // mini-jeu pour le copilote humain local (pas pour l'IA)
    const role = this.coopMyRole(), c = this.coop;
    if (!skipMini && (role === 'cop' || role === 'both') && !Mini.on) {
      let type = null;
      if (id === 'slap') type = (c.drv.asleep > 0 || c.drv.micro > 0) ? 'mash' : (c.gag && GAGS[c.gag.id]?.fix === 'slap' ? (GAGS[c.gag.id].game || 'mash') : null);
      if (id === 'sandwich' && c.sandwiches > 0 && !c.prep) type = 'sandwich';
      if (type) { Mini.play(type, () => this.coopAct(id, true), () => this.hud.toast('Raté ! Réessaie (touche ' + (id === 'slap' ? '3' : '1') + ')')); return; }
    }
    if (this.mirror) { this.net.send({ t: 'act', a: id }); return; }
    if (this.state !== 'play') return;
    this.coop.action(id);
  }
  onCoopSwap() {
    if (this.coopKind === 'solo') this.hud.big(this.coop.driver === 0 ? 'À TOI DE CONDUIRE' : 'GÉGÉ CONDUIT', '');
    else this.hud.big(`${this.coop.drv.name.toUpperCase()} CONDUIT`, '');
    if (this.coopKind === 'online') this.net.send({ t: 'big', h: `${this.coop.drv.name.toUpperCase()} CONDUIT` });
  }
  dropBanana(v) {
    const back = v.trailer ? _v.set(0, 0, -v.def.trailer.len + 0.5).applyQuaternion(v.trailer.curQuat).add(v.trailer.curPos) : _v.set(0, 0, -v.def.len / 2 - 1).applyQuaternion(v.curQuat).add(v.curPos);
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.12, 6, 12, Math.PI * 1.3), new THREE.MeshStandardMaterial({ color: 0xffd21a, roughness: 0.6, emissive: 0x332800 }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(back.x + (Math.random() - 0.5) * 1.5, 0.1, back.z);
    this.scene.add(mesh);
    this.bananas.push({ mesh, t: 0, owner: v });
  }
  bananaStep(dt) {
    for (const b of this.bananas) {
      b.t += dt;
      for (const v of this.vehicles) {
        if (v === b.owner && b.t < 1.5) continue;
        if (v.oil > 0) continue;
        const dx = v.curPos.x - b.mesh.position.x, dz = v.curPos.z - b.mesh.position.z;
        if (dx * dx + dz * dz < 2.2 * 2.2) {
          v.oil = 2.2; b.dead = true; if (v.isPolice && v !== this.player) this.unlock('banana');
          v.body.applyTorqueImpulse({ x: 0, y: (Math.random() < 0.5 ? -1 : 1) * v.mass * 1.8, z: 0 }, true);
          this.audio.slap?.();
          if (v.isPolice && v !== this.player) this.say('banana' + v.unit, `${v.name} : « J’AI GLISSÉ SUR UNE BANANE ?! Qui fait ça ?! » 🍌`, 3);
          else if (v === this.player) this.hud.msg('🍌 Tu as roulé sur ta propre banane. Bravo.', 'red');
        }
      }
      if (b.t > 90) b.dead = true;
    }
    this.bananas = this.bananas.filter(b => { if (b.dead) this.scene.remove(b.mesh); return !b.dead; });
  }
  confusePolice(t) {
    this.confuseT = t;
    setTimeout(() => this.state === 'play' && this.say('confuse', 'Unité 2 : « Euh… Central ? On fait quoi ? Il est où le tracteur tondeuse ? »', 5), 2500);
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
    const canDrive = !this.coop || this.coopMyRole() !== 'cop' || this.coopKind === 'local';
    if (canDrive) {
      if (inp.hit('KeyL')) { v.headlights = !v.headlights; this.hud.toast(v.headlights ? 'Phares allumés' : 'Phares éteints'); }
      if (inp.hit('KeyG') && v.isPolice) { v.siren = !v.siren; this.hud.toast(v.siren ? 'Gyrophares + sirène' : 'Sirène coupée'); }
      if (inp.hit('KeyQ')) { v.blink = v.blink === 1 ? 0 : 1; v.blinkT = 0; }
      if (inp.hit('KeyE')) { if (v.isPolice && !this.blinkHint) { this.blinkHint = 1; this.hud.toast('Sirène : touche G (E = clignotant droit)'); } v.blink = v.blink === 2 ? 0 : 2; v.blinkT = 0; }
      if (inp.hit('KeyN')) v.blink = v.blink === 3 ? 0 : 3;
      if (v.blink && v.blink !== 3) { v.blinkT += DT; if (Math.abs(v.steer) > 0.08) v.blinkSteered = true; if ((v.blinkSteered && Math.abs(v.steer) < 0.02) || v.blinkT > 12) { v.blink = 0; v.blinkSteered = false; } }
      if (v.blink) { const ph = (performance.now() % 760) < 380; if (ph !== this._bph) { this._bph = ph; this.audio.tick?.(); } }
      if (v.manual) {
        if (inp.hit('ShiftLeft') || inp.hit('ShiftRight')) { v.mGear = Math.min(v.def.gears, v.mGear + 1); this.hud.toast('Rapport ' + v.mGear); }
        if (inp.hit('ControlLeft') || inp.hit('ControlRight')) { v.mGear = Math.max(1, v.mGear - 1); this.hud.toast('Rapport ' + v.mGear); }
      }
      if (inp.hit('KeyB')) { v.wiping = !v.wiping; this.hud.toast(v.wiping ? 'Essuie-glaces' : 'Essuie-glaces arrêtés'); }
      if (!this.net.stream && inp.hit('KeyV')) { v.wiping = !v.wiping; this.hud.toast(v.wiping ? 'Essuie-glaces' : 'Essuie-glaces arrêtés'); }
      v.horn = inp.down('KeyH') || v.hornStuck > 0;
      if (inp.hit('KeyR')) this.respawn(v);
      if (inp.hit('KeyF') && v.kmh < 8 && !this.coop) this.enterFoot(v);
    }
    if (this.env.rainAmt > 0.4 && !v._autoWipe) { v.wiping = true; v._autoWipe = true; }
    if (v.flipT > 3) { this.respawn(v); this.hud.msg('Véhicule remis sur la route.'); }
    if (inp.hit('KeyM')) { this.hud.mapZoom = this.hud.mapZoom > 0.5 ? 0.25 : this.hud.mapZoom > 0.3 ? 1.1 : 0.55; this.hud.toast('Zoom carte'); }
    if (this.coop) this.coopKeys();
    else if (this.duel && this.state === 'play') this.duelKeys(v);
    else for (let i = 0; i < 6; i++) if (inp.hit('Digit' + (i + 1)) && this.net.room) this.net.chat(i);
  }

  // ---------- duel en ligne : gadgets du camion, herse et mégaphone de la police ----------
  duelKeys(v) {
    const inp = this.input, D = this.duel;
    if (this.team === 'truck') {
      for (const [code, k] of [['Digit9', 'oil'], ['Digit0', 'nails'], ['KeyG', 'smoke']]) if (inp.hit(code)) {
        if (D[k] <= 0) { this.hud.toast('Plus de ' + { oil: 'd’huile', nails: 'clous', smoke: 'fumigène' }[k]); continue; }
        D[k]--; this.dropGadget(k, v);
        const back = this.slicks?.[this.slicks.length - 1];
        this.net.send({ t: 'gadget', k, x: +(back?.x ?? v.curPos.x).toFixed(1), z: +(back?.z ?? v.curPos.z).toFixed(1), yaw: +v.yaw.toFixed(2) });
        this.hud.toast({ oil: '🛢️ Huile versée !', nails: '📌 Clous semés !', smoke: '💨 Fumigène !' }[k] + ` (reste ${D[k]})`);
      }
    } else {
      if (inp.hit('Digit9')) {
        if (D.spike <= 0) this.hud.toast('Plus de herse');
        else { D.spike--; const s = v.road.s - v.def.len, d = v.road.d; this.addSpike(s, d, 7); this.net.send({ t: 'spike', s: +s.toFixed(1), d: +d.toFixed(1), w: 7 }); this.hud.toast(`🦔 Herse posée derrière toi (reste ${D.spike})`); }
      }
      if (inp.hit('Digit0') && this.time > (D.mega || 0)) { D.mega = this.time + 12; const l = ['Police ! Arrêtez immédiatement le véhicule !', 'Rangez-vous sur la droite !', 'Vous êtes cerné, arrêtez-vous !'][Math.floor(Math.random() * 3)]; this.net.send({ t: 'mega', l, name: this.net.me.name }); this.hud.msg('📢 ' + l); Voice.say(l, { pitch: 0.8, rate: 1.1, prio: true }); }
    }
  }

  respawn(v) {
    const lane = clamp(Math.round((Math.abs(v.road.d) - 3) / 3.6), 0, 2);
    v.resetOnRoad(v.road.s, laneD(1, lane));
    if (this.mode === 'chase' || this.mode === 'coop') { this.timeLeft -= 5; this.hud.toast('Repositionnement (−5 s)'); }
  }

  // ---------- IA (modèle de langage) : directeur des PNJ et de la police, copilote bavard ----------
  brainStep(dt) {
    this.officersStep(dt); this.ridersStep(dt);
    if (this.mirror || this.netTraffic || !Brain.enabled()) return;
    this.brainT = (this.brainT ?? 4) - dt;
    this.linesT = (this.linesT ?? 1) - dt;
    if (this.linesT <= 0 && !Brain.busy) { this.linesT = Brain.wantLines ? 20 : 50; Brain.wantLines = false; refillLines(this); }
    else if (this.brainT <= 0 && !Brain.busy) { this.brainT = 16; directorTick(this); }
    if (this.coop && this.coopKind === 'solo') {
      this.banterT = (this.banterT ?? 40) - dt;
      if (this.banterT <= 0) { this.banterT = 45 + Math.random() * 30; copilotBanter(this).then(r => { if (r?.remarque && this.state === 'play' && this.coop) { this.coopMsg(`${this.coop.cop.name} : « ${String(r.remarque).slice(0, 120)} »`); this.crewAnim[1 - this.coop.driver] = { type: 'laugh', t: 0, dur: 1.5 }; } }); }
    }
  }

  // ---------- gendarmes à pied (barrages, véhicule HS) ----------
  addOfficer(s, d, yawOff, mode, life) { const p = this.roadPose(s, d); const o = this.addPerson(p.x, p.z, p.yaw + yawOff, mode, life); o.s = s; o.d = d; return o; }
  addPerson(x, z, yaw, mode, life, civil) {
    const M = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 }), uni = M(civil ? civil.pants : 0x1d2f5a), skin = M(0xe0b090), refl = civil ? M(civil.top) : new THREE.MeshStandardMaterial({ color: 0xd8e030, emissive: 0x303000, roughness: 0.6 });
    const grp = new THREE.Group(), body = new THREE.Group(); grp.add(body);
    const bx = (m, w, h, dd, x, y, z, par = body) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), m); o.position.set(x, y, z); o.castShadow = true; par.add(o); return o; };
    const legs = [-1, 1].map(sx => { const l = new THREE.Group(); l.position.set(sx * 0.11, 0.85, 0); bx(uni, 0.15, 0.85, 0.18, 0, -0.42, 0, l); body.add(l); return l; });
    bx(refl, 0.46, 0.62, 0.26, 0, 1.18, 0); bx(skin, 0.22, 0.25, 0.22, 0, 1.64, 0); bx(uni, 0.27, 0.08, 0.3, 0, 1.8, 0.02);
    const arms = [-1, 1].map(sx => { const a = new THREE.Group(); a.position.set(sx * 0.3, 1.45, 0); bx(uni, 0.11, 0.6, 0.11, 0, -0.28, 0, a); body.add(a); return a; });
    if (civil) { body.children.forEach(c => { if (c.position.y > 1.75) c.visible = false; }); arms.forEach(a => a.children[0].material = refl); }
    grp.position.set(x, 0, z); grp.rotation.y = yaw;
    this.scene.add(grp);
    const o = { grp, body, arms, legs, mode, t: 0, life, dive: 0 }; (this.officers ||= []).push(o); return o;
  }
  officersStep(dt) {
    if (!this.officers?.length) return;
    const tk = this.targetTruck?.();
    for (const o of this.officers) {
      o.t += dt; const [L, R] = o.arms, t = o.t;
      if (o.mode === 'block') {
        R.rotation.x = -1.4; L.rotation.x = -1.2 + Math.sin(t * 2) * 0.05; // en joue / bras tendus
        if (tk && tk.kmh > 45) { const ds = o.s - tk.road.s; if (ds > 0 && ds < 70 && Math.abs(tk.road.d - o.d) < 7) { o.mode = 'dive'; o.dir = o.d > tk.road.d ? 1 : -1; o.jump = o.dir > 0 ? Math.max(0.8, Math.min(4.5, -1.2 - o.d)) : 4.5; this.say('dive', 'Gendarme : « Il ne s’arrête pas !! À TERRE ! »', 8); } }
      } else if (o.mode === 'dive') { // saut sur le côté, roulade
        o.dive = Math.min(1, o.dive + dt * 1.6); const pz = this.roadPose(o.s, o.d + o.dir * o.dive * o.jump);
        o.grp.position.set(pz.x, Math.sin(o.dive * Math.PI) * 0.6, pz.z); o.body.rotation.z = -o.dir * o.dive * 1.45; L.rotation.x = R.rotation.x = -2.8;
        if (o.dive >= 1) { o.mode = 'up'; o.t = 0; o.d += o.dir * o.jump; }
      } else if (o.mode === 'up') { o.body.rotation.z *= 0.96; if (t > 2) { o.mode = 'angry'; o.t = 0; } }
      else if (o.mode === 'angry') { L.rotation.x = -2.4 + Math.sin(t * 9) * 0.6; R.rotation.x = -2.2 + Math.cos(t * 8) * 0.7; o.legs[0].rotation.x = Math.sin(t * 6) * 0.15; if (t > 4) { o.mode = 'radio'; o.t = 0; } }
      else if (o.mode === 'radio') { R.rotation.x = -2.6; R.rotation.z = 0.4; L.rotation.x = 0; }
      else if (o.mode === 'aim') { R.rotation.x = -1.5; L.rotation.x = -1.45; L.rotation.z = -0.35; if (o.walk) { const k = Math.min(1, dt * 1.2 / Math.max(0.3, o.grp.position.distanceTo(o.walk))); if (k < 1) { o.grp.position.lerp(o.walk, k); o.legs[0].rotation.x = Math.sin(t * 8) * 0.5; o.legs[1].rotation.x = -Math.sin(t * 8) * 0.5; } else { o.walk = null; o.legs.forEach(l => l.rotation.x = 0); } } }
      else if (o.mode === 'hands') { L.rotation.x = R.rotation.x = Math.PI; L.rotation.z = 0.25; R.rotation.z = -0.25; if (o.walk) { o.grp.position.lerp(o.walk, Math.min(1, dt * 0.6)); o.legs[0].rotation.x = Math.sin(t * 6) * 0.35; o.legs[1].rotation.x = -Math.sin(t * 6) * 0.35; } }
      else if (o.mode === 'kneel') { L.rotation.x = R.rotation.x = Math.PI; o.body.position.y += (-0.45 - o.body.position.y) * Math.min(1, dt * 3); o.legs.forEach(l => l.rotation.x = -1.4); }
      if ((o.life -= dt) <= 0) { this.scene.remove(o.grp); o.dead = true; }
    }
    this.officers = this.officers.filter(o => !o.dead);
  }

  // ---------- motard éjecté : vol, roulade, glissade, puis allongé au sol ----------
  ejectRider(rider, vel, label) {
    if (!rider || rider.userData.ejected) return null; rider.userData.ejected = true;
    rider.updateMatrixWorld(true);
    const piv = new THREE.Group(); piv.position.copy(rider.localToWorld(new THREE.Vector3(0, 1.0, -0.2)));
    rider.getWorldQuaternion(piv.quaternion); this.scene.add(piv); piv.attach(rider);
    const v = new THREE.Vector3(vel.x, 0, vel.z), sp = v.length();
    v.multiplyScalar(0.9); v.y = 2.5 + Math.min(4, sp * 0.12);
    const axis = new THREE.Vector3(v.z, 0, -v.x).normalize(); if (!isFinite(axis.x) || axis.lengthSq() < 0.5) axis.set(1, 0, 0);
    const R = { piv, rider, vel: v, axis, w: 3 + sp * 0.35, t: 0, state: 'fly', label, cur: piv.position, mesh: piv, type: { h: -0.6 } };
    (this.riders ||= []).push(R);
    if (label) { const rr = worldToRoad(piv.position.x, piv.position.z, {}); this.services?.report({ s: rr.s, dir: rr.d < 0 ? 1 : -1, severe: false, cars: [], hurt: [R] }); }
    this.audio?.crash?.(piv.position, 5);
    return R;
  }
  ridersStep(dt) {
    if (!this.riders?.length) return;
    for (const R of this.riders) {
      R.t += dt; const p = R.piv.position, v = R.vel;
      if (R.state === 'fly' || R.state === 'slide') {
        v.y -= 9.81 * dt; p.addScaledVector(v, dt);
        R.piv.rotateOnWorldAxis(R.axis, R.w * dt);
        if (p.y < 0.28) {
          p.y = 0.28;
          if (v.y < -2) { v.y = -v.y * 0.3; R.w *= 0.7; if (R.t > 0.2) this.particles?.emit(p.x, 0.2, p.z, 0, 0.5, 0, 1, 0.4, 1, 0x9a9a8a, 0.35); } else v.y = 0;
          const k = Math.exp(-2.6 * dt); v.x *= k; v.z *= k; R.w *= Math.exp(-1.8 * dt); R.state = 'slide';
          if (Math.random() < 0.3 && Math.hypot(v.x, v.z) > 4) this.particles?.emit(p.x, 0.1, p.z, (Math.random() - 0.5), 0.3, (Math.random() - 0.5), 0.5, 0.06, 0, 0xffb040, 1);
          if (Math.hypot(v.x, v.z) < 0.6 && Math.abs(v.y) < 0.5) {
            R.state = 'lie'; R.t = 0; const e = new THREE.Euler().setFromQuaternion(R.piv.quaternion, 'YXZ');
            R.rest = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, e.y, 0.15, 'YXZ'));
          }
        }
      } else if (R.state === 'up') { // le motard se relève (assis, sonné)
        R.piv.quaternion.slerp(R.rest, Math.min(1, dt * 1.5)); p.y += (0.45 - p.y) * Math.min(1, dt * 2);
      } else if (R.state === 'lie') {
        R.piv.quaternion.slerp(R.rest, Math.min(1, dt * 3)); p.y += (0.2 - p.y) * Math.min(1, dt * 3);
        if (R.t > 2.5 && !R.said) { R.said = true; this.bubble?.(R, pickLine('moto_blesse', ['Aïe… ma jambe…', 'Mon bras ! Il m’a fauché !', 'Ma bécane…', 'Ouch… je sens plus mes doigts…'])); if (R.label) this.say('mfall' + R.label, `${R.label} : « Je suis au sol ! Moto HS ! »`, 30); }
        // bouge un bras de temps en temps (conscient)
        const arm = R.rider.children[0]; if (arm && R.t > 3) R.piv.rotation.z += Math.sin(R.t * 1.3) * 0.0015;
      }
      if (R.t > 60 && R.state === 'lie') { this.scene.remove(R.piv); R.dead = true; }
    }
    this.riders = this.riders.filter(r => !r.dead);
  }

  // ---------- convoi en ligne : classement en direct ----------
  convoyBoard(dt) {
    if ((this.cbT = (this.cbT || 0) - dt) > 0) return; this.cbT = 0.5;
    let el = document.getElementById('convoy-board');
    if (!el) { el = document.createElement('div'); el.id = 'convoy-board'; el.style.cssText = 'position:fixed;top:118px;left:12px;z-index:40;background:rgba(12,16,24,.78);border:1px solid #33435e;border-radius:10px;padding:7px 10px;font:12px system-ui;color:#e8ecf2;min-width:170px;pointer-events:none'; document.body.appendChild(el); }
    const rows = [{ n: 'Toi', s: this.player?.road.s || 0, me: true }];
    for (const [id, r] of this.remotes) { const rr = worldToRoad(r.curPos.x, r.curPos.z, {}); rows.push({ n: this.net.players.get(id)?.name || 'Joueur', s: rr.s }); }
    rows.sort((a, b) => b.s - a.s);
    el.innerHTML = '<b style="color:#ffb347">🏁 Course à la livraison</b>' + rows.map((r, i) => `<div style="${r.me ? 'color:#ffd27a;font-weight:700' : ''}">${i + 1}. ${r.n} — ${Math.max(0, (DEST_S - r.s) / 1000).toFixed(1)} km</div>`).join('');
  }

  // ---------- mode libre : contrôles de police (se ranger, contrôle, on repart… ou refus d'obtempérer) ----------
  patrolStep(dt) {
    const pl = this.player; if (!pl || this.mirror || this.team !== 'truck' || this.person) return;
    const P = this.patrol ||= { next: 70 + Math.random() * 60, flashed: 0 };
    if (this.lastFlash !== this.flashN) { this.lastFlash = this.flashN; P.flashed++; if (!P.state) P.next = Math.min(P.next, this.time + 8); }
    const cop = P.ai?.v, sayCop = (t, cd = 0) => { this.hud.msg(`👮 Gendarmerie : « ${t} »`, 'pol'); Voice.say(t, { pitch: 0.75, rate: 1.1, voice: 1 }); };
    const end = (bye) => { if (P.ai) { P.ai.role = 'cruise'; P.ai.speedCap = 125; P.v.siren = false; } if (P.officer) { this.scene.remove(P.officer.grp); this.officers = this.officers.filter(o => o !== P.officer); } if (bye) sayCop(bye); const old = P.v; setTimeout(() => { const i = this.police.findIndex(p => p.v === old); if (i >= 0 && old) { old.dispose(); this.vehicles = this.vehicles.filter(v => v !== old); this.police.splice(i, 1); } }, 25000); this.patrol = { next: this.time + 140 + Math.random() * 120, flashed: 0 }; };
    if (!P.state) {
      if (this.time < P.next || pl.road.d < -18 || pl.kmh < 30) return;
      // une patrouille arrive par l'arrière
      const ai = this.addPolice(pl.road.s - 160, laneD(1, 1), 'escort'); ai.target = pl; ai.v.siren = true; ai.v.setVelocityForward?.(Math.max(25, pl.speed + 6));
      P.ai = ai; P.v = ai.v; P.state = 'follow'; P.t = 0;
      this.radio(P.flashed ? `Patrouille : véhicule flashé à ${Math.round(this.stats.topSpeed)} km/h, on l’intercepte.` : 'Patrouille : contrôle aléatoire d’un poids lourd, on le fait ranger.', 'pol');
      return;
    }
    P.t += dt; const gap = pl.road.s - cop.road.s;
    if (P.state === 'follow') {
      if (gap < 45 && !P.told) { P.told = true; this.hud.big('RANGEZ-VOUS', 'wanted'); sayCop('Gendarmerie nationale ! Rangez-vous sur la bande d’arrêt d’urgence et arrêtez-vous !'); }
      if (P.told && pl.road.d < -9 && pl.kmh < 6) { P.state = 'stop'; P.t = 0; }
      else if (P.told && P.t > 45 || (P.told && pl.kmh > 150)) { P.state = 'refus'; P.t = 0; P.ai.role = 'chase'; this.radio('Refus d’obtempérer ! Le poids lourd ne s’arrête pas, demande de renfort !', 'pol'); this.hud.big('REFUS D’OBTEMPÉRER', 'wanted'); }
      else if (P.t > 90) end();
    } else if (P.state === 'stop') {
      if (P.t > 3 && !P.officer && cop.kmh < 2) {
        const yaw = pl.yaw, door = new THREE.Vector3(pl.curPos.x + Math.sin(yaw) * (pl.def.len / 2 - 1.2) + Math.cos(yaw) * (pl.def.w / 2 + 0.7), 0, pl.curPos.z + Math.cos(yaw) * (pl.def.len / 2 - 1.2) - Math.sin(yaw) * (pl.def.w / 2 + 0.7));
        const o = this.addPerson(cop.curPos.x + Math.cos(yaw) * 1.6, cop.curPos.z - Math.sin(yaw) * 1.6, yaw, 'aim', 999); o.mode = 'walkto'; o.walk = door; P.officer = o; P.door = door;
      }
      if (P.officer && P.officer.mode === 'walkto') { const o = P.officer, d = P.door.clone().sub(o.grp.position); d.y = 0; if (d.length() > 0.3) { o.grp.rotation.y = Math.atan2(d.x, d.z); o.grp.position.addScaledVector(d.normalize(), Math.min(d.length(), 1.4 * dt)); o.legs[0].rotation.x = Math.sin(P.t * 8) * 0.5; o.legs[1].rotation.x = -Math.sin(P.t * 8) * 0.5; } else { o.mode = 'radio'; o.grp.rotation.y = pl.yaw - Math.PI / 2; o.legs.forEach(l => l.rotation.x = 0); P.state = 'talk'; P.t = 0; P.line = 0; } }
      if (pl.kmh > 25) { P.state = 'refus'; P.t = 0; P.ai.role = 'chase'; this.radio('Il redémarre en plein contrôle ! Poursuite !', 'pol'); this.hud.big('REFUS D’OBTEMPÉRER', 'wanted'); }
    } else if (P.state === 'talk') {
      const fine = P.flashed ? 90 + (P.flashed - 1) * 45 : 0, drunk = Math.random;
      const lines = P.lines ||= (() => { const L = [[0.5, 'Bonjour monsieur, gendarmerie nationale. Permis, carte grise et lettre de voiture, s’il vous plaît.'], [5, 'Vous allez souffler dans l’éthylotest… longtemps… voilà.']];
        if (fine) L.push([10, `Vous avez été flashé au-dessus de 130. Amende de ${fine} € et je vous retire des points.`]);
        else L.push([10, Math.random() < 0.5 ? 'Tout est en ordre. Le disque du chronotachygraphe aussi. Bonne route, et prudence.' : 'C’est bon pour cette fois. Pensez à faire une pause, vous avez l’air fatigué.']);
        L.push([14, 'Vous pouvez repartir.']); return L; })();
      while (P.line < lines.length && P.t >= lines[P.line][0]) sayCop(lines[P.line++][1]);
      if (P.t > 5 && P.t < 9 && P.officer) P.officer.arms[1].rotation.x = -1.4; // tend l'éthylotest
      if (P.line >= lines.length && !P.paid) { P.paid = true; if (fine) { profile.money = Math.max(0, profile.money - fine); saveProfile(); this.hud.toast(`💸 Amende : −${fine} €`); } }
      if (pl.kmh > 25 && P.line < lines.length) { P.state = 'refus'; P.t = 0; P.ai.role = 'chase'; this.radio('Il prend la fuite pendant le contrôle ! Poursuite !', 'pol'); this.hud.big('REFUS D’OBTEMPÉRER', 'wanted'); if (P.officer) { P.officer.mode = 'angry'; P.officer.life = 20; } }
      if (P.line >= lines.length && P.t > 16) { P.officer.mode = 'walkto'; P.door = cop.curPos.clone(); P.state = 'back'; P.t = 0; }
    } else if (P.state === 'back') {
      const o = P.officer, d = P.door.clone().sub(o.grp.position); d.y = 0;
      if (d.length() > 1.2 && P.t < 12) { o.grp.rotation.y = Math.atan2(d.x, d.z); o.grp.position.addScaledVector(d.normalize(), 1.4 * dt); o.legs[0].rotation.x = Math.sin(P.t * 8) * 0.5; o.legs[1].rotation.x = -Math.sin(P.t * 8) * 0.5; }
      else end();
    } else if (P.state === 'refus') {
      const dist = cop.curPos.distanceTo(pl.curPos);
      if (dist < 14 && pl.kmh < 12) P.bust = (P.bust || 0) + dt; else P.bust = Math.max(0, (P.bust || 0) - dt * 0.5);
      if (P.bust > 3) { const f = 750; profile.money = Math.max(0, profile.money - f); saveProfile(); this.hud.big('INTERPELLÉ', 'wanted'); sayCop(`Refus d’obtempérer : ${f} € d’amende et le camion part à la fourrière… enfin, cette fois on vous laisse repartir.`); this.hud.toast(`💸 −${f} €`); end(); }
      else if (dist > 700 || P.t > 120) { this.radio('Patrouille : on l’a perdu… abandon de la poursuite.', 'pol'); this.hud.big('SEMÉ !', 'go'); end(); }
    }
  }

  // ---------- scène d'interpellation ----------
  startArrest(truck) {
    const A = this.arrest; A.truck = truck;
    for (const p of this.police) if (p.ai) { p.ai.role = 'idle'; p.v.siren = true; }
    const yaw = truck.yaw, fx = Math.sin(yaw), fz = Math.cos(yaw), lx = Math.cos(yaw), lz = -Math.sin(yaw), c = truck.curPos;
    const front = truck.def.len / 2 - 1.2;
    const at = (f, l) => new THREE.Vector3(c.x + fx * f + lx * l, 0, c.z + fz * f + lz * l);
    A.cops = [[front + 7, 3.5, front + 3.5, 2.6], [front + 8, -3, front + 4, -2.4], [front - 9, 5, front - 1, 3.2]].map(([f0, l0, f1, l1]) => { const p0 = at(f0, l0), p1 = at(f1, l1); const o = this.addPerson(p0.x, p0.z, Math.atan2(c.x + fx * front - p0.x, c.z + fz * front - p0.z), 'aim', 30); o.walk = p1; return o; });
    A.door = at(front, truck.def.w / 2 + 0.7); A.kneel = at(front, truck.def.w / 2 + 2.6);
    this.hud.big('INTERPELLATION', 'wanted'); this.audio.music?.('off');
    const sayCop = t => { this.hud.msg(`👮 Gendarmerie : « ${t} »`, 'pol'); Voice.say(t, { pitch: 0.75, rate: 1.1, voice: 1 }); };
    A.lines = [[0.3, 'GENDARMERIE ! Coupez le moteur ! Les mains sur le volant !'], [3.2, 'Sortez du véhicule. Lentement. Les mains en l’air !'], [6.2, 'À genoux ! Les mains sur la tête !'], [8.6, 'Vous êtes en état d’arrestation pour transport de marchandise illégale.']];
    A.say = sayCop; A.idx = 0; A.angle = 0;
  }
  arrestStep(dt) {
    const A = this.arrest; A.t += dt;
    while (A.idx < A.lines.length && A.t >= A.lines[A.idx][0]) A.say(A.lines[A.idx++][1]);
    const tk = A.truck, c = tk.curPos;
    if (A.t > 3.6 && !A.driver) {
      const crew = this.coop ? 2 : 1; A.driver = [];
      for (let i = 0; i < crew; i++) { const o = this.addPerson(A.door.x, A.door.z, tk.yaw - Math.PI / 2, 'hands', 30, { top: i ? 0x3a5a2a : 0x8a2a2a, pants: 0x2a3550 }); o.walk = A.kneel.clone().add(new THREE.Vector3(Math.cos(tk.yaw) * i * 1.2, 0, -Math.sin(tk.yaw) * i * 1.2)); A.driver.push(o); }
      if (this.coop) setTimeout(() => this.state === 'play' && this.coopMsg(`${this.coop.cop?.name || 'Gégé'} : « C’est lui qui conduisait ! Moi j’étais juste là pour les sandwichs ! »`), 1500);
    }
    if (A.t > 6.6 && A.driver && !A.knelt) { A.knelt = true; A.driver.forEach(o => { o.mode = 'kneel'; o.walk = null; }); }
    if (A.t > 11) { const [w, ti, su] = A.args; this.arrest = null; this.finish(w, ti, su); }
  }

  // ---------- contrôle routier de départ ----------
  buildCheckpoint(s) {
    const g = new THREE.Group(), pose = this.roadPose(s, SHOULDER_D(1) - 1.2);
    g.position.set(pose.x, 0, pose.z); g.rotation.y = pose.yaw;
    const M = (c, e) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, emissive: e || 0x000000 });
    const box = (m, w, h, d, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
    // gendarme debout, bras levé (s'anime)
    const off = new THREE.Group(); off.position.set(1.4, 0, 4); off.rotation.y = Math.PI; g.add(off);
    const uni = M(0x1d2f5a), skin = M(0xe0b090), refl = M(0xd8e030, 0x404000);
    const ob = (m, w, h, d, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; off.add(o); return o; };
    ob(uni, 0.15, 0.85, 0.18, 0.11, 0.43, 0); ob(uni, 0.15, 0.85, 0.18, -0.11, 0.43, 0);
    ob(refl, 0.46, 0.62, 0.26, 0, 1.18, 0); ob(skin, 0.22, 0.25, 0.22, 0, 1.64, 0); ob(uni, 0.27, 0.08, 0.3, 0, 1.8, 0.02);
    const arm = new THREE.Group(); arm.position.set(-0.3, 1.45, 0); off.add(arm);
    const a1 = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.62, 0.11), uni); a1.position.y = 0.28; arm.add(a1);
    const paddle = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.02, 20), M(0xffffff, 0x502020)); paddle.rotation.x = Math.PI / 2; paddle.position.y = 0.7; arm.add(paddle);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.025, 6, 20), M(0xd01010, 0x600000)); ring.position.y = 0.7; arm.add(ring);
    ob(uni, 0.11, 0.6, 0.11, 0.3, 1.15, 0);
    this.checkArm = arm;
    // panneaux d'approche + cônes en biseau sur la BAU
    const sign = (z, txt) => {
      const c = document.createElement('canvas'); c.width = 512; c.height = 256; const x = c.getContext('2d');
      x.fillStyle = '#f2c200'; x.fillRect(0, 0, 512, 256); x.strokeStyle = '#111'; x.lineWidth = 14; x.strokeRect(8, 8, 496, 240);
      x.fillStyle = '#111'; x.font = '900 64px Arial'; x.textAlign = 'center'; x.fillText('CONTRÔLE', 256, 100); x.font = '700 40px Arial'; x.fillText(txt, 256, 170); x.font = '700 30px Arial'; x.fillText('GENDARMERIE', 256, 220);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const p = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25 }));
      p.position.set(0.6, 1.9, z); p.rotation.y = Math.PI; g.add(p);
      box(M(0x888888), 0.08, 1.4, 0.08, 0.6, 0.7, z + 0.05);
    };
    sign(-260, 'À 250 m'); sign(-120, 'SERREZ À DROITE'); sign(-30, 'ARRÊT OBLIGATOIRE');
    for (let i = 0; i < 9; i++) { const c = new THREE.Mesh(this.world.coneGeo, this.world.coneMat); c.position.set(-2.4 + i * 0.28, 0, -60 + i * 6); g.add(c); }
    for (let i = 0; i < 6; i++) { const c = new THREE.Mesh(this.world.coneGeo, this.world.coneMat); c.position.set(-0.3, 0, 8 + i * 9); g.add(c); }
    this.scene.add(g); this.checkMesh = g;
  }

  checkStep(dt, truck) {
    const C = this.check, ds = truck.road.s - C.s, kmh = truck.kmh;
    if (this.checkArm) this.checkArm.rotation.z = C.state === 'wait' ? 0.25 + Math.sin(this.time * 4) * 0.35 : 0.1;
    for (const p of this.police) if (p.v.checkLights && !this.released) { p.v.siren = false; p.v.flashA = (this.time * 2.2) % 1 < 0.15; p.v.flashB = false; }
    const officer = 'Gendarme Morel';
    if (C.state === 'wait') {
      if (ds > -420 && !C.said) { C.said = 1; this.radio('Gendarmerie : contrôle routier au PK 0,6. Tous les poids lourds sur la bande d’arrêt d’urgence.', 'pol'); }
      if (ds > -260 && C.said === 1) { C.said = 2; this.hud.big('CONTRÔLE', 'wanted'); this.hud.msg('🚧 <b>Contrôle obligatoire</b> : arrête-toi à droite près du gendarme (ou force le passage…).'); }
      if (ds > -30 && ds < 22 && truck.road.d < -8 && kmh < 9) {
        C.state = 'inspect'; C.t = 0;
        this.hud.msg(`👮 ${officer} : « Bonjour monsieur. Contrôle de routine : papiers du véhicule et lettre de voiture, s’il vous plaît. »`);
        Voice.say('Bonjour monsieur. Contrôle de routine. Papiers du véhicule et lettre de voiture, s’il vous plaît.', { pitch: 0.8, rate: 1.05, voice: 1 });
      } else if (ds > 22) this.checkBreak('Refus d’obtempérer ! Le poids lourd a forcé le contrôle !');
    } else if (C.state === 'waved') {
      C.t += dt;
      if (C.t > 40) this.checkBreak('Centrale : la plaque du poids lourd est signalée ! Le gendarme s’est fait avoir, toutes les unités !');
    } else if (C.state === 'inspect') {
      C.t += dt;
      if (kmh > 12 && C.t < 7.5) return this.checkBreak('Il redémarre en plein contrôle ! Il prend la fuite !');
      if (C.t > 3.2 && C.said < 3) { C.said = 3; this.hud.msg(`👮 ${officer} : « Hmm… “Fromages industriels”, vraiment ? Ouvrez-moi la remorque, on va jeter un œil. »`); Voice.say('Hmm. Fromages industriels, vraiment ? Ouvrez-moi la remorque.', { pitch: 0.8, rate: 1.05, voice: 1 }); }
      if (C.t > 7.5 && C.said < 4) { C.said = 4; this.checkBreak('C’est illégal, tout ça ! Vous êtes en état d’arrestation ! Toutes les unités !', true); }
    }
  }

  checkBreak(line, caught) {
    const C = this.check; if (!C || C.state === 'done') return;
    C.state = 'done'; this.headStart = this.time; this.bustGrace = this.time + 6; this.heat = Math.max(this.heat || 0, caught ? 15 : 25);
    this.hud.msg(`👮 Gendarme Morel : « ${line} »`, 'pol'); Voice.say(line, { pitch: 0.8, rate: 1.2, voice: 1 });
    this.hud.big('FUYEZ !', 'wanted'); this.audio.beep?.(880, 0.3);
    for (const p of this.police) p.v.checkLights = false;
    if (this.coop) this.coopMsg?.(`${this.coop.cop?.name || 'Gégé'} : « Démarre ! DÉMARRE ! »`);
  }

  // ---------- succès ----------
  unlock(id) {
    if (this.mirror || this.mode === 'online' || profile.ach[id]) return;
    const a = ACHIEVEMENTS.find(x => x.id === id); if (!a) return;
    profile.ach[id] = Date.now(); profile.money += a.reward; saveProfile();
    const el = document.getElementById('ach'); el.innerHTML = `<b>${a.icon} Succès débloqué !</b><span>${a.name} — ${a.desc}</span><i>+${a.reward} €</i>`;
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); clearTimeout(this._achT); this._achT = setTimeout(() => el.classList.remove('on'), 4200);
    this.audio.beep(1320, 0.12); setTimeout(() => this.audio.beep(1760, 0.2), 130);
  }

  // ---------- gadgets du copilote : huile, clous, fumigène ----------
  dropGadget(kind, v) {
    const back = v.trailer ? _v.set(0, 0, -v.def.trailer.len + 0.5).applyQuaternion(v.trailer.curQuat).add(v.trailer.curPos) : _v.set(0, 0, -v.def.len / 2 - 1).applyQuaternion(v.curQuat).add(v.curPos);
    const yaw = v.yaw;
    if (kind === 'smoke') { this.smokeT = { t: 6, v }; return; }
    if (kind === 'crackers') { // pétards : étincelles + détonations, la police proche sursaute
      for (let i = 0; i < 6; i++) setTimeout(() => { this.audio.crash(back, 2.5); for (let k = 0; k < 10; k++) this.particles.emit(back.x + (Math.random() - 0.5) * 4, 0.4, back.z + (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 6, Math.random() * 5, (Math.random() - 0.5) * 6, 0.35, 0.1, 0, 0xffd040, 1); }, i * 160);
      for (const p of this.police) if (p.v !== v && p.v.curPos.distanceTo(back) < 45) { p.v.blindT = 1.5; p.v.body.applyTorqueImpulse({ x: 0, y: (Math.random() < 0.5 ? -1 : 1) * p.v.mass * 1.2, z: 0 }, true); if (p.v !== this.player) this.say('crack' + p.v.unit, `${p.v.name} : « On nous TIRE dessus ?! Ah non… des pétards. »`, 6); else this.camRig.shake = 1; }
      return;
    }
    if (kind === 'detour') { // faux panneau : la police le croit et part sur la BAU au ralenti
      const sign = new THREE.Group(); const pan = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.1), new THREE.MeshStandardMaterial({ color: 0xffffff, map: this._detTex ||= (() => { const c = document.createElement('canvas'); c.width = 256; c.height = 176; const g2 = c.getContext('2d'); g2.fillStyle = '#f0b020'; g2.fillRect(0, 0, 256, 176); g2.fillStyle = '#111'; g2.font = '900 40px Arial'; g2.textAlign = 'center'; g2.fillText('DÉVIATION', 128, 80); g2.font = '900 60px Arial'; g2.fillText('➜', 128, 150); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })(), side: THREE.DoubleSide }));
      pan.position.y = 1.4; sign.add(pan); const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.4, 0.06), this.world.postMat); leg.position.y = 0.7; sign.add(leg);
      sign.position.set(back.x, 0, back.z); sign.rotation.y = v.yaw; this.scene.add(sign); (this.slicks ||= []).push({ kind: 'detour', mesh: sign, x: back.x, z: back.z, t: 0, r: 0, owner: v });
      for (const p of this.police) if (p.ai && p.v.road.s < v.road.s && v.road.s - p.v.road.s < 250) { p.v.blindT = 8; p.ai.lane = 3; }
      this.say('detour', 'Unité 2 : « Une déviation ? Bon… je prends la bande d’arrêt d’urgence. »', 10);
      return;
    }
    if (kind === 'cones') { for (let i = 0; i < 4; i++) this.spawnProp('cone', new THREE.Vector3(back.x + (Math.random() - 0.5) * 3, 1.2, back.z + (Math.random() - 0.5) * 3), { x: v.lastV?.x * 0.6 || 0, y: 1.5, z: v.lastV?.z * 0.6 || 0 }); return; }
    if (kind === 'paint') {
      const tgt = this.police.filter(p => p.v !== v && !p.v.disabled && p.v.curPos.distanceTo(back) < 60).sort((a, b) => a.v.curPos.distanceTo(back) - b.v.curPos.distanceTo(back))[0]?.v || (this.team === 'police' && this.player !== v && this.player.curPos.distanceTo(back) < 60 ? this.player : null);
      if (!tgt) { this.hud.toast('🎨 Raté : aucune voiture de police assez proche'); return; }
      tgt.blindT = 6; tgt.paintT = 18;
      const sp = new THREE.Mesh(new THREE.CircleGeometry(0.7, 12), new THREE.MeshStandardMaterial({ color: 0xff3fa0, roughness: 0.4 }));
      sp.position.set(0.1, tgt.def.cab.belt - tgt.bodyY + 0.3, tgt.def.cab.wz + 0.1); sp.rotation.x = -0.9; sp.scale.set(1.3, 1, 1); tgt.mesh.add(sp); setTimeout(() => tgt.mesh.remove(sp), 18000);
      if (tgt === this.player) { const o = document.getElementById('paintover'); o.classList.add('on'); setTimeout(() => o.classList.remove('on'), 7000); }
      else this.say('paint' + tgt.unit, `${tgt.name} : « De la PEINTURE ?! Je ne vois plus rien ! »`, 5);
      return;
    }
    let mesh;
    if (kind === 'oil') {
      mesh = new THREE.Mesh(new THREE.CircleGeometry(3.2, 24), this._oilMat ||= new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.04, metalness: 0.7, transparent: true, opacity: 0.88 }));
      mesh.rotation.x = -Math.PI / 2; mesh.scale.set(1.4, 0.8, 1); mesh.rotation.z = -yaw; mesh.position.set(back.x, 0.04, back.z);
    } else {
      mesh = new THREE.Group(); const nm = this._nailMat ||= new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.9, roughness: 0.3 });
      for (let i = 0; i < 60; i++) { const n = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 4), nm); n.position.set((Math.random() - 0.5) * 7, 0.06, (Math.random() - 0.5) * 2); n.rotation.set(Math.random(), Math.random(), Math.random()); mesh.add(n); }
      mesh.position.set(back.x, 0, back.z); mesh.rotation.y = yaw;
    }
    this.scene.add(mesh);
    (this.slicks ||= []).push({ kind, mesh, x: back.x, z: back.z, t: 0, r: kind === 'oil' ? 4 : 3.6, owner: v });
  }
  gadgetsStep(dt) {
    if (this.smokeT && this.smokeT.t > 0) {
      const v = this.smokeT.v; this.smokeT.t -= dt;
      const back = v.trailer ? _v.set(0, 2, -v.def.trailer.len).applyQuaternion(v.trailer.curQuat).add(v.trailer.curPos) : _v.set(0, 1.5, -v.def.len / 2 - 1).applyQuaternion(v.curQuat).add(v.curPos);
      for (let i = 0; i < 4; i++) this.particles.emit(back.x + (Math.random() - 0.5) * 3, back.y, back.z + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, Math.random() * 1.5, (Math.random() - 0.5) * 3, 5, 2.5, 4, 0xb8bcc4, 0.55);
      for (const p of this.police) if (p.ai && p.v.curPos.distanceTo(back) < 45 && p.v.road.s < v.road.s) { if (!(p.v.blindT > 0)) this.say('smoke' + p.v.unit, `${p.v.name} : « Je ne vois plus rien ! C’est quoi cette fumée ?! »`, 8); p.v.blindT = 3; }
    }
    if (!this.slicks) return;
    for (const sl of this.slicks) {
      sl.t += dt;
      for (const v of this.vehicles) {
        if (v === sl.owner && sl.t < 2) continue;
        const dx = v.curPos.x - sl.x, dz = v.curPos.z - sl.z; if (dx * dx + dz * dz > sl.r * sl.r) continue;
        if (sl.kind === 'oil' && !(v.oil > 0)) { v.oil = 2.8; if (v.isPolice && v !== this.player) this.unlock('banana'); v.body.applyTorqueImpulse({ x: 0, y: (Math.random() < 0.5 ? -1 : 1) * v.mass * 2.2, z: 0 }, true); if (v.isPolice && v !== this.player) this.say('oil' + v.unit, `${v.name} : « De l’HUILE ?! Je glisse, je glisse ! »`, 5); }
        if (sl.kind === 'nails' && v.isPolice && !v.flat) { v.flat = 1; v.spikes = 1; this.audio.crash(v.curPos, 2); if (v !== this.player) this.say('nail' + v.unit, `${v.name} : « Crevaison ! J’ai roulé sur des clous ! »`, 5); }
      }
      if (sl.t > 75) sl.dead = true;
    }
    this.slicks = this.slicks.filter(sl => { if (sl.dead) this.scene.remove(sl.mesh); return !sl.dead; });
  }

  // ---------- marqueur du quai de livraison ----------
  buildBayMark() {
    const g = new THREE.Group();
    const rect = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 20), new THREE.MeshBasicMaterial({ color: 0x40ff90, transparent: true, opacity: 0.28, depthWrite: false })); rect.rotation.x = -Math.PI / 2; rect.position.y = 0.06; g.add(rect);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(4.6, 0.01, 20)), new THREE.LineBasicMaterial({ color: 0x40ff90 })); edge.position.y = 0.07; g.add(edge);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2.4, 4), new THREE.MeshBasicMaterial({ color: 0x40ff90 })); arrow.rotation.x = Math.PI; arrow.position.y = 7; g.add(arrow); g.userData.arrow = arrow;
    g.visible = false; this.scene.add(g); return g;
  }
  updateBayMark() {
    const m = this.bayMark, on = this.team === 'truck' && this.player && ['play', 'countdown', 'end'].includes(this.state) && this.mode !== 'free' && this.mode !== 'online' && this.player.road.s > DEST.s0 - 900;
    m.visible = !!on; if (!on) return;
    const bs = YARD_END.bays[this.world.targetBay], p = this.roadPose(bs, YARD_END.whD0 + 10.5);
    m.position.set(p.x, 0, p.z); m.rotation.y = p.yaw; m.userData.arrow.position.y = 7 + Math.sin(this.time * 3) * 0.6; m.userData.arrow.rotation.y += 0.03;
    m.children[0].material.opacity = this.parkInfo?.inBay ? 0.5 : 0.28;
  }

  // ---------- bulles de pensée des PNJ ----------
  bubble(car, text) {
    if (!car?.cur || car.cur.distanceTo(this.camera.position) > 140) return;
    this.bubbleList ||= [];
    if (this.bubbleList.length >= 4 || this.bubbleList.some(b => b.car === car)) return;
    text = String(text).slice(0, 140);
    const c = document.createElement('canvas'), W = 640, g0 = c.getContext('2d'), F = '700 34px Arial', LH = 40;
    g0.font = F; const lines = []; let cur = '';
    for (const word of text.split(/\s+/)) { const t2 = cur ? cur + ' ' + word : word; if (g0.measureText(t2).width > W - 70 && cur) { lines.push(cur); cur = word; } else cur = t2; }
    if (cur) lines.push(cur); lines.splice(4);
    const H = lines.length * LH + 40 + 30; c.width = W; c.height = H; const g = c.getContext('2d'); g.font = F;
    const w = Math.min(W - 8, Math.max(...lines.map(l => g.measureText(l).width)) + 50), bh = lines.length * LH + 34;
    g.fillStyle = 'rgba(255,255,255,0.95)'; g.beginPath(); g.roundRect((W - w) / 2, 4, w, bh, 26); g.fill();
    g.beginPath(); g.moveTo(W / 2 - 16, bh + 2); g.lineTo(W / 2, bh + 28); g.lineTo(W / 2 + 16, bh + 2); g.fill();
    g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle'; lines.forEach((l, i) => g.fillText(l, W / 2, 4 + 17 + LH / 2 + i * LH));
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true })); sp.scale.set(7, 7 * H / W, 1); sp.center.set(0.5, 0); sp.renderOrder = 20;
    this.scene.add(sp); this.bubbleList.push({ car, sp, t: 0, life: 2.6 + text.length * 0.045 });
  }
  bubblesStep(dt) {
    if (!this.bubbleList) return;
    for (const b of this.bubbleList) {
      b.t += dt; const p = b.car.mesh?.position || b.car.cur;
      b.sp.position.set(p.x, (b.car.type?.h || 1.5) + 0.9 + Math.min(0.4, b.t), p.z);
      const L = b.life || 2.9; b.sp.material.opacity = b.t < L - 0.5 ? 1 : Math.max(0, (L - b.t) * 2);
      if (b.t > L || b.car.dead) { this.scene.remove(b.sp); b.sp.material.map.dispose(); b.dead = true; }
    }
    this.bubbleList = this.bubbleList.filter(b => !b.dead);
  }

  // ---------- hélicoptère de la gendarmerie ----------
  buildHeli() {
    const g = new THREE.Group(), white = new THREE.MeshStandardMaterial({ color: 0x1d2c4a, roughness: 0.4, metalness: 0.3 }), dark = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 12), white); body.scale.set(1, 0.9, 1.6); g.add(body);
    const glass = new THREE.Mesh(new THREE.SphereGeometry(1.2, 14, 10), MAT.glass); glass.position.set(0, 0.3, 1.5); glass.scale.set(1, 0.8, 0.9); g.add(glass);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.18, 6, 10), white); boom.rotation.x = Math.PI / 2; boom.position.set(0, 0.3, -4.2); g.add(boom);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.6, 0.9), white); fin.position.set(0, 1, -7); g.add(fin);
    for (const sx of [-1, 1]) { const sk = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4, 6), dark); sk.rotation.x = Math.PI / 2; sk.position.set(sx * 1.1, -1.6, 0); g.add(sk); }
    this.heliRotor = new THREE.Group(); this.heliRotor.position.y = 1.7; g.add(this.heliRotor);
    for (let i = 0; i < 4; i++) { const bl = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.05, 11), dark); bl.rotation.y = i * Math.PI / 2; this.heliRotor.add(bl); }
    this.heliTail = new THREE.Group(); this.heliTail.position.set(0.25, 1, -7); g.add(this.heliTail);
    for (let i = 0; i < 2; i++) { const bl = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.8, 0.2), dark); bl.rotation.x = i * Math.PI / 2; this.heliTail.add(bl); }
    const beam = new THREE.Mesh(new THREE.ConeGeometry(7, 60, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff6d8, transparent: true, opacity: 0.03, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = -30; this.heliBeam = new THREE.Group(); this.heliBeam.position.set(0, -1.3, 1.8); this.heliBeam.add(beam); g.add(this.heliBeam);
    this.heliSpot = new THREE.SpotLight(0xfff2d8, 0, 160, 0.13, 0.5, 1.2); this.heliSpot.position.set(0, -1.4, 1.8); g.add(this.heliSpot); this.scene.add(this.heliSpot.target);
    g.visible = false; this.scene.add(g);
    return g;
  }
  heliStep(dt) {
    const h = this.heli, truck = this.targetTruck();
    if (this.mirror && this.heliTarget && truck) { this.heliT += dt; h.position.lerp(new THREE.Vector3(...this.heliTarget), Math.min(1, dt * 5)); }
    if (!this.heliOn || !truck || !h.visible) { this.heliSpot.intensity = 0; return; }
    this.heliT += dt;
    const f = truck.forward, want = new THREE.Vector3(truck.curPos.x - f.x * 35 + Math.sin(this.heliT * 0.3) * 20, 42 + Math.sin(this.heliT * 0.5) * 4, truck.curPos.z - f.z * 35 + Math.cos(this.heliT * 0.3) * 10);
    if (!this.mirror) h.position.lerp(want, Math.min(1, dt * 0.6));
    h.lookAt(truck.curPos.x, h.position.y - 8, truck.curPos.z);
    this.heliRotor.rotation.y += dt * 40; this.heliTail.rotation.x += dt * 60;
    const night = this.env.night > 0.4 || this.env.fogAmt > 0.5 || this.env.rainAmt > 0.5;
    this.heliSpot.target.position.copy(truck.curPos); this.heliSpot.intensity = night ? 3500 : 0;
    this.heliBeam.visible = night; this.heliBeam.lookAt(truck.curPos); this.heliBeam.rotateX(-Math.PI / 2);
    this.audio.rotor?.(Math.max(0, 0.5 - h.position.distanceTo(this.camera.position) / 400));
    if (!this.mirror && this.heliT > 3 && this.heliT < 3.1) this.radio('Hélicoptère Dragon 74 en position, je l’ai dans le projecteur !', 'pol');
  }
  // objets lancés : cartons (copilote sur la remorque) et meules de fromage (portes ouvertes)
  spawnProp(kind, pos, vel) {
    const R = this.R, isCheese = kind === 'cheese';
    const body = this.phys.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setLinvel(vel.x, vel.y, vel.z).setAngvel({ x: Math.random() * 4, y: Math.random() * 4, z: Math.random() * 4 }).setCcdEnabled(true));
    const isCone = kind === 'cone';
    this.phys.createCollider(isCheese ? R.ColliderDesc.cylinder(0.18, 0.45).setDensity(250).setFriction(0.4) : isCone ? R.ColliderDesc.cylinder(0.37, 0.2).setDensity(60).setFriction(0.6) : R.ColliderDesc.cuboid(0.3, 0.25, 0.3).setDensity(90).setFriction(0.6), body);
    const mesh = new THREE.Mesh(isCheese ? new THREE.CylinderGeometry(0.45, 0.45, 0.36, 18) : isCone ? new THREE.ConeGeometry(0.22, 0.75, 10) : new THREE.BoxGeometry(0.6, 0.5, 0.6), isCheese ? (this._cheeseMat ||= new THREE.MeshStandardMaterial({ color: 0xf0c040, roughness: 0.6 })) : isCone ? this.world.coneMat : (this._boxMat ||= new THREE.MeshStandardMaterial({ color: 0xa8814f, roughness: 0.9 })));
    mesh.castShadow = true; this.scene.add(mesh);
    this.cartons.push({ body, mesh, t: 0, kind });
  }
  propsStep(dt) {
    for (const c of this.cartons) {
      c.t += dt; const p = c.body.translation(), q = c.body.rotation();
      c.mesh.position.set(p.x, p.y, p.z); c.mesh.quaternion.set(q.x, q.y, q.z, q.w);
      for (const v of this.vehicles) if (v.isPolice && !v.oil && v.curPos.distanceToSquared(c.mesh.position) < 6) { v.oil = c.kind === 'cheese' ? 2 : 0.8; this.say('prop' + v.unit, c.kind === 'cheese' ? `${v.name} : « Des MEULES DE FROMAGE sur la chaussée ?! »` : c.kind === 'cone' ? `${v.name} : « Des cônes de chantier ?! Il se croit où ? »` : `${v.name} : « Il nous balance des cartons ! »`, 6); }
      if (c.t > 40 || p.y < -5) c.dead = true;
    }
    this.cartons = this.cartons.filter(c => { if (c.dead) { this.scene.remove(c.mesh); this.phys.removeRigidBody(c.body); } return !c.dead; });
    // étincelles des jantes à nu
    for (const v of this.vehicles) if (v.flat && v.kmh > 15 && Math.random() < 0.7) {
      const w = v.wheelDefs[2 + (Math.random() * 2 | 0)] || v.wheelDefs[0], p = _v.set(w.x, -v.bodyY + 0.05, w.z).applyQuaternion(v.curQuat).add(v.curPos);
      this.particles.emit(p.x, 0.1, p.z, (Math.random() - 0.5) * 4 - v.lastV.x * 0.2, Math.random() * 2, (Math.random() - 0.5) * 4 - v.lastV.z * 0.2, 0.25, 0.08, 0, 0xffc040, 1);
    }
  }

  // ---------- frôlements (score de style) ----------
  nearMiss(dt) {
    const pl = this.player; if (!pl || pl.kmh < 55) return;
    this.comboT -= dt; if (this.comboT <= 0) this.combo = 0;
    for (const c of this.traffic.cars) {
      if (c.wreck || c.nm === pl.uid) continue;
      const ds = (c.s - pl.road.s) * 1, dd = Math.abs(c.d - pl.road.d) - (c.w + pl.def.w) / 2;
      if (Math.abs(ds) < (c.len + pl.def.len) / 2 && dd > 0.05 && dd < 1.1 && Math.sign(c.d) === Math.sign(pl.road.d)) {
        c.nm = pl.uid; this.combo++; this.comboT = 4;
        const pts = 100 * this.combo; this.score += pts; if (this.combo >= 4) this.unlock('combo');
        this.hud.toast(`FRÔLEMENT ! +${pts}${this.combo > 1 ? '  ×' + this.combo : ''}`);
      }
    }
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
    p.ctrl.computeColliderMovement(p.col, { x: mx * run * dt, y: p.vy * dt, z: mz * run * dt });
    const c = p.ctrl.computedMovement(), t = p.body.translation();
    if (p.ctrl.computedGrounded()) p.vy = 0;
    p.body.setNextKinematicTranslation({ x: t.x + c.x, y: t.y + c.y, z: t.z + c.z });
    p.pos.set(t.x + c.x, t.y + c.y - 0.87, t.z + c.z);
    if (this.input.hit('KeyF') && this.state === 'play') {
      if (p.pos.distanceTo(p.vehicle.curPos) < 6 + p.vehicle.def.len / 2) this.leaveFoot();
      else this.hud.toast('Trop loin du véhicule');
    }
  }

  // ---------- règles de la poursuite ----------
  rules(dt) {
    const pl = this.player;
    if (this.arrest?.args) return this.arrestStep(dt);
    if (this.mode === 'free' || (this.mode === 'online' && !this.convoy)) { if (this.mode === 'online') this.onlineRules(dt); else this.patrolStep(dt); return; }
    if (this.convoy) this.convoyBoard(dt);
    this.timeLeft -= dt;
    const truck = this.targetTruck();
    if (this.check && truck) this.checkStep(dt, truck);
    if (!this.released && this.time >= this.headStart) {
      this.released = true;
      for (const p of this.police) if (p.ai) { p.ai.role = 'chase'; p.v.siren = true; }
      if (this.team === 'truck') this.radio('Central : toutes les unités, poursuite engagée ! Sirènes activées.', 'pol');
      else { this.radio('Central : feu vert, poursuite autorisée ! (G : sirène)', 'pol'); pl.siren = true; }
    }
    // niveau de recherche (1 à 5 étoiles)
    if (this.released) this.heat = Math.min(100, this.heat + dt * 0.18);
    const lvl = this.wanted = this.team === 'truck' ? Math.min(5, 1 + Math.floor(this.heat / 20)) : 0;
    if (lvl !== this.lastLvl) { if (this.lastLvl && lvl > this.lastLvl) { this.hud.big('★'.repeat(lvl), 'wanted'); this.radio(['', '', 'Niveau 2 : renforts autorisés.', 'Niveau 3 : hélicoptère en route, herses autorisées.', 'Niveau 4 : toutes les unités disponibles !', 'Niveau 5 : ENNEMI PUBLIC N°1. Arrêtez-le à tout prix.'][lvl], 'pol'); } this.lastLvl = lvl; }
    if (lvl >= 5) this.unlock('five');
    if (lvl >= 3 && !this.heliOn && this.team === 'truck') { this.unlock('heli'); this.heliOn = true; this.heliT = 0; const hp = truck.curPos; this.heli.position.set(hp.x - 120, 60, hp.z - 200); this.heli.visible = true; }
    if (this.released && this.time > this.nextReinforce) {
      this.nextReinforce += Math.max(22, 50 - lvl * 7);
      const count = this.police.filter(p => p.ai && !p.v.disabled).length;
      if (count < this.diff.police + (lvl - 1) - (this.team === 'police' ? 2 : 0) && truck) {
        const ai = this.addPolice(truck.road.s - 420, laneD(1, 0), 'chase');
        ai.v.setVelocityForward(40);
        this.radio(`Unité ${ai.v.unit} en renfort, arrive par l'arrière.`, 'pol');
      }
    }
    if (!this.blockDone && this.released && this.time > this.nextBlock && truck && truck.road.s < DEST.s0 - 1500 && truck.road.d > -18) {
      this.blockDone = true;
      let bs = truck.road.s + 1100;
      if ((bs > 2950 && bs < 3650) || (bs > 5750 && bs < 6350)) bs += 700;
      const a = this.addPolice(bs, laneD(1, 0) - 0.4, 'roadblock'), b = this.addPolice(bs + 4, laneD(1, 1), 'roadblock');
      for (const ai of [a, b]) { ai.v.siren = true; ai.v.resetOnRoad(ai.v.road.s, ai.v.road.d, roadYaw(ai.v.road.s) + 1.2); }
      this.addSpike(bs - 12, laneD(1, 2) - 1.2, 6.5);
      this.radio(`Barrage installé au PK ${(bs / 1000).toFixed(1)} avec herse. Voies de gauche bloquées.`, 'pol');
      this.roadblock = { s: bs, units: [a, b] };
      // gendarmes à pied derrière le barrage
      for (const [dd, ds] of [[laneD(1, 0) + 2.2, 7], [laneD(1, 1) + 1.6, 9], [laneD(1, 2) + 2.6, 6]]) this.addOfficer(bs + ds, dd, Math.PI, 'block', 90);
    }
    if (this.roadblock && truck && truck.road.s > this.roadblock.s + 30) {
      for (const ai of this.roadblock.units) if (ai.role === 'roadblock') ai.role = 'chase';
      if (this.team === 'truck') { this.heat += 8; this.triggerSlowmo('BARRAGE FORCÉ !'); this.unlock('block'); }
      this.roadblock = null; if (lvl >= 3) { this.blockDone = false; this.nextBlock = this.time + 60; }
    }
    for (const p of this.police) if (p.ai && truck && p.ai.role === 'chase' && truck.road.s - p.v.road.s > 1300) {
      p.v.resetOnRoad(truck.road.s - 700, laneD(1, 0)); p.v.setVelocityForward(40);
    }
    if (truck) {
      let close = false;
      for (const p of this.police) {
        if (p.v.disabled) continue;
        let d = p.v.curPos.distanceTo(truck.curPos);
        if (truck.trailer) d = Math.min(d, p.v.curPos.distanceTo(truck.trailer.curPos));
        if (d < 15) close = true;
      }
      const slow = truck.kmh < 14;
      if (close && slow && this.released && this.time > (this.bustGrace || 0)) this.bust = Math.min(1, this.bust + dt / 3.2);
      else this.bust = Math.max(0, this.bust - dt / 5);
      if (truck.disabled) this.bust = 1;
      if (truck.upright < 0.3 && truck.kmh < 5) this.bust = Math.min(1, this.bust + dt / 2);
      if (this.bust >= 1 && !this.arrest && !this.mirror) { this.arrest = { t: 0, args: null }; }
      if (this.bust >= 1 && this.arrest && !this.arrest.args) { this.arrest.args = [this.team === 'police', this.team === 'police' ? 'Suspect interpellé !' : (this.coop ? 'Les routiers sont arrêtés !' : 'Vous avez été interpellé.'), truck.disabled ? 'Le camion est hors d’usage.' : (this.coop ? 'La Tomme Dorée finira en tube. Quelle tristesse.' : 'La police a immobilisé le camion.')]; this.startArrest(truck); return; }
      const rd = truck.road;
      const inDepot = r2 => r2.s > DEST.s0 && r2.s < DEST.s1 && r2.d < DEST.d0 + 2 && r2.d > DEST.d1;
      if (this.mission?.obj === 'fragile' && inDepot(rd) && this.cargo < 40) return this.finish(false, 'Cargaison ruinée', `Il ne reste que ${Math.round(this.cargo)} % de Tomme Dorée intacte. Le client refuse la livraison.`);
      if (this.allies.length) { // convoi : il faut 2 camions sur 3 à la plateforme
        for (const a of this.allies) {
          if (a.status !== 'run') continue;
          if (inDepot(a.v.road)) { a.status = 'ok'; this.hud.msg(`📦 ${a.v.name} est arrivé à la plateforme !`); continue; }
          const near = this.police.some(p => !p.v.disabled && p.v.curPos.distanceTo(a.v.curPos) < 15);
          a.bust = near && a.v.kmh < 14 ? a.bust + dt / 3.2 : Math.max(0, a.bust - dt / 5);
          if (a.bust >= 1 || a.v.disabled) { a.status = 'lost'; this.radio(`${a.v.name} intercepté !`, 'pol'); }
        }
        if (inDepot(rd) && !this.playerArrived) { this.playerArrived = true; this.hud.msg('📦 Vous êtes arrivé ! Attendez le reste du convoi…'); }
        const ok = this.allies.filter(a => a.status === 'ok').length + (this.playerArrived ? 1 : 0), lost = this.allies.filter(a => a.status === 'lost').length;
        if (ok >= 2) return this.finish(true, 'Convoi livré !', `${ok} camions sur 3 sont arrivés à la plateforme.`);
        if (lost >= 2) return this.finish(false, 'Convoi démantelé', 'Deux camions ont été interceptés.');
        if (!this.playerArrived) { /* continue */ } else return;
      } else if (this.team === 'truck' && truck === pl && inDepot(rd)) {
        // il faut se garer au quai indiqué (cabine ou remorque dans le rectangle vert, presque à l'arrêt)
        const bs = YARD_END.bays[this.world.targetBay], parts = [rd]; if (pl.trailer) parts.push(worldToRoad(pl.trailer.curPos.x - pl.trailer.curQuat.y * 0, pl.trailer.curPos.z, {}));
        if (pl.trailer) { const tq = pl.trailer.curQuat, f = _v.set(0, 0, -6).applyQuaternion(tq).add(pl.trailer.curPos); parts.push(worldToRoad(f.x, f.z, {})); }
        const inBay = parts.some(q => Math.abs(q.s - bs) < 2.8 && q.d < YARD_END.whD0 + 22 && q.d > YARD_END.whD0 + 0.3);
        this.parkInfo = { n: this.world.targetBay + 1, dist: Math.hypot(rd.s - bs, rd.d - (YARD_END.whD0 + 10)), inBay };
        this.lotT = (this.lotT || 0) + dt;
        if (inBay && pl.kmh < 3) { this.parkT += dt; if (this.parkT > 1.5) { if (this.lotT < 25) this.unlock('park'); } if (this.parkT > 1.5) return this.finish(true, 'Livraison réussie !', this.coop ? 'Camion garé au quai ' + (this.world.targetBay + 1) + '. La Tomme Dorée est sauvée !' : 'Camion garé au quai ' + (this.world.targetBay + 1) + ', les manutentionnaires déchargent.'); }
        else this.parkT = 0;
        if (!this.parkHint) { this.parkHint = true; this.hud.msg(`🅿️ Vous êtes à la plateforme ! Garez-vous au <b>quai ${this.world.targetBay + 1}</b> (rectangle vert), arrêtez-vous dedans.`); }
      } else if (inDepot(rd)) {
        return this.finish(this.team === 'truck', this.team === 'truck' ? 'Livraison réussie !' : 'Le suspect s’est échappé.', this.coop ? 'La Tomme Dorée est sauvée ! Les fromagers pleurent de joie.' : 'Le camion a atteint la Plateforme Logistique.');
      }
      this.situationRadio(truck);
    }
    if (this.mission?.obj === 'fragile') this.hud.cargo?.(this.cargo);
    // le suspect IA se défend avec des gadgets (quantité limitée)
    if (this.team === 'police' && truck && this.released) {
      this.fugGad ||= { oil: 2, nails: 2, smoke: 1, paint: 1, cones: 1, crackers: 1, cd: 20 };
      const fg = this.fugGad; fg.cd -= dt;
      const chaser = this.police.find(p => p.v.road.s < truck.road.s && truck.road.s - p.v.road.s < 45 && Math.abs(p.v.road.d - truck.road.d) < 6);
      if (chaser && fg.cd <= 0) {
        const opt = ['oil', 'nails', 'smoke', 'paint', 'cones', 'crackers'].filter(k => fg[k] > 0);
        if (opt.length) { const k = opt[Math.floor(Math.random() * opt.length)]; fg[k]--; fg.cd = 14 + Math.random() * 10; this.dropGadget(k, truck); this.radio({ oil: 'Attention ! Le suspect déverse de l’huile sur la chaussée !', nails: 'Il sème des clous derrière lui ! Écartez-vous !', smoke: 'Fumigène ! Visibilité nulle derrière le camion !', paint: 'Il nous a jeté de la peinture sur le pare-brise !', cones: 'Il sème des cônes de chantier ! Attention !', crackers: 'Des détonations ! Ah… ce sont des pétards.' }[k], 'pol'); }
      }
    }
    if (this.team === 'police' && pl.disabled) return this.finish(false, 'Véhicule hors service', 'Votre voiture de police est trop endommagée.');
    if (this.timeLeft <= 0) return this.finish(this.team === 'police', this.team === 'police' ? 'Livraison empêchée !' : 'Temps écoulé', 'Le camion n’a pas atteint sa destination à temps.');
  }

  // la police commente ce qui se passe vraiment
  situationRadio(truck) {
    if (!this.released) return;
    const s = truck.road.s, d = truck.road.d, units = this.police.filter(p => p.ai && !p.v.disabled);
    const near = this.nearestPolice(truck.curPos);
    if (d < -12.3 && truck.kmh > 30) this.say('bau', 'Le suspect roule sur la bande d’arrêt d’urgence ! Attention aux véhicules en panne.');
    const tun = TUNNELS.find(([a, b]) => s > a - 250 && s < a);
    if (tun) this.say('tun' + tun[0], `Il approche du tunnel ${tun[0] === TUNNELS[0][0] ? 'du Mont-Roux' : 'du Bois-Noir'}. On le colle à la sortie !`, 60);
    if (s > EXIT_GAP[0] - 900 && s < EXIT_GAP[0]) this.say('exit', 'Il se rapproche de la sortie 18 ! Coupez-lui la bretelle !', 60);
    if (truck.spikes > 0) this.say('spk', 'Pneus crevés ! Il ne pourra plus aller bien loin.', 60);
    if (near.v && near.d < 25 && truck.kmh > 60) this.say('contact', `${near.v.name} au contact. Je tente de passer devant.`, 30);
    if (near.v && near.d > 600) this.say('lost', `Contact perdu. Dernière position : PK ${(s / 1000).toFixed(1)}.`, 40);
    if (units.some(u => u.ai.tactic === 'lead' && u.v.road.s > s + 5 && u.v.road.s < s + 30)) this.say('rollblock', 'Bouchon roulant en place, je ralentis devant lui.', 35);
    const jam = this.traffic.cars.filter(c => !c.wreck && c.dir === 1 && Math.abs(c.s - s) < 120 && c.v < 6).length;
    if (jam >= 4) this.say('jam', 'Ralentissement devant le suspect, il va devoir passer par la BAU.', 40);
    this.radioT -= DT;
    if (this.radioT <= 0) { this.radioT = 30 + Math.random() * 15; this.say('pk', `Suspect au PK ${(s / 1000).toFixed(1)}, ${Math.round(truck.kmh)} km/h.`, 20); }
  }

  addSpike(s, d, w) {
    const p = this.roadPose(s, d);
    const mesh = new THREE.Group();
    mesh.add(new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, 0.4), new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.6 })));
    for (let i = 0; i < w / 0.25; i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.15, 4), MAT.body); c.position.set(-w / 2 + i * 0.25, 0.08, 0); mesh.add(c); }
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, 0.1), new THREE.MeshBasicMaterial({ color: 0xffd020 })); stripe.position.y = 0.05; mesh.add(stripe);
    mesh.position.set(p.x, 0.04, p.z); mesh.rotation.y = p.yaw;
    this.scene.add(mesh);
    this.spikes.push({ s, d, w, mesh });
  }

  onImpact(v) {
    const pl = this.player, truck = this.targetTruck();
    if (v === pl && this.mission?.obj === 'fragile') { this.cargo = Math.max(0, this.cargo - (v.impact - 1.5) * 4.5); if (v.impact > 4) this.hud.toast(`🧀 Cargaison : ${Math.round(this.cargo)} %`); }
    if (v.isPolice && truck && this.team === 'truck' && v.curPos.distanceTo(truck.curPos) < 20) { this.heat += Math.min(6, v.impact); this.say('ram' + v.unit, `${v.name} percutée par le camion !`, 12); }
    if (v === pl && v.impact > 7 && this.state === 'play') this.triggerSlowmo('CHOC !');
  }
  triggerSlowmo(label) {
    if (!settings.slowmo || this.slowCd > 0 || this.coopKind === 'online' || this.mirror) return;
    this.slow = 2.4; this.slowCd = 25; this.slowA = Math.random() * 6;
    document.body.classList.add('slowmo'); $('slowmo-label').textContent = label;
  }

  onDisabled(v) {
    if (this.state !== 'play') return;
    if (v.isPolice && v !== this.player) { this.radio(`${v.name} hors service !`, 'pol'); if (!v.def.moto) { const side = v.road.d < -6 ? 1 : -1; this.addOfficer(v.road.s + 1, v.road.d + side * (v.def.w / 2 + 0.8), roadYaw(v.road.s) + Math.PI, 'angry', 30); setTimeout(() => this.state === 'play' && this.say('afoot' + v.unit, `${v.name} : « Je suis à pied ! Véhicule HS, il m’a percuté ! »`, 30), 1800); } if (this.team === 'truck') { this.heat += 15; this.triggerSlowmo('UNITÉ HORS SERVICE'); } }
    if (v === this.player && this.team === 'truck') this.hud.msg('Votre camion est hors d’usage !', 'red');
  }
  onTrafficCrash(car) {
    if (this.state !== 'play' || this.mode === 'free' || this.mode === 'online') return;
    const truck = this.targetTruck();
    if (truck && car.cur.distanceTo(truck.curPos) < 30) { this.heat += 6; this.say('civ', 'Le camion a percuté un civil ! Priorité : arrêter ce chauffard.', 15); }
    else this.say('acc', 'Accident signalé, véhicules civils impliqués. Prudence.', 20);
  }

  finish(win, title, sub) {
    if (this.ended) return;
    if (this.convoy && this.net?.room) this.net.send({ t: 'event', e: win ? 'delivered' : 'busted', name: this.net.me?.name });
    this.ended = true;
    this.setState('end');
    const pl = this.player;
    const el = this.timeTotal - this.timeLeft;
    const best = +(localStorage.getItem('tat_best') || 0);
    const score = Math.round(this.score + (win ? 2000 : 0) + (this.coop ? this.coop.score : 0));
    if (score > best) try { localStorage.setItem('tat_best', score); } catch (e) { }
    const rows = [
      ['Temps', fmtTime(el)], ['Distance', ((pl.road.s - this.stats.start) / 1000).toFixed(2) + ' km'], ['Vitesse max', Math.round(this.stats.topSpeed) + ' km/h'],
      ['Accidents causés', this.stats.crashes], ['État du véhicule', Math.round(100 - pl.damage) + ' %'], ['Score', score + (score > best ? ' 🏆' : '')],
    ];
    // carrière : étoiles et argent
    let stars = 0, money = 0;
    if (this.team === 'truck' && this.mode !== 'free') {
      if (win) { stars = 1; const M = this.mission; if (el <= (M?.par ?? 330)) stars++; if ((M?.obj === 'fragile' ? this.cargo > 80 : pl.damage < 30) && this.stats.crashes <= 3) stars++; }
      const base = this.mission ? this.mission.reward : 400;
      money = win ? Math.round(base * (0.5 + 0.25 * stars) + score / 20) : Math.round(score / 40);
      profile.money += money;
      if (this.mission && stars > (profile.stars[this.mission.id] || 0)) profile.stars[this.mission.id] = stars;
      saveProfile();
      rows.push(['Récompense', '+' + money + ' €'], ['Étoiles', '⭐'.repeat(stars) + '☆'.repeat(3 - stars)]);
    }
    this.lastStars = stars;
    if (win && this.team === 'truck' && this.mode !== 'free') { this.unlock('first'); if (pl.damage < 10) this.unlock('clean'); }
    if (win && this.team === 'police') this.unlock('cop');
    if (this.mission && win) { const b = profile.best[this.mission.id]; if (!b || el < b) { profile.best[this.mission.id] = Math.round(el); saveProfile(); rows.push(['Record', '🏁 ' + fmtTime(el)]); } }
    if (MISSIONS.every(m => (profile.stars[m.id] || 0) >= 3)) this.unlock('all');
    this.showEnd(win, title, sub, rows);
    if (this.coop && this.coopKind === 'online') this.net.send({ t: 'end', win, title, sub, rows });
    this.audio.beep(win ? 880 : 220, 0.6, 0.2);
    for (const p of this.police) if (p.ai) p.ai.role = 'idle';
    for (const f of this.fugitives) f.role = 'idle';
  }
  showEnd(win, title, sub, rows) {
    this.setState('end');
    $('end-title').textContent = title; $('end-sub').textContent = sub;
    $('end').className = 'screen center on ' + (win ? 'win' : 'lose');
    $('end-badge').textContent = win ? 'VICTOIRE' : 'DÉFAITE';
    $('end-stats').innerHTML = rows.map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('');
    const nx = this.mission && win ? MISSIONS[MISSIONS.indexOf(this.mission) + 1] : null; $('e-next').style.display = nx ? '' : 'none'; $('e-next').dataset.m = nx?.id || '';
    this.heli.visible = false; this.audio.rotor?.(0); Voice.say(title, { prio: true, pitch: 1, rate: 1.05 });
  }

  // ---------- menu / garage ----------
  toMenu() {
    if (this.net.room && (this.mode === 'online' || this.coopKind === 'online')) { /* on reste dans le salon */ }
    this.clearMatch();
    this.hud.show(false);
    this.setState('menu');
    this.env.setTime(settings.time); this.env.setWeather(settings.weather);
    this.traffic.clear();
    this.showroom.setTruck(settings.vehicle.truck);
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
    const center = _v.set(0, 0, def.trailer ? -6 : 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.preview.rotation.y).add(c);
    this.camera.position.set(center.x + Math.sin(this.garageYaw) * dist, (def.team === 'truck' ? 3.2 : 1.7) + (def.trailer ? 3 : 0), center.z + Math.cos(this.garageYaw) * dist);
    this.camera.lookAt(center.x, def.team === 'truck' ? 1.8 : 0.8, center.z);
    this.camera.fov = 50; this.camera.updateProjectionMatrix();
  }

  // ---------- multijoueur ----------
  netSetup() {
    const n = this.net;
    n.on('chat', m => this.hud.msg(`💬 <b>${m.name}</b> : ${QUICK_CHAT[m.i] || ''}`));
    n.on('joined', p => this.hud.toast(`🤝 ${p.name} a rejoint la partie`));
    n.on('left', m => { const r = this.remotes.get(m.id); if (r) { r.dispose(); this.remotes.delete(m.id); } this.hud.toast(`📴 ${m.name} est parti`); });
    n.on('close', () => { for (const r of this.remotes.values()) r.dispose(); this.remotes.clear(); if (this.mirror) { this.toMenu(); } });
    n.on('event', m => {
      if (this.state !== 'play' || this.mode !== 'online') return;
      if (this.convoy && m.e === 'busted') { this.hud.msg(`🚨 <b>${m.name || 'Un autre routier'}</b> s’est fait arrêter !`, 'pol'); return; }
      const police = this.team === 'police';
      if (m.e === 'busted') police ? this.finish(true, 'Camion intercepté !', 'Tu as immobilisé le camion de ton adversaire. Victoire !') : this.hud.msg('🚨 Un autre camion a été interpellé !', 'pol');
      if (m.e === 'delivered') police ? this.finish(false, 'Il a livré…', 'Le camion a atteint la Plateforme Logistique.') : (this.hud.msg(`📦 <b>${m.name || 'Un autre camion'}</b> a livré${this.convoy ? ' en premier !' : ' !'}`), this.convoy && this.hud.big('🏁 ' + (m.name || 'Rival') + ' a livré'));
      if (m.e === 'timeout' && police) this.finish(true, 'Temps écoulé !', 'Le camion n’a pas livré à temps. Victoire de la police !');
    });
    n.on('traf', m => { if (this.netTraffic && this.state !== 'menu') this.traffic.applySnapshot(m.tr); });
    n.on('wreck', m => { if (!this.net.host) return; const c = this.traffic.cars.find(x => x.id === m.id); if (c && !c.wreck) this.traffic.makeWreck(c, m.vx, m.vz); });
    n.on('gadget', m => {
      if (this.mode !== 'online' || !this.player) return;
      const fake = { yaw: m.yaw, trailer: null, def: { len: 0 }, curQuat: new THREE.Quaternion(), curPos: new THREE.Vector3(m.x, 1, m.z), lastV: new THREE.Vector3(), road: worldToRoad(m.x, m.z, {}) };
      this.dropGadget(m.k, fake);
      const sl = this.slicks?.[this.slicks.length - 1]; if (sl && m.k !== 'smoke') { sl.x = m.x; sl.z = m.z; sl.mesh.position.x = m.x; sl.mesh.position.z = m.z; }
      if (m.k === 'smoke' && this.player.curPos.distanceTo(fake.curPos) < 70) { const o = document.getElementById('smokeover'); o.classList.add('on'); setTimeout(() => o.classList.remove('on'), 4500); }
      this.hud.msg({ oil: '🛢️ Le camion a versé de l’huile !', nails: '📌 Le camion a semé des clous !', smoke: '💨 Fumigène derrière le camion !' }[m.k], 'red');
    });
    n.on('spike', m => { if (this.mode === 'online') { this.addSpike(m.s, m.d, m.w); this.hud.msg('🦔 La police a posé une herse !', 'red'); } });
    n.on('mega', m => { if (this.mode === 'online') { this.hud.msg(`📢 <b>${m.name}</b> : « ${m.l} »`, 'pol'); Voice.say(m.l, { pitch: 0.75, rate: 1.1, prio: true }); } });
    n.on('bustlvl', m => { if (this.mode === 'online' && this.team === 'police') this.bust = m.b; });
    n.on('swap', () => { const t = this.net.me.team === 'truck' ? 'police' : 'truck'; settings.team = t; saveSettings(); this.net.setTeam(t, settings.vehicle[t]); });
    // coop : l'hôte reçoit les commandes de l'invité
    n.on('input', m => { if (this.coop && !this.mirror) this.remoteInput = m.i; });
    n.on('act', m => { if (this.coop && !this.mirror && this.state === 'play') this.coop.action(m.a, 'remote'); });
    // coop : l'invité reçoit l'état du monde
    n.on('snap', m => { if (this.mirror) this.lastSnap = m; });
    n.on('msg', m => { if (this.mirror) this.hud.msg(m.h, m.k); });
    n.on('big', m => { if (this.mirror) this.hud.big(m.h); });
    n.on('end', m => { if (this.mirror) this.showEnd(m.win, m.title, m.sub, m.rows); });
    n.on('cine', () => { if (this.mirror) this.mirrorCine = true; });
    n.on('speech', m => { if (this.coop) this.handleSpeech(m.idx, m.text, false); });
    n.on('adm', m => this.admin.remote(m));
  }
  updateRemotes(dt) {
    if (!this.net.room || this.mode !== 'online') return;
    for (const [id, p] of this.net.players) {
      if (id === this.net.id || !p.state) continue;
      let r = this.remotes.get(id);
      if (!r || r.vid !== p.state.id) { if (r) r.dispose(); r = new RemoteCar(this, p); this.remotes.set(id, r); }
      r.team = p.state.team || p.team; r.name = p.state.name || p.name; r.apply(p.state, dt);
    }
  }
  onlineRules(dt) {
    const pl = this.player;
    this.timeLeft -= dt;
    if (this.team !== 'truck') return;
    if (this.timeLeft <= 0) { this.net.send({ t: 'event', e: 'timeout' }); return this.finish(false, 'Temps écoulé', 'Tu n’as pas livré à temps. La police gagne le duel.'); }
    let close = false;
    for (const r of this.remotes.values()) if (r.team === 'police' && r.curPos.distanceTo(pl.curPos) < 15) close = true;
    if (close && pl.kmh < 14) this.bust = Math.min(1, this.bust + dt / 3.2); else this.bust = Math.max(0, this.bust - dt / 5);
    if (this.bust >= 1) { this.net.send({ t: 'event', e: 'busted' }); return this.finish(false, 'Interpellé !', 'Le joueur police t’a immobilisé.'); }
    if (pl.disabled) { this.net.send({ t: 'event', e: 'busted' }); return this.finish(false, 'Camion détruit', 'Ton camion est hors d’usage.'); }
    if (this.netBustT !== undefined && Math.abs(this.netBustT - this.bust) > 0.05) { this.netBustT = this.bust; this.net.send({ t: 'bustlvl', b: +this.bust.toFixed(2) }); } else if (this.netBustT === undefined) this.netBustT = 0;
    const rd = pl.road;
    if (rd.s > DEST.s0 && rd.s < DEST.s1 && rd.d < DEST.d0 + 2 && rd.d > DEST.d1) { this.net.send({ t: 'event', e: 'delivered' }); this.finish(true, 'Livraison réussie !', 'Vous avez atteint la Plateforme Logistique.'); }
  }

  // coop en ligne côté hôte : messages du HUD relayés, instantané du monde à 15 Hz
  hookNetHud() {
    const h = this.hud, n = this.net, om = h.msg.bind(h), ob = h.big.bind(h);
    h.msg = (t, k) => { om(t, k); n.send({ t: 'msg', h: t, k }); };
    h.big = (t, c) => { ob(t, c); if (t) n.send({ t: 'big', h: t }); };
    h.unhook = () => { h.msg = om; h.big = ob; h.unhook = null; };
  }
  sendSnapshot(dt) {
    this.snapT = (this.snapT || 0) - dt; if (this.snapT > 0) return; this.snapT = 1 / 15;
    const V = this.vehicles.map(v => {
      const p = v.curPos, q = v.curQuat;
      const a = [v.uid, v.id, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +q.x.toFixed(4), +q.y.toFixed(4), +q.z.toFixed(4), +q.w.toFixed(4), +v.speed.toFixed(2), +v.steer.toFixed(2), (v.siren ? 1 : 0) | (v.headlights ? 2 : 0) | (v.brk > 0.1 ? 4 : 0) | (v === this.player ? 8 : 0) | (v.isPolice ? 16 : 0) | (v.wiping ? 32 : 0), Math.round(v.damage), Math.round(v.rpm), +v.thr.toFixed(2)];
      if (v.trailer) { const tp = v.trailer.curPos, tq = v.trailer.curQuat; a.push(+tp.x.toFixed(2), +tp.y.toFixed(2), +tp.z.toFixed(2), +tq.x.toFixed(4), +tq.y.toFixed(4), +tq.z.toFixed(4), +tq.w.toFixed(4)); }
      return a;
    });
    this.snapN = (this.snapN || 0) + 1;
    const pp = this.player?.curPos, tr = this.snapN % 2 ? null : this.traffic.snapshot().filter(c => !pp || Math.hypot(c[3] - pp.x, c[4] - pp.z) < 450); // trafic à 7,5 Hz et seulement à proximité
    this.net.send({ t: 'snap', v: V, tr, g: { tl: +this.timeLeft.toFixed(1), b: +this.bust.toFixed(2), st: this.state, c: this.coop.serialize(), bn: this.bananas.map(b => [+b.mesh.position.x.toFixed(1), +b.mesh.position.z.toFixed(1)]), sc: Math.round(this.score), tm: +this.time.toFixed(1), wa: this.wanted || 0, sl: (this.slicks || []).filter(sl => sl.kind !== 'detour').map(sl => [sl.kind === 'oil' ? 0 : 1, +sl.x.toFixed(1), +sl.z.toFixed(1), +sl.owner.yaw.toFixed(2)]), sm: this.smokeT?.t > 0 ? 1 : 0, hl: this.heliOn && this.heli.visible ? [this.heli.position.x, this.heli.position.y, this.heli.position.z].map(x => +x.toFixed(1)) : null, pr: this.cartons.slice(-24).map(c => [c.kind === 'cheese' ? 1 : 0, ...[c.mesh.position.x, c.mesh.position.y, c.mesh.position.z, c.mesh.quaternion.x, c.mesh.quaternion.y, c.mesh.quaternion.z, c.mesh.quaternion.w].map(x => +x.toFixed(2))]), rel: this.released ? 1 : 0, w: this.env.weather, tod: this.env.timeOfDay } });
  }

  // ---------- coop en ligne côté invité : on affiche le monde de l'hôte ----------
  startMirror(cfg) {
    this.mirror = true; this.mode = 'coop'; this.team = 'truck'; this.coopKind = 'online';
    this.world.update(-300, 600, new THREE.Vector3(0, 0, 0), 0, true);
    this.traffic.clear();
    this.buildCheckpoint(650); // décor du contrôle routier (la logique tourne chez l'hôte)
    const host = [...this.net.players.values()].find(p => p.host);
    this.coop = new Coop(this, { names: [host?.name || 'Hôte', this.net.me.name], humans: [true, true], online: true });
    document.body.classList.add('coop');
    this.hud.setRole('truck', 'chase'); this.hud.show(true);
    this.setState('countdown'); this.mirrorCine = !!cfg.cineFirst;
    this.byUid = new Map(); this.lastSnap = null; this.inputT = 0;
    this.startVoiceChat();
    this.coopMsg('🚛 Tu as rejoint la cabine de ' + (host?.name || 'ton pote') + ' ! <b>Tab</b> = relais, <b>1-7</b> = actions de copilote, <b>V</b> = radio CB.');
  }
  mirrorFrame(dt) {
    const inp = this.input, m = this.lastSnap;
    this.time += dt;
    if (m) {
      this.lastSnap = null;
      const seen = new Set();
      for (const a of m.v) {
        const [uid, id] = a; seen.add(uid);
        let v = this.byUid.get(uid);
        if (!v) {
          const rd = worldToRoad(a[2], a[4], {});
          v = this.addVehicle(id, rd.s, rd.d, { uid, ai: true, name: a[11] & 16 ? 'Police' : 'Camion' });
          this.byUid.set(uid, v);
          if (a[11] & 16) this.police.push({ v, ai: null });
        }
        v.prevPos.copy(v.pos); v.prevQuat.copy(v.quat);
        v.curPos.set(a[2], a[3], a[4]); v.curQuat.set(a[5], a[6], a[7], a[8]);
        v.speed = a[9]; v.kmh = Math.abs(a[9]) * 3.6; v.steer = a[10];
        v.siren = !!(a[11] & 1); v.headlights = !!(a[11] & 2); v.brk = a[11] & 4 ? 1 : 0; v.wiping = !!(a[11] & 32);
        v.damage = a[12]; v.rpm = a[13]; v.thr = a[14]; v.reverse = a[9] < -0.3;
        if (a[11] & 8) { if (this.player !== v) { v.addInterior(); this.makeCrew(v); } this.player = v; }
        worldToRoad(a[2], a[4], v.road);
        v.forward.set(0, 0, 1).applyQuaternion(v.curQuat); v.yaw = Math.atan2(v.forward.x, v.forward.z); v.lastV.set(v.forward.x * a[9], 0, v.forward.z * a[9]);
        if (v.trailer && a.length > 15) { v.trailer.prevPos.copy(v.trailer.pos); v.trailer.prevQuat.copy(v.trailer.quat); v.trailer.curPos.set(a[15], a[16], a[17]); v.trailer.curQuat.set(a[18], a[19], a[20], a[21]); }
        v.snapAt = performance.now();
      }
      for (const [uid, v] of this.byUid) if (!seen.has(uid)) { v.dispose(); this.byUid.delete(uid); this.vehicles = this.vehicles.filter(x => x !== v); this.police = this.police.filter(p => p.v !== v); }
      if (m.tr) this.traffic.applySnapshot(m.tr);
      const g = m.g;
      this.timeLeft = g.tl; this.bust = g.b; this.score = g.sc; this.released = !!g.rel; this.wanted = g.wa;
      // huile et clous de l'hôte
      this.slicks ||= [];
      if ((g.sl || []).length !== this.slicks.length) {
        this.slicks.forEach(sl => this.scene.remove(sl.mesh)); this.slicks = [];
        for (const [k, x, z, yaw] of g.sl || []) { const fake = { yaw, trailer: null, def: { len: 0 }, curQuat: new THREE.Quaternion(), curPos: new THREE.Vector3(x, 0, z) }; this.dropGadget(k ? 'nails' : 'oil', fake); const sl = this.slicks[this.slicks.length - 1]; sl.mesh.position.x = x; sl.mesh.position.z = z; sl.r = 0; }
      }
      if (g.sm && this.player && !(this.smokeT?.t > 0)) this.smokeT = { t: 1, v: this.player };
      // hélicoptère de l'hôte
      if (g.hl) { this.heliOn = true; this.heli.visible = true; if (!this.heliT) this.heli.position.set(...g.hl); this.heliTarget = g.hl; } else if (this.heliOn) { this.heliOn = false; this.heli.visible = false; }
      // cartons et fromages
      this.mirrorProps ||= [];
      while (this.mirrorProps.length < (g.pr || []).length) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), this._boxMat ||= new THREE.MeshStandardMaterial({ color: 0xa8814f, roughness: 0.9 })); m.castShadow = true; this.scene.add(m); this.mirrorProps.push(m); }
      while (this.mirrorProps.length > (g.pr || []).length) this.scene.remove(this.mirrorProps.pop());
      (g.pr || []).forEach((a, i) => { const m = this.mirrorProps[i]; if (a[0] && !m.userData.cheese) { m.geometry = new THREE.CylinderGeometry(0.45, 0.45, 0.36, 18); m.material = this._cheeseMat ||= new THREE.MeshStandardMaterial({ color: 0xf0c040, roughness: 0.6 }); m.userData.cheese = true; } m.position.set(a[1], a[2], a[3]); m.quaternion.set(a[4], a[5], a[6], a[7]); });
      if (g.st !== this.state && g.st !== 'end') this.setState(g.st);
      this.coop.apply(g.c);
      if (this.env.weather !== g.w) this.env.setWeather(g.w);
      this.env.timeOfDay = g.tod;
      // bananes
      while (this.bananas.length < g.bn.length) this.dropBanana(this.player || this.vehicles[0]);
      while (this.bananas.length > g.bn.length) this.scene.remove(this.bananas.pop().mesh);
      g.bn.forEach((p, i) => this.bananas[i].mesh.position.set(p[0], 0.1, p[1]));
      this.snapAge = 0;
    }
    this.snapAge = (this.snapAge || 0) + dt;
    const alpha = clamp(this.snapAge * 15);
    // cinématique locale pendant que l'hôte la joue
    if (this.state === 'cine' && !this.cine.on && this.player && this.mirrorCine) { this.mirrorCine = false; this.cine.play(storyShots(this, 'coop', this.coop.names), () => { }); }
    if (this.state !== 'cine' && this.cine.on) this.cine.finish();
    // commandes : conduite si on est le conducteur, actions de copilote sinon
    if (this.state === 'play') {
      this.inputT -= dt;
      if (this.coop.driver === 1 && this.inputT <= 0) { this.inputT = 1 / 30; this.net.send({ t: 'input', i: inp.drive() }); }
      if (inp.hit('Tab')) this.coopAct('swap');
      this.coopPad();
      if (Mini.on) { if (inp.hit('Space') || inp.hit('Enter') || ACTIONS.some(a => inp.hit('Digit' + a.k))) Mini.pad(); }
      else if (this.coop.driver !== 1) ACTIONS.forEach(a => { if (inp.hit(a.code || 'Digit' + a.k) || inp.hit('Numpad' + a.k)) this.coopAct(a.id); });
      if (this.coop.roof && inp.mouse.clicked && document.pointerLockElement) this.coopAct('throw');
      if (inp.hit('KeyC')) this.hud.toast(CAM_NAMES[this.camRig.cycle()]);
    }
    for (const v of this.vehicles) {
      v.render(alpha, this.time);
      if (v.trailer) { v.trailer.pos.lerpVectors(v.trailer.prevPos, v.trailer.curPos, alpha); }
    }
    // rendu du reste (sans physique)
    const savedFixed = this.fixed;
    this.heliStep(dt);
    this.renderWorld(alpha, dt);
    inp.endFrame();
  }
}

// Véhicule d'un autre joueur (poursuite en ligne) : affichage interpolé + corps cinématique pour les collisions
class RemoteCar {
  constructor(game, p) {
    const s = p.state, def = VEHICLES[s.id] || VEHICLES.sedan;
    this.game = game; this.vid = s.id; this.def = def; this.name = p.name; this.team = p.team;
    const m = def.team === 'police' ? buildPoliceCar(def) : buildPlayerTruck(def);
    this.model = m; this.mesh = new THREE.Group(); this.mesh.add(m.group);
    this.wheels = def.wheels.map(([x, z]) => { const w = makeWheel(def.wheelR, def.team === 'truck' ? 0.38 : 0.26); w.position.set(x, def.wheelR, z); this.mesh.add(w); return { w, front: z > 0 }; });
    game.scene.add(this.mesh);
    // étiquette : nom + distance
    this.tagC = document.createElement('canvas'); this.tagC.width = 256; this.tagC.height = 64; this.tagTex = new THREE.CanvasTexture(this.tagC); this.tagTex.colorSpace = THREE.SRGBColorSpace;
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tagTex, depthTest: false, transparent: true })); this.tag.scale.set(4, 1, 1); this.tag.renderOrder = 21; game.scene.add(this.tag); this.tagT = 0;
    const R = game.R;
    this.body = game.phys.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
    game.phys.createCollider(R.ColliderDesc.cuboid(def.w / 2, def.h / 2, def.len / 2).setTranslation(0, def.h / 2, 0), this.body);
    if (def.trailer) { const t = buildTrailer(def); this.tmesh = t.group; game.scene.add(this.tmesh); }
    this.peerId = p.id;
    if (!def.moto) { this.drv = buildSeated(def.team === 'truck' ? 0x3a5a8a : 0x1d2f5a, def.team === 'truck' ? 0xd8462b : 0x111111); this.drv.group.position.set(def.cab.x, def.cab.y - 0.75, def.cab.z - 0.05); this.mesh.add(this.drv.group); this.drv.armL.rotation.x = this.drv.armR.rotation.x = -1.15; }
    this.curPos = new THREE.Vector3(); this.target = new THREE.Vector3(); this.q = new THREE.Quaternion(); this.tq = new THREE.Quaternion(); this.siren = false; this.lightT = 0;
  }
  apply(s, dt) {
    this.target.set(s.p[0], s.p[1], s.p[2]); this.tq.set(...s.q);
    this.target.x += s.v[0] * 0.05; this.target.z += s.v[2] * 0.05;
    if (this.curPos.distanceTo(this.target) > 30) this.curPos.copy(this.target); else this.curPos.lerp(this.target, Math.min(1, dt * 12));
    this.q.slerp(this.tq, Math.min(1, dt * 12));
    this.siren = !!s.sir; this.spd = Math.hypot(s.v[0], s.v[2]); this.st = s.st || 0;
    const yaw = roadYaw(worldToRoad(this.curPos.x, this.curPos.z, {}).s);
    this.vAlong = s.v[0] * Math.sin(yaw) + s.v[2] * Math.cos(yaw);
    this.body.setNextKinematicTranslation({ x: this.curPos.x, y: this.curPos.y - (this.def.wheelR + 0.25), z: this.curPos.z });
    this.body.setNextKinematicRotation({ x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w });
    if (this.tmesh && s.tp) { this.tmesh.position.set(s.tp[0], s.tp[1] - 1, s.tp[2]); this.tmesh.quaternion.set(...s.tq); }
    this.pos = this.curPos;
  }
  render() {
    this.mesh.position.set(this.curPos.x, this.curPos.y - (this.def.wheelR + 0.25), this.curPos.z); this.mesh.quaternion.copy(this.q);
    for (const w of this.wheels) { w.rot = (w.rot || 0) + (this.spd || 0) / this.def.wheelR / 60; w.w.rotation.set(w.rot, w.front ? this.st * 0.5 : 0, 0, 'YXZ'); }
    const pl = this.game.player, dist = pl ? Math.round(this.curPos.distanceTo(pl.curPos)) : 0;
    this.tag.position.set(this.curPos.x, this.curPos.y + this.def.h + 1.6, this.curPos.z); this.tag.scale.setScalar(Math.max(3, Math.min(14, dist / 14)) ).multiply(new THREE.Vector3(1, 0.25, 1));
    if ((this.tagT -= 1 / 60) <= 0) { this.tagT = 0.4; const g = this.tagC.getContext('2d'); g.clearRect(0, 0, 256, 64); g.fillStyle = this.team === 'police' ? 'rgba(30,70,200,0.85)' : 'rgba(220,100,20,0.85)'; g.beginPath(); g.roundRect(4, 6, 248, 52, 14); g.fill(); g.fillStyle = '#fff'; g.font = '700 26px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(`${this.team === 'police' ? '🚔' : '🚛'} ${this.name} · ${dist} m`, 128, 33); this.tagTex.needsUpdate = true; }
    if (this.drv) { const lv = this.game.net.peerLevel(this.peerId); this.mouthLv = Math.max(lv, (this.mouthLv || 0) * 0.8); this.drv.mouth.scale.y = 0.6 + this.mouthLv * 4; this.drv.head.rotation.y = Math.sin(performance.now() * 0.0007 + this.peerId.length) * 0.4; }
    if (this.model.lights) { this.lightT += 1 / 60; const ph = (this.lightT * 2.6) % 1; this.model.lights.blue.emissiveIntensity = this.siren && ph < 0.3 ? 9 : 0.15; this.model.lights.red.emissiveIntensity = this.siren && ph > 0.5 && ph < 0.8 ? 9 : 0.15; }
  }
  dispose() { this.game.scene.remove(this.mesh); this.game.scene.remove(this.tag); if (this.tmesh) this.game.scene.remove(this.tmesh); this.game.phys.removeRigidBody(this.body); this.game.audio.updateSiren(this, false); }
}
