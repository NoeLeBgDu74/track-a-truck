// Panneau créateur caché : taper « admin » au clavier (ou 5 tapes rapides dans le coin haut-droit), puis le code 1712.
// Rangé par onglets + recherche. Fonctionne dans tous les modes ; en ligne, l'onglet « Joueurs » permet de
// contrôler les autres joueurs (téléporter, geler, propulser, retourner, réparer, crever, message…).
import * as THREE from 'three';
import { profile, saveProfile, VEHICLES, UPGRADES, MISSIONS, ACHIEVEMENTS, DEST_S, TRAFFIC_TYPES, laneD, worldToRoad } from './config.js';
import { Brain, pickLine } from './brain.js';
import { MAT } from './models.js';

const CODE = '1712';
const css = `
#adm-lock,#adm{position:fixed;z-index:9999;font:13px system-ui,sans-serif;color:#e8ecf2}
#adm-lock{inset:0;background:rgba(5,8,14,.72);display:flex;align-items:center;justify-content:center}
#adm-lock .bx{background:#121822;border:1px solid #2c3a52;border-radius:12px;padding:18px 20px;text-align:center;box-shadow:0 10px 40px #0008}
#adm-lock input{font:700 22px monospace;letter-spacing:8px;width:130px;text-align:center;background:#0a0e15;color:#ffb347;border:1px solid #33435e;border-radius:8px;padding:6px;margin-top:10px}
#adm{top:10px;right:10px;width:380px;max-height:calc(100vh - 20px);display:flex;flex-direction:column;background:rgba(14,19,28,.95);border:1px solid #2c3a52;border-radius:12px;box-shadow:0 10px 40px #0009;backdrop-filter:blur(6px)}
#adm .hd{padding:10px 12px 6px;display:flex;gap:6px;align-items:center}#adm .hd b{color:#ffb347;font-size:14px;flex:1}
#adm .hd input{width:150px;background:#0a0e15;color:#fff;border:1px solid #33435e;border-radius:7px;padding:5px 8px;font:12px system-ui}
#adm .tabs{display:flex;flex-wrap:wrap;gap:4px;padding:0 12px 6px}
#adm .tabs button{padding:4px 7px;font-size:11.5px}#adm .tabs button.sel{background:#ffb347;color:#111;border-color:#ffb347}
#adm .body{overflow:auto;padding:4px 12px 10px}
#adm h4{margin:10px 0 4px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#7f8ca3}
#adm .grid{display:grid;grid-template-columns:1fr 1fr;gap:5px}
#adm button{margin:0;float:none;background:#1d2738;color:#e8ecf2;border:1px solid #33435e;border-radius:7px;padding:6px 8px;font:12px system-ui;cursor:pointer;text-align:left;line-height:1.25}
#adm .grid button small{display:block;color:#8d9ab0;font-size:10.5px}
#adm button:hover{background:#28354d}#adm button.on{background:#7a3f10;border-color:#ffb347}
#adm label{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:5px 0}
#adm input[type=range]{width:170px}#adm select{background:#1d2738;color:#e8ecf2;border:1px solid #33435e;border-radius:6px;padding:3px}
#adm .pl{border:1px solid #2c3a52;border-radius:9px;padding:7px;margin:6px 0}#adm .pl .nm{font-weight:700;margin-bottom:5px}
#adm .st{font:11px monospace;color:#9fb0c8;white-space:pre-wrap;background:#0a0e15;border-radius:6px;padding:6px;margin-top:8px}
#adm .empty{color:#7f8ca3;padding:8px 0}
@media (max-width:560px){#adm{left:8px;right:8px;width:auto;max-height:70vh}#adm .hd input{width:110px}}`;

const TABS = [['joueur', '🚛 Joueur'], ['police', '🚔 Police'], ['trafic', '🚗 Trafic'], ['monde', '🌦️ Monde'], ['fun', '🤪 Fun'], ['joueurs', '🌐 Joueurs'], ['partie', '🏁 Partie'], ['profil', '💰 Profil'], ['infos', 'ℹ️ Infos']];

export class Admin {
  constructor(game) {
    this.g = game; this.open = false; this.ok = false; this.buf = ''; this.taps = []; this.tab = 'joueur'; this.q = '';
    this.flags = {};
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    addEventListener('keydown', e => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.key.length === 1) { this.buf = (this.buf + e.key.toLowerCase()).slice(-5); if (this.buf === 'admin') { this.buf = ''; this.toggle(); } }
    });
    addEventListener('pointerdown', e => {
      if (e.clientX < innerWidth - 60 || e.clientY > 60) return;
      const t = performance.now(); this.taps = this.taps.filter(x => t - x < 2500); this.taps.push(t);
      if (this.taps.length >= 5) { this.taps = []; this.toggle(); }
    });
    this.cmds = this.defineCommands();
  }

  toggle() { if (!this.ok) return this.askCode(); this.open = !this.open; if (this.open) this.build(); else this.el?.remove(); }
  askCode() {
    if (document.getElementById('adm-lock')) return;
    const d = document.createElement('div'); d.id = 'adm-lock';
    d.innerHTML = `<div class="bx">🔒 <b>Accès créateur</b><br><input type="password" inputmode="numeric" maxlength="4" autocomplete="off"><div style="margin-top:8px;color:#7f8ca3;font-size:11px">Échap pour annuler</div></div>`;
    document.body.appendChild(d);
    const inp = d.querySelector('input'); setTimeout(() => inp.focus(), 30);
    inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') d.remove(); });
    inp.addEventListener('keyup', e => e.stopPropagation());
    inp.addEventListener('input', () => {
      if (inp.value.length < 4) return;
      if (inp.value === CODE) { this.ok = true; d.remove(); this.open = true; this.build(); this.toast('🛠️ Mode créateur activé'); }
      else { inp.value = ''; inp.style.borderColor = '#e04040'; setTimeout(() => d.remove(), 500); }
    });
    d.addEventListener('pointerdown', e => { if (e.target === d) d.remove(); });
  }
  pl() { return this.g.player; }
  toast(t) { this.g.hud?.toast(t); }
  canLocal() { if (this.g.mirror) { this.toast('Indisponible pour l’invité en coop (c’est l’hôte qui gère le monde)'); return false; } return true; }

  // ---------- catalogue des commandes ----------
  defineCommands() {
    const g = this.g, C = [];
    const add = (tab, id, icon, label, desc, fn, toggle) => C.push({ tab, id, icon, label, desc, fn, toggle });
    const tp = ds => { const v = this.pl(); if (!v || !this.canLocal()) return; v.resetOnRoad(Math.max(0, v.road.s + ds), v.road.d); };
    // Joueur
    add('joueur', 'god', '🛡️', 'Invincible', 'Aucun dégât, jamais arrêté', null, true);
    add('joueur', 'turbo', '🚀', 'Turbo x2', 'Double puissance moteur', null, true);
    add('joueur', 'repair', '🔧', 'Réparer', 'Carrosserie, pneus, moteur', () => { const v = this.pl(); if (v) { v.damage = 0; v.disabled = false; v.flat = 0; v.spikes = 0; } this.toast('Réparé'); });
    add('joueur', 'flip', '↩️', 'Remettre sur roues', 'Si tu es sur le toit', () => { const v = this.pl(); if (v && this.canLocal()) v.resetOnRoad(v.road.s, v.road.d); });
    add('joueur', 'tp1', '⏩', '+1 km', 'Téléporte en avant', () => tp(1000));
    add('joueur', 'tp5', '⏭️', '+5 km', 'Téléporte loin devant', () => tp(5000));
    add('joueur', 'tpback', '⏪', '−1 km', 'Téléporte en arrière', () => tp(-1000));
    add('joueur', 'tpdest', '🏁', 'Devant l’arrivée', 'À 150 m de la plateforme', () => { const v = this.pl(); if (v) tp(DEST_S - 150 - v.road.s); });
    add('joueur', 'fuel', '⛽', 'Plein + sandwichs', 'Coop : gazole, faim, fatigue', () => { const c = g.coop; if (!c) return this.toast('Seulement en coop'); c.fuel = 100; c.sandwiches = 9; c.bananas = 9; c.chars.forEach(ch => { ch.fatigue = 0; ch.faim = 0; ch.envie = 0; }); this.toast('Plein fait, équipage en forme'); });
    add('joueur', 'launch', '🦘', 'Saut', 'Fait sauter ton véhicule', () => this.launch(this.pl(), 10));
    // Police
    add('police', 'freeze', '🧊', 'Figer la police', 'Toutes les unités s’arrêtent', null, true);
    add('police', 'ghostPol', '👻', 'Police aveugle', 'Elle zigzague et te perd', null, true);
    add('police', 'pol2', '➕', '+2 voitures', 'Renforts derrière toi', () => { const v = this.pl(); if (!v || !this.canLocal()) return; for (const k of [-1, 1]) g.addPolice(v.road.s - 90, v.road.d + k * 3.5, 'chase'); });
    add('police', 'polmoto', '🏍️', '+3 motards', 'Motards de la gendarmerie', () => { const v = this.pl(); if (!v || !this.canLocal()) return; const w = g.wanted; g.wanted = 5; for (let i = 0; i < 3; i++) g.addPolice(v.road.s - 70 - i * 15, v.road.d + (i - 1) * 3.5, 'chase'); g.wanted = w; });
    add('police', 'polback', '↩️', 'Police à 600 m', 'Repousse toutes les unités', () => { const v = this.pl(); for (const p of g.police || []) if (p.v !== v && v) p.v.resetOnRoad(Math.max(0, v.road.s - 600 - Math.random() * 80), p.v.road.d); });
    add('police', 'polkill', '💥', 'Toutes HS', 'Toutes les unités hors service', () => { for (const p of g.police || []) if (p.v !== this.pl()) { p.v.damage = 100; if (!p.v.disabled) { p.v.disabled = true; g.onDisabled?.(p.v); } } });
    add('police', 'heat0', '🟢', 'Recherche 0', 'Plus personne ne te cherche', () => { g.heat = 0; g.bust = 0; g.wanted = 0; });
    add('police', 'heatmax', '🔥', 'Recherche max', '5 étoiles, tout le monde', () => { g.heat = 100; g.wanted = 5; g.released = true; });
    add('police', 'heli', '🚁', 'Hélico', 'Envoie l’hélicoptère', () => { g.heliOn = true; if (g.heli) g.heli.visible = true; });
    add('police', 'spike', '⛓️', 'Herse devant', 'À 120 m devant toi', () => { const v = this.pl(); if (v && this.canLocal()) g.addSpike(v.road.s + 120, v.road.d, 7); });
    add('police', 'block', '🚧', 'Barrage', 'Barrage 1 km devant', () => { if (!this.canLocal()) return; g.blockDone = false; g.nextBlock = 0; g.released = true; });
    add('police', 'patrol', '🚓', 'Contrôle maintenant', 'Mode libre : une patrouille te fait ranger', () => { if (g.mode !== 'free') return this.toast('Seulement en mode libre'); g.patrol = { next: 0, flashed: 0 }; });
    add('police', 'release', '📣', 'Lancer la poursuite', 'Fin du contrôle / du délai', () => { if (g.check) g.checkBreak?.('Ordre de la centrale : interpellez-le !'); else g.headStart = g.time; });
    // Trafic
    add('trafic', 'noTraffic', '🚫', 'Vider le trafic', 'Plus aucun véhicule civil', null, true);
    add('trafic', 'spawn10', '🚗', '+10 voitures', 'Devant toi', () => { const v = this.pl(); if (!v || !this.canLocal()) return; for (let i = 0; i < 10; i++) g.traffic.trySpawn?.(v.road.s + 150 + Math.random() * 600, true); });
    add('trafic', 'motos', '🏍️', '+8 motos', 'Une bande de motards', () => { const v = this.pl(); if (!v || !this.canLocal()) return; const T = TRAFFIC_TYPES.find(t => t.moto); for (let i = 0; i < 8; i++) g.traffic.spawn(v.road.s + 60 + i * 14, 1, i % 3, { type: T }); });
    add('trafic', 'trucks', '🚛', 'Convoi de camions', '6 semi-remorques devant', () => { const v = this.pl(); if (!v || !this.canLocal()) return; const T = TRAFFIC_TYPES.find(t => t.kind === 'truck'); for (let i = 0; i < 6; i++) g.traffic.spawn(v.road.s + 80 + i * 30, 1, 1 + (i % 2), { type: T }); });
    add('trafic', 'pileup', '💥', 'Carambolage', '5 véhicules accidentés devant', () => { const v = this.pl(); if (!v || !this.canLocal() || g.netTraffic) return; const cars = g.traffic.cars.filter(c => !c.wreck && c.s > v.road.s + 40 && c.s < v.road.s + 400).slice(0, 5); cars.forEach((c, i) => g.traffic.makeWreck(c, (Math.random() - 0.5) * 14, Math.sign(Math.cos(c.curYaw)) * (10 + i * 2), { rvx: (Math.random() - 0.5) * 20, rvz: (Math.random() - 0.5) * 20, rel: 14 })); this.toast(`💥 ${cars.length} véhicules`); });
    add('trafic', 'panic', '😱', 'Panique générale', 'Tout le monde s’affole', () => { for (const c of g.traffic.cars) if (!c.wreck) { c.feel = 'panic'; c.feelT = 8; c.hazard = 6; } this.talkAll('panique'); });
    add('trafic', 'honk', '📯', 'Concert de klaxons', 'Tous les voisins klaxonnent', () => { const v = this.pl(); g.traffic.cars.filter(c => v && c.cur.distanceTo(v.curPos) < 150).slice(0, 12).forEach((c, i) => setTimeout(() => g.audio?.honkAt?.(c.cur, c.type.trucks), i * 140)); });
    add('trafic', 'talkall', '💬', 'Faire parler tout le monde', 'Les PNJ proches disent un truc (IA)', () => this.talkAll());
    add('trafic', 'services', '🚑', 'Secours sur place', 'Ambulance + pompiers + dépanneuse', () => { const v = this.pl(); if (!v || !this.canLocal()) return; const w = g.traffic.cars.find(c => c.wreck && Math.abs(c.s - v.road.s) < 400); g.services.report({ s: (w?.s) ?? v.road.s + 80, dir: w?.dir ?? 1, severe: true, cars: w ? [w] : [], hurt: w?.ped ? [w.ped] : [] }); const i = g.services.incidents.at(-1); if (i) { i.ambT = 1; i.fireT = 2; i.towT = 6; } });
    // Monde
    add('monde', 'day', '☀️', 'Plein jour', '13 h', () => { g.env.cycle = false; g.env.timeOfDay = 13; g.env.envDirty = true; });
    add('monde', 'night', '🌙', 'Nuit noire', 'Minuit', () => { g.env.cycle = false; g.env.timeOfDay = 0; g.env.envDirty = true; });
    add('monde', 'storm', '⛈️', 'Orage', 'Pluie battante', () => g.env.setWeather('storm'));
    add('monde', 'fog', '🌫️', 'Brouillard', 'Visibilité nulle', () => g.env.setWeather('fog'));
    add('monde', 'clear', '🌤️', 'Beau temps', 'Ciel dégagé', () => g.env.setWeather('clear'));
    add('monde', 'moon', '🌕', 'Gravité lunaire', 'Tout flotte (sauts géants)', null, true);
    add('monde', 'evboar', '🐗', 'Sangliers', 'Une harde traverse 300 m devant', () => { const v = this.pl(); if (v && this.canLocal()) this.g.events.spawn(v.road.s + 300, 'boars'); });
    add('monde', 'evcow', '🐄', 'Vache échappée', 'Marguerite sur l’autoroute', () => { const v = this.pl(); if (v && this.canLocal()) this.g.events.spawn(v.road.s + 300, 'cow'); });
    add('monde', 'evload', '📦', 'Chargement perdu', 'Matelas et cartons sur une voie', () => { const v = this.pl(); if (v && this.canLocal()) this.g.events.spawn(v.road.s + 300, 'load'); });
    add('monde', 'slow', '🐢', 'Ralenti 4 s', 'Effet cinéma', () => { g.slow = 4; document.body.classList.add('slowmo'); });
    // Fun
    add('fun', 'cheese', '🧀', 'Pluie de fromages', '30 meules tombent du ciel', () => { const v = this.pl(); if (!v || !this.canLocal()) return; for (let i = 0; i < 30; i++) setTimeout(() => { const p = v.curPos; g.spawnProp?.('cheese', new THREE.Vector3(p.x + (Math.random() - 0.5) * 40, 18 + Math.random() * 10, p.z + (Math.random() - 0.5) * 40), { x: 0, y: -2, z: 0 }); }, i * 60); });
    add('fun', 'giant', '🦖', 'Camion géant', 'Visuel x2 (la physique ne change pas)', null, true);
    add('fun', 'mini', '🐭', 'Camion mini', 'Visuel x0,5', null, true);
    add('fun', 'pink', '🩷', 'Monde rose', 'Toutes les carrosseries en rose', null, true);
    add('fun', 'boom', '💣', 'Onde de choc', 'Projette tout ce qui est autour', () => this.shockwave());
    add('fun', 'ufo', '🛸', 'OVNI', 'Enlève la voiture de police la plus proche', () => this.ufo());
    add('fun', 'dance', '🕺', 'La police danse', 'Les unités tournent sur elles-mêmes', null, true);
    add('fun', 'drunk', '🍷', 'Caméra ivre', 'La caméra tangue', null, true);
    add('fun', 'confetti', '🎉', 'Confettis', 'Explosion de couleurs', () => { const v = this.pl(); if (!v) return; for (let i = 0; i < 120; i++) g.particles?.emit(v.curPos.x, 4, v.curPos.z, (Math.random() - 0.5) * 14, 4 + Math.random() * 8, (Math.random() - 0.5) * 14, 2.5, 0.12, 0, [0xff3060, 0x30c0ff, 0xffd020, 0x60ff80, 0xc070ff][i % 5], 1); });
    // Partie
    add('partie', 'win', '🏆', 'Gagner', 'Termine la partie (victoire)', () => { if (g.state === 'play' && !g.mirror) g.finish(true, 'Victoire (créateur)', 'Partie terminée depuis le panneau créateur.'); });
    add('partie', 'lose', '💀', 'Perdre', 'Termine la partie (défaite)', () => { if (g.state === 'play' && !g.mirror) g.finish(false, 'Défaite (créateur)', 'Partie terminée depuis le panneau créateur.'); });
    add('partie', 'time', '⏱️', '+60 s', 'Plus de temps', () => { g.timeLeft = (g.timeLeft || 0) + 60; });
    add('partie', 'gadgets', '🎒', 'Gadgets pleins', 'Huile, clous, fumigènes… à 9', () => { if (g.coop) Object.assign(g.coop, { oil: 9, nails: 9, smoke: 9, paint: 9, cones: 9, crackers: 9, detour: 9, bananas: 9, sandwiches: 9, fuel: 100 }); if (g.fugGad) Object.assign(g.fugGad, { oil: 9, nails: 9, smoke: 9, paint: 9, cones: 9, crackers: 9 }); this.toast('Gadgets à 9'); });
    add('partie', 'arrestme', '🚨', 'Scène d’arrestation', 'Se faire interpeller tout de suite', () => { if (this.pl() && g.mode !== 'free') { this.flags.god = false; this.pl().disabled = true; } else this.toast('Pas en mode libre'); });
    // Profil
    add('profil', 'money', '💰', '+10 000 €', 'Argent de carrière', () => { profile.money += 10000; saveProfile(); });
    add('profil', 'unlock', '🔓', 'Tout débloquer', 'Missions, améliorations, succès', () => {
      for (const m of MISSIONS) profile.stars[m.id] = Math.max(profile.stars[m.id] || 0, 3);
      for (const id of Object.keys(VEHICLES)) { profile.up[id] ||= {}; for (const k of Object.keys(UPGRADES)) profile.up[id][k] = Math.max(profile.up[id][k] || 0, UPGRADES[k].cost.length); }
      for (const a of ACHIEVEMENTS) profile.ach[a.id] ||= Date.now(); saveProfile(); this.toast('Tout est débloqué (relance la partie)'); });
    add('profil', 'reset', '🗑️', 'Effacer le profil', 'Argent, étoiles, améliorations', () => { if (confirm('Effacer tout le profil ?')) { localStorage.removeItem('tat_profile'); location.reload(); } });
    return C;
  }

  // ---------- interface ----------
  build() {
    this.el?.remove();
    const el = this.el = document.createElement('div'); el.id = 'adm';
    el.innerHTML = `<div class="hd"><b>🛠️ Créateur</b><input placeholder="🔎 Chercher…" value="${this.q}"><button data-close>✕</button></div>
<div class="tabs">${TABS.map(([k, n]) => `<button data-tab="${k}" class="${k === this.tab && !this.q ? 'sel' : ''}">${n}</button>`).join('')}</div><div class="body"></div>`;
    document.body.appendChild(el);
    ['keydown', 'keyup'].forEach(t => el.addEventListener(t, e => e.stopPropagation()));
    const search = el.querySelector('.hd input');
    search.addEventListener('input', () => { this.q = search.value.trim().toLowerCase(); this.renderBody(); el.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('sel', !this.q && b.dataset.tab === this.tab)); });
    el.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.close != null) { this.open = false; el.remove(); return; }
      if (b.dataset.tab) { this.tab = b.dataset.tab; this.q = ''; search.value = ''; el.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('sel', x === b)); this.renderBody(); return; }
      if (b.dataset.cmd) { const c = this.cmds.find(x => x.id === b.dataset.cmd); if (c.toggle) { this.flags[c.id] = !this.flags[c.id]; b.classList.toggle('on', this.flags[c.id]); this.onToggle(c.id); } else c.fn(); return; }
      if (b.dataset.rc) this.remoteCmd(b.dataset.to, b.dataset.rc);
    });
    el.addEventListener('input', e => {
      const r = e.target.dataset.r;
      if (r === 'tod') { this.g.env.cycle = false; this.g.env.timeOfDay = +e.target.value; this.g.env.envDirty = true; }
      if (r === 'speed') this.g.timeScale = +e.target.value;
    });
    this.renderBody();
  }
  btn(c) { return `<button data-cmd="${c.id}" class="${c.toggle && this.flags[c.id] ? 'on' : ''}">${c.icon} ${c.label}<small>${c.desc}</small></button>`; }
  renderBody() {
    const body = this.el?.querySelector('.body'); if (!body) return;
    if (this.q) { const hits = this.cmds.filter(c => (c.label + ' ' + c.desc + ' ' + c.tab).toLowerCase().includes(this.q)); body.innerHTML = hits.length ? `<h4>Résultats (${hits.length})</h4><div class="grid">${hits.map(c => this.btn(c)).join('')}</div>` : '<div class="empty">Aucune commande ne correspond.</div>'; return; }
    const list = this.cmds.filter(c => c.tab === this.tab);
    let h = list.length ? `<div class="grid">${list.map(c => this.btn(c)).join('')}</div>` : '';
    if (this.tab === 'monde') h += `<h4>Réglages</h4><label>Heure <input type="range" min="0" max="24" step="0.25" data-r="tod" value="${this.g.env.timeOfDay}"></label><label>Vitesse du jeu <input type="range" min="0.2" max="2" step="0.1" data-r="speed" value="${this.g.timeScale || 1}"></label>`;
    if (this.tab === 'joueurs') h = this.playersHTML();
    if (this.tab === 'infos') h = `<div class="st" id="adm-st">…</div><h4>Raccourcis</h4><div class="st">admin + 1712 : ce panneau · T : parler aux PNJ · F : descendre / remonter · C : caméra · R : repositionner · V : radio CB (en ligne) · Échap : pause</div>`;
    body.innerHTML = h;
  }
  playersHTML() {
    const n = this.g.net; const ps = n?.room ? [...n.players.values()].filter(p => p.id !== n.id) : [];
    if (!ps.length) return '<div class="empty">Aucun autre joueur connecté. Lance une partie en ligne (Multijoueur) pour contrôler les autres joueurs.</div>';
    const acts = [['tpme', '🧲 Amener à moi'], ['goto', '📍 Aller à lui'], ['freeze', '🧊 Geler 6 s'], ['launch', '🚀 Propulser'], ['flip', '🙃 Retourner'], ['repair', '🔧 Réparer'], ['flat', '📌 Crever'], ['slow', '🐌 Ralentir 10 s'], ['invert', '🔀 Direction inversée 10 s'], ['ghost', '👻 Invisible 10 s'], ['cheese', '🧀 Fromages'], ['msg', '📢 Message']];
    const block = (id, name) => `<div class="pl"><div class="nm">${name}</div><div class="grid">${acts.map(([k, l]) => `<button data-rc="${k}" data-to="${id}">${l}</button>`).join('')}</div></div>`;
    return block('all', '👥 Tous les joueurs') + ps.map(p => block(p.id, `🎮 ${p.name || p.id.slice(0, 6)} — ${p.team === 'police' ? 'police' : 'camion'}`)).join('');
  }

  // ---------- multijoueur : commandes envoyées aux autres ----------
  remoteCmd(to, cmd) {
    const g = this.g, n = g.net; let arg = null;
    if (cmd === 'msg') { arg = prompt('Message à afficher sur son écran :'); if (!arg) return; }
    if (cmd === 'tpme' && g.player) { const p = g.player.curPos; arg = { x: p.x, z: p.z, s: g.player.road.s, d: g.player.road.d }; }
    if (cmd === 'goto') { const r = g.remotes?.get(to); if (r && g.player) { const rr = worldToRoad(r.curPos.x, r.curPos.z, {}); g.player.resetOnRoad(rr.s - 25, rr.d); } else this.toast('Joueur introuvable'); return; }
    n.send({ t: 'adm', to, cmd, arg, by: n.me?.name || 'Créateur' });
    this.toast('Commande envoyée');
  }
  // reçu d'un autre joueur
  remote(m) {
    const g = this.g, v = g.player;
    if (m.to !== 'all' && m.to !== g.net?.id) return;
    g.hud?.msg(`🛠️ <b>${m.by}</b> a utilisé : ${m.cmd}`);
    if (!v) return;
    switch (m.cmd) {
      case 'tpme': if (m.arg && !g.mirror) v.resetOnRoad(m.arg.s - 20 - Math.random() * 20, m.arg.d + (Math.random() - 0.5) * 4); break;
      case 'freeze': this.frozenT = 6; break;
      case 'launch': this.launch(v, 14); break;
      case 'flip': if (!g.mirror) { const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(Math.cos(v.yaw), 0, -Math.sin(v.yaw)), Math.PI); const b = v.body, r = b.rotation(); const nq = q.multiply(new THREE.Quaternion(r.x, r.y, r.z, r.w)); b.setRotation({ x: nq.x, y: nq.y, z: nq.z, w: nq.w }, true); b.setTranslation({ x: v.curPos.x, y: v.curPos.y + 2.5, z: v.curPos.z }, true); } break;
      case 'repair': v.damage = 0; v.disabled = false; v.flat = 0; v.spikes = 0; break;
      case 'flat': v.spikes = 1; break;
      case 'slow': this.slowT = 10; break;
      case 'invert': this.invertT = 10; break;
      case 'ghost': this.ghostT = 10; break;
      case 'cheese': for (let i = 0; i < 20; i++) setTimeout(() => g.spawnProp?.('cheese', new THREE.Vector3(v.curPos.x + (Math.random() - 0.5) * 30, 16, v.curPos.z + (Math.random() - 0.5) * 30), { x: 0, y: -2, z: 0 }), i * 70); break;
      case 'msg': g.hud?.big(String(m.arg).slice(0, 40)); g.hud?.msg(`📢 <b>${m.by}</b> : ${String(m.arg).slice(0, 160)}`); break;
    }
  }

  // ---------- effets ----------
  launch(v, up) { if (!v || this.g.mirror) return; v.noClamp = 2; const lv = v.body.linvel(); v.body.setLinvel({ x: lv.x, y: up, z: lv.z }, true); if (v.trailer) { const t = v.trailer.body.linvel(); v.trailer.body.setLinvel({ x: t.x, y: up, z: t.z }, true); v.trailer.noClamp = 2; } }
  shockwave() {
    const g = this.g, v = this.pl(); if (!v || !this.canLocal() || g.netTraffic) return;
    for (const c of g.traffic.cars) { const dx = c.cur.x - v.curPos.x, dz = c.cur.z - v.curPos.z, d = Math.hypot(dx, dz); if (d < 45 && d > 1) g.traffic.makeWreck(c, dx / d * (30 - d * 0.4), dz / d * (30 - d * 0.4), { rvx: -dx / d * 20, rvz: -dz / d * 20, rel: 16 }); }
    for (const p of g.police || []) if (p.v !== v) { const dx = p.v.curPos.x - v.curPos.x, dz = p.v.curPos.z - v.curPos.z, d = Math.hypot(dx, dz); if (d < 45) { p.v.noClamp = 2; p.v.body.setLinvel({ x: dx / d * 22, y: 8, z: dz / d * 22 }, true); } }
    for (let i = 0; i < 60; i++) g.particles?.emit(v.curPos.x, 1, v.curPos.z, (Math.random() - 0.5) * 30, Math.random() * 6, (Math.random() - 0.5) * 30, 1.2, 1, 3, 0xffb040, 0.6);
    g.audio?.crash?.(v.curPos, 10);
  }
  ufo() {
    const g = this.g, v = this.pl(); if (!this.canLocal()) return;
    const p = (g.police || []).filter(p => p.v !== v).sort((a, b) => a.v.curPos.distanceTo(v.curPos) - b.v.curPos.distanceTo(v.curPos))[0];
    if (!p) return this.toast('Aucune voiture de police');
    const disc = new THREE.Group(); const m = new THREE.MeshStandardMaterial({ color: 0xb8c0cc, metalness: 0.9, roughness: 0.25 });
    disc.add(new THREE.Mesh(new THREE.CylinderGeometry(5, 7, 1.2, 32), m)); const dome = new THREE.Mesh(new THREE.SphereGeometry(2.4, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x80ffd0, emissive: 0x30ff90, emissiveIntensity: 0.6, transparent: true, opacity: 0.7 })); dome.position.y = 0.5; disc.add(dome);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(3, 4.5, 30, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x60ffb0, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })); beam.position.y = -15; disc.add(beam);
    g.scene.add(disc); const car = p.v; car.ufo = true; let t = 0;
    g.say?.('ufo', `${car.name} : « Euh… centrale ? Il y a une soucoupe… AU SECOURS ! »`, 5);
    const tick = () => { t += 0.016; disc.position.set(car.curPos.x, 30 + Math.sin(t * 2) * 0.5, car.curPos.z); disc.rotation.y += 0.05;
      if (t > 1.5 && car.body) { car.noClamp = 2; car.body.setLinvel({ x: 0, y: Math.min(12, (t - 1.5) * 6), z: 0 }, true); car.body.setAngvel({ x: 0, y: 2, z: 0 }, true); }
      if (t > 6) { g.scene.remove(disc); const i = g.police.indexOf(p); if (i >= 0) { g.police.splice(i, 1); car.dispose(); g.vehicles = g.vehicles.filter(x => x !== car); } this.toast('🛸 Unité enlevée !'); return; }
      requestAnimationFrame(tick); };
    tick();
  }
  talkAll(cat) {
    const g = this.g, v = this.pl(); if (!v) return;
    const cats = ['panique', 'colere', 'peur', 'helico', 'appel_phares', 'temoin'];
    g.bubbleList = [];
    g.traffic.cars.filter(c => !c.wreck && c.cur.distanceTo(v.curPos) < 120).slice(0, 4).forEach((c, i) => setTimeout(() => g.bubble?.(c, pickLine(cat || cats[Math.floor(Math.random() * cats.length)], ['Quoi ?!', 'Hein ?', 'C’est pas vrai…'])), i * 300));
  }
  onToggle(k) {
    const g = this.g, on = this.flags[k], v = this.pl();
    if (k === 'noTraffic' && on && !g.netTraffic && !g.mirror) g.traffic.clear();
    if (k === 'god' && !on && v) v.armor = 1;
    if (k === 'moon') g.phys.gravity = { x: 0, y: on ? -1.62 : -9.81, z: 0 };
    if ((k === 'giant' || k === 'mini') && v) { if (on) this.flags[k === 'giant' ? 'mini' : 'giant'] = false; const s = this.flags.giant ? 2 : this.flags.mini ? 0.5 : 1; v.mesh.scale.setScalar(s); if (v.trailer) v.trailer.mesh.scale.setScalar(s); this.renderBody(); }
    if (k === 'pink') { MAT.paint.color.set(on ? 0xff8ad0 : 0xffffff); MAT.paint.needsUpdate = true; }
  }

  // ---------- à chaque pas ----------
  step(dt) {
    const g = this.g, v = g.player, F = this.flags;
    if (v) {
      if (F.god) { v.armor = 0; v.damage = 0; v.disabled = false; g.bust = 0; }
      if (F.turbo) { v._pMul0 ??= v.pMul; v.pMul = v._pMul0 * 2; } else if (v._pMul0 != null) { v.pMul = v._pMul0; v._pMul0 = null; }
      if (this.frozenT > 0) { this.frozenT -= dt; v.input = { throttle: 0, brake: 1, steer: 0, handbrake: true }; v.body?.setLinvel({ x: 0, y: v.body.linvel().y, z: 0 }, true); }
      if (this.slowT > 0) { this.slowT -= dt; v.pMulSlow = 0.3; if (v.input) v.input.throttle = Math.min(v.input.throttle || 0, 0.35); }
      if (this.invertT > 0) { this.invertT -= dt; if (v.input) v.input.steer = -(v.input.steer || 0); }
      if (this.ghostT !== undefined) { this.ghostT -= dt; v.mesh.visible = !(this.ghostT > 0); if (v.trailer) v.trailer.mesh.visible = v.mesh.visible; if (this.ghostT <= 0) this.ghostT = undefined; }
    }
    for (const p of g.police || []) {
      if (p.v === v) continue;
      if (F.freeze) { p.ai && (p.ai.frozen = true); } else if (p.ai) p.ai.frozen = false;
      if (F.ghostPol) p.v.blindT = Math.max(p.v.blindT || 0, 0.6);
      if (F.dance && p.v.body) { p.ai && (p.ai.frozen = true); p.v.body.setAngvel({ x: 0, y: 3, z: 0 }, true); p.v.siren = true; }
    }
    if (F.drunk) { g.camera.rotation.z = Math.sin(g.time * 1.3) * 0.12; g.camera.position.y += Math.sin(g.time * 0.9) * 0.03; }
    if (F.noTraffic && !g.netTraffic && !g.mirror && g.traffic.cars.length) g.traffic.clear();
    if (this.open && this.tab === 'infos' && (this.stT = (this.stT || 0) - dt) <= 0) {
      this.stT = 0.5; const s = document.getElementById('adm-st');
      if (s) s.textContent = `mode ${g.mode || '-'} · état ${g.state}${g.mirror ? ' · invité' : ''}\n` + (v ? `PK ${(v.road.s / 1000).toFixed(2)} km · ${Math.round(v.kmh)} km/h · dégâts ${Math.round(v.damage)} %\n` : '') + `police ${g.police?.length || 0} · trafic ${g.traffic?.cars.length || 0} · chaleur ${Math.round(g.heat || 0)}\nsecours ${g.services?.units.length || 0} · chantiers ${g.works?.sites.size || 0}\nIA : ${Brain.enabled() ? (Brain.status || 'prête') : 'désactivée'}\njoueurs en ligne : ${g.net?.players?.size || 0}`;
    }
  }
}
