// MODE COOP « Les Routiers de l'Extrême » : deux routiers dans le même camion.
// Un conduit, l'autre est copilote (sandwichs, café, gifles, radio, bananes, fausses infos CB…).
// Fatigue, faim, envie pressante, carburant — et des gags absurdes (abeille, éternuement, carte qui s'envole, belle-maman au téléphone…).
import { clamp, REST_AREAS, roadToWorld } from './config.js';
import { Voice } from './voice.js';
import * as THREE from 'three';

const $ = id => document.getElementById(id);
export const ACTIONS = [
  { k: '1', id: 'sandwich', icon: '🥪', name: 'Sandwich', tip: 'Nourrir le conducteur' },
  { k: '2', id: 'coffee', icon: '☕', name: 'Café', tip: 'Réveille… mais donne envie' },
  { k: '3', id: 'slap', icon: '👋', name: 'Secouer', tip: 'Réveiller / régler un gag' },
  { k: '4', id: 'radio', icon: '📻', name: 'Radio', tip: 'Changer de station' },
  { k: '5', id: 'banana', icon: '🍌', name: 'Banane', tip: 'Par la fenêtre, sur la police' },
  { k: '6', id: 'cb', icon: '📢', name: 'Fausse info', tip: 'Embrouiller la police à la CB' },
  { k: '7', id: 'swap', icon: '🔁', name: 'Relais', tip: 'Changer de conducteur' },
  { k: '8', id: 'roof', icon: '🧗', name: 'Toit', tip: 'Grimper sur la remorque et lancer des cartons' },
];
const STATIONS = [
  { id: 'off', name: 'Radio éteinte' },
  { id: 'techno', name: 'TECHNO ROUTIÈRE 98.7 — ça réveille !' },
  { id: 'berceuse', name: 'BERCEUSE FM — douceur et sommeil…' },
  { id: 'musette', name: 'RADIO MUSETTE — accordéon non-stop' },
];
export const GAGS = {
  bee: { icon: '🐝', text: 'UNE ABEILLE DANS LA CABINE !', fix: 'slap', fixText: 'Écraser l’abeille (Secouer)', dur: 16, game: 'swat' },
  map: { icon: '🗺️', text: 'La carte routière s’est envolée sur le pare-brise !', fix: 'slap', fixText: 'Ranger la carte (Secouer)', dur: 12, game: 'fold' },
  sneeze: { icon: '🤧', text: 'AAA… AAATCHOUM !', dur: 1.2 },
  stink: { icon: '🧀', text: 'Le fromage de la remorque PUE. Les yeux piquent !', fix: 'slap', fixText: 'Ouvrir les fenêtres (Secouer)', dur: 14 },
  phone: { icon: '📱', text: 'Belle-maman appelle… IMPOSSIBLE de raccrocher.', fix: 'slap', fixText: 'Arracher le téléphone (Secouer)', dur: 15 },
  sing: { icon: '🎤', text: 'Le conducteur chante faux à tue-tête. Le moral remonte !', dur: 6 },
  hiccup: { icon: '😖', text: 'Le sandwich au thon était périmé : HOQUET !', dur: 14 },
  pigeon: { icon: '🐦', text: 'Un pigeon a visé le pare-brise. En plein milieu.', fix: 'wipe', fixText: 'Essuie-glaces (B)', dur: 20 },
  spill: { icon: '🧀', text: 'LES PORTES DE LA REMORQUE SE SONT OUVERTES ! Les meules de fromage roulent sur la route !', fix: 'slap', fixText: 'Fermer les portes (Secouer)', dur: 16, game: 'hold' },
  horn: { icon: '📯', text: 'Le klaxon est COINCÉ. Tout le monde vous regarde.', fix: 'slap', fixText: 'Taper sur le volant (Secouer)', dur: 12, game: 'mash' },
  hitch: { icon: '🧳', text: 'Un auto-stoppeur s’est caché dans la couchette. Il s’appelle Jean-Kévin et il parle beaucoup.', dur: 30 },
  gps: { icon: '🛰️', text: 'Le GPS a bugué. Il a une nouvelle voix.', dur: 18 },
};

export class Coop {
  constructor(game, opts) {
    this.game = game;
    this.names = opts.names || ['Marcel', 'Gégé'];
    this.humans = opts.humans || [true, true];        // qui est humain (sinon IA)
    this.online = !!opts.online;
    this.chars = this.names.map((n, i) => ({ name: n, fatigue: 25 + i * 10, faim: 30 + i * 8, envie: 10, moral: 70, asleep: 0, micro: 0 }));
    this.driver = 0; this.fuel = 100; this.bananas = 5; this.sandwiches = 3; this.station = 0; this.cbCd = 0;
    this.gag = null; this.gagT = 18; this.prep = null; this.swapT = 0; this.jitter = 0; this.slapN = 0; this.pushing = false;
    this.aiT = 0; this.joltT = 0; this.jolt = 0; this.hicT = 0; this.lastSpeech = 0; this.score = 0;
  }
  get drv() { return this.chars[this.driver]; }
  get cop() { return this.chars[1 - this.driver]; }
  driverIsHuman() { return this.humans[this.driver]; }

  say(text, kind = '') { this.game.coopMsg('🗨️ ' + text, kind); }

  // ---------- simulation ----------
  update(dt, v) {
    const g = this.game, d = this.drv, c = this.cop, st = STATIONS[this.station].id;
    const moving = v.kmh > 5;
    // besoins
    const fRate = (st === 'techno' ? 0.25 : st === 'berceuse' ? 1.25 : 0.5) * (g.env.night > 0.5 ? 1.4 : 1);
    if (moving) d.fatigue = clamp(d.fatigue + fRate * dt, 0, 100, 100);
    c.fatigue = Math.max(0, c.fatigue - 0.7 * dt);
    for (const ch of this.chars) { ch.faim = Math.min(100, ch.faim + 0.32 * dt * (st === 'musette' ? 1.4 : 1)); ch.envie = Math.max(0, ch.envie - 0.05 * dt); ch.moral = clamp(ch.moral - 0.05 * dt, 0, 100); }
    d.fatigue = Math.min(100, d.fatigue); d.envie = Math.min(100, d.envie);
    // carburant
    this.fuel = Math.max(0, this.fuel - (0.05 + v.thr * 0.28) * dt * (v.kmh > 1 ? 1 : 0.2) * (1 - (v.tankLvl || 0) * 0.18));
    if (this.fuel <= 0 && !this.fuelMsg) { this.fuelMsg = true; this.say(`${d.name} : « Euh… on est en PANNE SÈCHE. » ${c.name} : « Je descends pousser. »`, 'red'); }
    // plein + ravitaillement à l'aire de repos (sous l'auvent de la station)
    const ra = REST_AREAS.find(r => v.road.s > r.s0 + 60 && v.road.s < r.s1 + 40 && v.road.d < -30 && v.road.d > -55);
    if (ra && v.kmh < 4) {
      if (this.fuel < 99) { this.fuel = Math.min(100, this.fuel + 18 * dt); this.fuelMsg = false; if (!this.fillMsg) { this.fillMsg = true; this.say('⛽ Le plein se fait… et ' + c.name + ' achète 3 sandwichs et 5 bananes.'); this.sandwiches = 3; this.bananas = 5; } }
      for (const ch of this.chars) if (ch.envie > 30) { ch.envie = 0; this.say(`🚻 ${ch.name} : « Ahhhh… ça va mieux. »`); }
    } else this.fillMsg = false;

    // endormissement
    if (d.asleep <= 0 && d.micro <= 0) {
      if (d.fatigue > 70 && Math.random() < dt * (d.fatigue - 65) / 140) { d.micro = 1.2 + Math.random() * 1.6; g.audio?.snore?.(); }
      if (d.fatigue >= 99.5 && moving) { d.asleep = 1; this.say(`😴 ${d.name} s’est ENDORMI au volant !!! RÉVEILLE-LE !`, 'red'); g.audio?.snore?.(); }
    }
    if (d.micro > 0) d.micro -= dt;
    if (d.asleep > 0) { d.asleep += dt; if (d.asleep % 2.2 < dt) g.audio?.snore?.(); }
    // gags aléatoires
    this.gagT -= dt;
    if (!this.gag && this.gagT <= 0 && moving) {
      this.gagT = 22 + Math.random() * 25;
      const pool = ['bee', 'map', 'sneeze', 'stink', 'phone', 'sing', 'pigeon', 'spill', 'horn', 'hitch', 'gps', 'bee', 'spill'];
      if (!v.trailer && v.def.id !== 'delivery') pool.splice(pool.indexOf('spill'), 1);
      this.startGag(pool[Math.floor(Math.random() * pool.length)]);
    }
    if (this.gag) {
      this.gag.t += dt;
      const gid = this.gag.id;
      if (gid === 'spill' && (this.spillT = (this.spillT || 0) - dt) <= 0) {
        this.spillT = 0.7;
        const t = v.trailer, back = t ? new THREE.Vector3(0, 1.4, -v.def.trailer.len + 1).applyQuaternion(t.curQuat).add(t.curPos) : new THREE.Vector3(0, 1.4, -v.def.len / 2 - 0.5).applyQuaternion(v.curQuat).add(v.curPos);
        g.spawnProp('cheese', back, { x: v.lastV.x * 0.8 + (Math.random() - 0.5) * 2, y: 1, z: v.lastV.z * 0.8 + (Math.random() - 0.5) * 2 });
      }
      if (gid === 'horn') v.hornStuck = 1;
      if (gid === 'hitch' && (this.hitchT = (this.hitchT || 0) - dt) <= 0) { this.hitchT = 6 + Math.random() * 4; const L = ['Jean-Kévin : « Vous savez que les fromages ont des sentiments ? »', 'Jean-Kévin : « Moi aussi j’étais routier. Enfin, en trottinette. »', 'Jean-Kévin : « On est poursuivis ? TROP BIEN ! »', 'Jean-Kévin : « Vous me déposez à Lyon ? Ou Tokyo, comme vous voulez. »', 'Jean-Kévin : « J’ai mangé le dernier sandwich, désolé. »']; this.say(L[Math.floor(Math.random() * L.length)]); if (Math.random() < 0.3) this.sandwiches = Math.max(0, this.sandwiches - 1); }
      if (gid === 'gps' && (this.gpsT = (this.gpsT || 0) - dt) <= 0) { this.gpsT = 5; const L = ['Dans 300 mètres, faites demi-tour. Non je rigole.', 'Recalcul de l’itinéraire… Destination : la plage.', 'Attention, radar. Je crois. Ou un lapin.', 'Vous êtes arrivé. Ah non. Pas du tout.', 'Tournez à gauche dans le champ de maïs.']; const l = L[Math.floor(Math.random() * L.length)]; g.hud.toast('🛰️ ' + l); Voice.say(l, { pitch: 1.9, rate: 0.85, voice: 2, prio: true }); }
      if (this.gag.id === 'pigeon' && v.wiping && this.gag.t > 1) this.endGag('Les essuie-glaces étalent… puis nettoient. Beurk.');
      if (this.gag && this.gag.t > GAGS[this.gag.id].dur) this.endGag();
    }
    if (d.envie > 85 && !this.envieMsg) { this.envieMsg = true; this.say(`${d.name} : « J’AI ENVIE !!! Une aire de repos, VITE ! » (il se trémousse)`, 'red'); }
    if (d.envie < 60) this.envieMsg = false;
    if (d.faim > 85 && !this.faimMsg) { this.faimMsg = true; this.say(`${d.name} : « J’ai tellement faim que je vois des sandwichs sur la route… »`); }
    if (d.faim < 60) this.faimMsg = false;
    // préparation du sandwich
    if (this.prep) { this.prep.t -= dt; if (this.prep.t <= 0) this.finishPrep(); }
    this.cbCd = Math.max(0, this.cbCd - dt); this.jitter = Math.max(0, this.jitter - dt); this.swapT = Math.max(0, this.swapT - dt);
    // sur le toit : gare aux coups de volant
    if (this.roof) {
      const lat = Math.abs(v.accL?.x || 0);
      if (lat > 5.5 || v.kmh > 105) { this.roof = false; this.say(`😱 ${c.name} a failli tomber du camion ! Il se rattrape à la portière et replonge dans la cabine.`, 'red'); g.camRig.shake = 1; }
    }
    // copilote IA
    if (!this.humans[1 - this.driver]) this.aiCopilot(dt, v);
    // pousser le camion en panne
    this.pushing = this.fuel <= 0;
    this.score += v.kmh > 30 ? dt * 2 : 0;
  }

  // modifie les commandes du conducteur selon son état et les gags
  modify(inp, dt, t) {
    const d = this.drv, g = this.gag?.id;
    const o = { ...inp };
    if (this.swapT > 0) { o.steer = Math.sin(t * 9) * 0.9; o.throttle = 0.5; o.brake = 0; return o; } // relais à la volée : CHAOS
    if (d.asleep > 0 || d.micro > 0) { o.throttle = 0.55; o.brake = 0; o.steer = Math.sin(t * 0.7) * 0.18; o.handbrake = false; }
    if (this.fuel <= 0) { o.throttle = 0; }
    if (g === 'bee') o.steer += Math.sin(t * 23) * 0.5 + Math.sin(t * 7.3) * 0.35;
    if (g === 'phone') { this.lag = (this.lag ?? 0) + (o.steer * 0.4 - (this.lag ?? 0)) * Math.min(1, dt * 1.5); o.steer = this.lag; }
    if (g === 'stink') o.steer += Math.sin(t * 2.1) * 0.22;
    if (g === 'hiccup') { this.hicT -= dt; if (this.hicT <= 0) { this.hicT = 1.2 + Math.random(); this.jolt = (Math.random() < 0.5 ? -1 : 1) * 0.7; this.joltT = 0.15; this.game.audio?.hic?.(); } }
    if (this.joltT > 0) { this.joltT -= dt; o.steer += this.jolt; }
    if (this.jitter > 0) o.steer += Math.sin(t * 31) * 0.15;
    if (d.faim > 80) o.steer += Math.sin(t * 1.3) * 0.12 * (d.faim - 80) / 20;
    if (d.envie > 85) o.steer += Math.sin(t * 5) * 0.12;
    o.steer = clamp(o.steer, -1, 1);
    return o;
  }

  startGag(id) {
    const G = GAGS[id], d = this.drv;
    this.gag = { id, t: 0 };
    this.say(`${G.icon} ${G.text}` + (G.fix ? ` <b>→ ${G.fixText}</b>` : ''), G.fix ? 'red' : '');
    if (id === 'sneeze') { this.jolt = (Math.random() < 0.5 ? -1 : 1) * 1.0; this.joltT = 0.35; this.game.audio?.sneeze?.(); if (this.game.player) this.game.player.horn = true; setTimeout(() => this.game.player && (this.game.player.horn = false), 400); }
    if (id === 'sing') { d.moral = Math.min(100, d.moral + 25); this.game.audio?.sing?.(); }
    if (id === 'bee') this.game.audio?.buzz?.(true);
    if (id === 'hiccup') this.hicT = 0.5;
  }
  endGag(text) {
    if (!this.gag) return;
    if (this.gag.id === 'horn' && this.game.player) this.game.player.hornStuck = 0;
    if (this.gag.id === 'hitch') this.say('🧳 Jean-Kévin saute du camion en marche en criant « MERCI ! ». Il atterrit dans un champ. Il va bien.');
    if (this.gag.id === 'bee') this.game.audio?.buzz?.(false);
    if (text) this.say(text);
    this.gag = null;
  }

  // ---------- actions du copilote ----------
  action(id, who = 'local') {
    const g = this.game, d = this.drv, c = this.cop, v = g.player;
    if (!v) return;
    switch (id) {
      case 'sandwich':
        if (this.prep) return;
        if (this.sandwiches <= 0) return this.say(`${c.name} : « Plus de sandwichs ! Faut s’arrêter à une aire. »`);
        this.sandwiches--; this.prep = { t: 2.2, what: 'sandwich' };
        this.say(`${c.name} prépare un sandwich… (jambon-beurre-cornichons-mystère)`);
        break;
      case 'coffee':
        if (this.prep) return;
        this.prep = { t: 1.6, what: 'coffee' }; this.say(`${c.name} verse un café… en essayant de ne pas en mettre partout.`);
        break;
      case 'slap':
        if (d.asleep > 0 || d.micro > 0) {
          this.slapN++;
          g.audio?.slap?.();
          if (this.slapN >= 3 || d.micro > 0) { d.asleep = 0; d.micro = 0; d.fatigue = Math.max(0, d.fatigue - 25); this.slapN = 0; this.say(`👋 ${d.name} : « HEIN ?! QUOI ?! J’DORMAIS PAS ! »`); g.camRig.shake = 0.6; }
          else this.say(`👋 PAF ! (${3 - this.slapN} de plus…)`);
        } else if (this.gag && GAGS[this.gag.id].fix === 'slap') {
          g.audio?.slap?.();
          const t = { bee: `👋 SPLAT. L’abeille n’est plus. ${d.name} a aussi pris la gifle.`, map: '🗺️ Carte repliée… à peu près.', stink: '🪟 Fenêtres ouvertes : ça caille mais on respire.', phone: '📱 Téléphone balancé par la fenêtre. Belle-maman parle encore dans le fossé.', spill: '🚪 Portes refermées ! Il reste… une bonne partie du fromage.', horn: '📯 BAM sur le volant. Le klaxon se tait. Enfin.' }[this.gag.id];
          this.endGag(t);
        } else { g.audio?.slap?.(); d.moral = Math.max(0, d.moral - 10); this.say(`👋 ${d.name} : « Aïe ! Pourquoi tu m’as frappé ?! »`); }
        break;
      case 'radio':
        this.station = (this.station + 1) % STATIONS.length;
        g.audio?.music?.(STATIONS[this.station].id);
        g.hud.toast('📻 ' + STATIONS[this.station].name);
        break;
      case 'banana': {
        if (this.roof) return this.action('throw', who);
        if (this.bananas <= 0) return this.say(`${c.name} : « Plus de bananes ! »`);
        if (this.banCd > g.time) return;
        this.banCd = g.time + 1.0; this.bananas--;
        g.dropBanana(v);
        this.say(`🍌 ${c.name} lance une peau de banane par la fenêtre !`);
        break;
      }
      case 'cb':
        if (this.cbCd > 0) return g.hud.toast(`Fausse info disponible dans ${Math.ceil(this.cbCd)} s`);
        this.cbCd = 40;
        g.confusePolice(9);
        const lies = ['« Ici le camion… euh non, ici l’unité 4 : le suspect est parti vers PARIS ! »', '« Alerte : troupeau de vaches sur l’A77, ralentissez ! » 🐄', '« Le suspect a changé de véhicule : il est en TRACTEUR TONDEUSE. »', '« Code 12 ! Code 12 ! (personne ne sait ce que c’est) »'];
        this.say(`📢 ${c.name} à la CB : ${lies[Math.floor(Math.random() * lies.length)]}`);
        break;
      case 'swap': this.swap(); break;
      case 'roof':
        if (v.kmh > 95) return this.say(`${c.name} : « À cette vitesse ?! Ralentis d’abord ! »`);
        this.roof = !this.roof; this.boxes = this.roof ? 10 : this.boxes;
        this.say(this.roof ? `🧗 ${c.name} ouvre la fenêtre et grimpe sur ${v.trailer ? 'la remorque' : 'le toit'} ! (clic / 5 : lancer un carton, 8 : redescendre)` : `🧗 ${c.name} se laisse retomber dans la cabine. Ouf.`);
        break;
      case 'throw':
        if (!this.roof || (this.boxes ?? 0) <= 0) return;
        if ((this.thrCd || 0) > g.time) return; this.thrCd = g.time + 0.5; this.boxes--;
        { const t = v.trailer, src = t ? new THREE.Vector3(0, 4.3, -v.def.trailer.len + 2).applyQuaternion(t.curQuat).add(t.curPos) : new THREE.Vector3(0, v.def.h + 0.4, -v.def.len / 2).applyQuaternion(v.curQuat).add(v.curPos);
          const back = new THREE.Vector3(0, 0, -1).applyQuaternion(t ? t.curQuat : v.curQuat);
          g.spawnProp('box', src, { x: v.lastV.x + back.x * 9, y: 3, z: v.lastV.z + back.z * 9 }); }
        break;
      case 'push': break;
    }
    g.netCoopAction?.(id, who);
  }

  finishPrep() {
    const d = this.drv, what = this.prep.what; this.prep = null;
    if (what === 'sandwich') {
      d.faim = Math.max(0, d.faim - 45); d.moral = Math.min(100, d.moral + 10);
      if (Math.random() < 0.22) { this.say(`🥪 ${d.name} croque… « Il était au thon, ce sandwich ? Il sent bizarre… »`); this.startGag('hiccup'); }
      else this.say(`🥪 ${d.name} : « Mmmh ! » (miettes partout dans la cabine)`);
    } else {
      d.fatigue = Math.max(0, d.fatigue - 35); d.envie = Math.min(100, d.envie + 32); this.jitter = 7;
      this.say(`☕ ${d.name} avale le café cul-sec. Les mains tremblent un peu. Et la vessie se remplit.`);
    }
  }

  swap() {
    const g = this.game, v = g.player, a = this.drv, b = this.cop;
    if (this.swapT > 0) return;
    if (v.kmh < 12) { this.driver = 1 - this.driver; this.say(`🔁 Relais : ${b.name} prend le volant, ${a.name} s’installe côté passager.`); }
    else {
      this.driver = 1 - this.driver; this.swapT = 2.4;
      this.say(`🔁 RELAIS À LA VOLÉE à ${Math.round(v.kmh)} km/h ! ${b.name} enjambe ${a.name}… LE CAMION N’A PLUS DE CONDUCTEUR !!!`, 'red');
      g.camRig.shake = 1.2;
    }
    this.chars[this.driver].asleep = 0; this.chars[this.driver].micro = 0;
    g.onCoopSwap?.();
  }

  aiCopilot(dt, v) {
    this.aiT -= dt; if (this.aiT > 0) return;
    this.aiT = 0.8 + Math.random() * 1.2;
    const d = this.drv, g = this.game;
    if (this.gag && ['spill', 'horn'].includes(this.gag.id) && this.gag.t > 2) return this.action('slap', 'ai');
    if (d.asleep > 0 || (d.micro > 0 && Math.random() < 0.5)) return this.action('slap', 'ai');
    if (this.gag && GAGS[this.gag.id].fix === 'slap' && this.gag.t > 2 + Math.random() * 2) return this.action('slap', 'ai');
    if (d.faim > 65 && this.sandwiches > 0 && !this.prep) return this.action('sandwich', 'ai');
    if (d.fatigue > 70 && d.envie < 50 && !this.prep) return this.action('coffee', 'ai');
    const pol = g.nearestPolice(v.curPos);
    if (pol.v && pol.d < 35 && pol.v.road.s < v.road.s && this.bananas > 0 && Math.random() < 0.5) return this.action('banana', 'ai');
    if (pol.v && pol.d < 120 && this.cbCd <= 0 && Math.random() < 0.15) return this.action('cb', 'ai');
    if (d.fatigue > 88 && this.cop.fatigue < 40 && v.kmh < 12) return this.action('swap', 'ai');
  }

  // ---------- interface ----------
  render() {
    const box = $('coop'); if (!box) return;
    const bar = (v, col) => `<i><b style="width:${v.toFixed(0)}%;background:${col}"></b></i>`;
    const ch = (c, i) => `<div class="cc ${i === this.driver ? 'drv' : ''}"><div class="cn">${i === this.driver ? '🚛 ' : '💺 '}${c.name}${this.humans[i] ? '' : ' <small>(IA)</small>'}${c.asleep > 0 || c.micro > 0 ? ' 😴' : ''}</div>
      <div class="cb"><span>Fatigue</span>${bar(c.fatigue, c.fatigue > 75 ? '#ff3b2f' : '#9fd0ff')}</div>
      <div class="cb"><span>Faim</span>${bar(c.faim, c.faim > 75 ? '#ff3b2f' : '#ffb35c')}</div>
      <div class="cb"><span>Envie</span>${bar(c.envie, c.envie > 75 ? '#ff3b2f' : '#ffe14d')}</div></div>`;
    const myRole = this.game.coopMyRole?.() ?? 'cop';
    $('coop-chars').innerHTML = ch(this.chars[0], 0) + ch(this.chars[1], 1) +
      `<div class="cc res"><div class="cb"><span>⛽ Gazole</span>${bar(this.fuel, this.fuel < 20 ? '#ff3b2f' : '#3fd07a')}</div><div class="cinv">🥪 ${this.sandwiches} · 🍌 ${this.bananas}${this.roof ? ' · 📦 ' + this.boxes : ''} · 📻 ${STATIONS[this.station].id === 'off' ? 'off' : STATIONS[this.station].id}</div>${this.prep ? `<div class="cinv">⏳ ${this.prep.what === 'sandwich' ? 'Sandwich' : 'Café'}…</div>` : ''}</div>`;
    const actsHtml = ACTIONS.map(a => `<button class="ca" data-a="${a.id}" title="${a.tip}"><kbd>${a.k}</kbd>${a.icon}<span>${a.name}${a.id === 'cb' && this.cbCd > 0 ? ' ' + Math.ceil(this.cbCd) : ''}</span></button>`).join('');
    if (actsHtml !== this._acts) { this._acts = actsHtml; $('coop-acts').innerHTML = actsHtml; } // ne reconstruire les boutons que s'ils changent (sinon le clic est perdu)
    $('coop-role').textContent = myRole === 'drv' ? 'Tu CONDUIS — ton pote gère la cabine' : myRole === 'cop' ? 'Tu es COPILOTE — clique les actions (ou touches 1-7)' : 'Coop à 2 sur ce PC : conducteur = clavier ZQSD, copilote = souris / touches 1-7';
    // effets visuels
    const d = this.drv;
    const sleepy = d.asleep > 0 ? 1 : d.micro > 0 ? 0.85 : clamp((d.fatigue - 80) / 40, 0, 0.35);
    $('eyelids').style.setProperty('--c', sleepy);
    $('zzz').classList.toggle('on', d.asleep > 0 || d.micro > 0);
    $('mapover').classList.toggle('on', this.gag?.id === 'map');
    $('greenfog').classList.toggle('on', this.gag?.id === 'stink');
    $('bee').classList.toggle('on', this.gag?.id === 'bee');
    $('poop').classList.toggle('on', this.gag?.id === 'pigeon');
    $('chaos').classList.toggle('on', this.swapT > 0);
    $('coop-acts').classList.toggle('roof', !!this.roof);
  }

  serialize() { return { r: this.roof ? 1 : 0, bx: this.boxes || 0, c: this.chars.map(c => [c.fatigue, c.faim, c.envie, c.asleep > 0 ? 1 : 0, c.micro > 0 ? 1 : 0].map(x => +x.toFixed(1))), d: this.driver, f: +this.fuel.toFixed(1), b: this.bananas, sw: this.sandwiches, st: this.station, g: this.gag?.id || '', s: +this.swapT.toFixed(2), p: this.prep?.what || '', cb: Math.ceil(this.cbCd) }; }
  apply(o) {
    o.c.forEach((a, i) => Object.assign(this.chars[i], { fatigue: a[0], faim: a[1], envie: a[2], asleep: a[3] ? 1 : 0, micro: a[4] ? 1 : 0 }));
    if (o.st !== this.station) this.game.audio?.music?.(STATIONS[o.st].id);
    this.roof = !!o.r; this.boxes = o.bx;
    Object.assign(this, { driver: o.d, fuel: o.f, bananas: o.b, sandwiches: o.sw, station: o.st, swapT: o.s, cbCd: o.cb });
    this.gag = o.g ? { id: o.g, t: 0 } : null; this.prep = o.p ? { what: o.p, t: 1 } : null;
  }
}
