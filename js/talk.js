// Parler aux PNJ : touche T (ou bouton 💬) près de quelqu'un — à pied ou au volant.
// On tape (ou on dit au micro) une phrase ; l'IA joue le personnage (blessé, gendarme, automobiliste, secouriste,
// ouvrier…) avec la situation réelle du jeu, répond à voix haute et AGIT selon ce qu'on lui dit
// (se relever, appeler les secours, laisser partir, mettre une amende, arrêter, partir, suivre, remercier…).
import * as THREE from 'three';
import { Brain } from './brain.js';
import { Voice } from './voice.js';
import { profile, saveProfile } from './config.js';

const NAMES = ['Josiane', 'Kevin', 'Mireille', 'Patrick', 'Sofiane', 'Brigitte', 'Jean-Luc', 'Inès', 'Gérard', 'Chloé', 'Mamadou', 'Odile', 'Thierry', 'Yasmine', 'Bernard', 'Léa'];
const nameOf = o => (o._name ||= NAMES[Math.floor(Math.random() * NAMES.length)]);

const ACTIONS = {
  blesse: ['aucune', 'se_relever', 'appeler_secours', 'remercier', 's_enerver', 'echanger_constat'],
  automobiliste: ['aucune', 'partir', 'appeler_police', 'klaxonner', 'remercier', 's_enerver', 'echanger_constat'],
  gendarme: ['aucune', 'laisser_partir', 'amende', 'alcootest', 'arreter'],
  gendarme_controle: ['aucune', 'fouiller_remorque', 'laisser_passer', 'arreter'],
  secouriste: ['aucune', 'soigner_joueur', 'rassurer'],
  ouvrier: ['aucune', 's_enerver', 'offrir_cafe', 'indiquer_route'],
};

export class Talk {
  constructor(game) {
    this.g = game; this.open = false;
    const css = document.createElement('style'); css.textContent = `
#talk{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);width:min(560px,calc(100vw - 32px));z-index:60;display:none;background:rgba(12,16,24,.92);border:1px solid #33435e;border-radius:14px;padding:8px;box-shadow:0 8px 30px #0008;font:14px system-ui,sans-serif;color:#e8ecf2}
#talk .who{font-size:12px;color:#ffb347;margin:0 4px 6px}
#talk .row{display:flex;gap:6px}#talk input{flex:1;background:#0a0e15;color:#fff;border:1px solid #33435e;border-radius:9px;padding:9px 10px;font:15px system-ui}
#talk button{background:#1d2738;color:#fff;border:1px solid #33435e;border-radius:9px;padding:0 12px;font-size:16px;cursor:pointer}
#talk-hint{position:fixed;left:50%;bottom:86px;transform:translateX(-50%);z-index:59;background:rgba(12,16,24,.75);color:#fff;padding:5px 12px;border-radius:20px;font:13px system-ui;display:none;pointer-events:auto;cursor:pointer}`;
    document.head.appendChild(css);
    this.el = document.createElement('div'); this.el.id = 'talk';
    this.el.innerHTML = `<div class="who"></div><div class="row"><input maxlength="160" placeholder="Ce que tu lui dis… (Entrée)"><button data-m title="Parler au micro">🎤</button><button data-x title="Fermer">✕</button></div>`;
    document.body.appendChild(this.el);
    this.hint = document.createElement('div'); this.hint.id = 'talk-hint'; document.body.appendChild(this.hint);
    this.hint.onclick = () => this.show();
    this.inp = this.el.querySelector('input');
    ['keydown', 'keyup'].forEach(t => this.el.addEventListener(t, e => e.stopPropagation()));
    this.inp.addEventListener('keydown', e => { if (e.key === 'Enter') this.send(this.inp.value); if (e.key === 'Escape') this.hide(); });
    this.el.querySelector('[data-x]').onclick = () => this.hide();
    this.el.querySelector('[data-m]').onclick = () => this.mic();
    addEventListener('keydown', e => { if (e.code === 'KeyT' && !this.open && this.g.state === 'play' && !/INPUT|TEXTAREA/.test(e.target.tagName)) { e.preventDefault(); this.show(); } });
  }

  // qui est à portée de voix ?
  candidates() {
    const g = this.g, me = g.person ? g.person.pos : g.player?.curPos; if (!me) return [];
    const R = g.person ? 9 : 22, out = [];
    const add = (kind, pos, obj, extra = {}) => { const d = pos.distanceTo(me); if (d < R) out.push({ kind, pos, obj, d, ...extra }); };
    for (const c of g.traffic?.cars || []) {
      if (c.ped) add('blesse', c.ped.grp.position, c.ped, { car: c, state: c.ped.mode, sev: c.sev });
      else if (c.riderObj && !c.riderObj.dead) add('blesse', c.riderObj.piv.position, c.riderObj, { car: c, state: 'motard au sol' });
      else if (c.wreck || c.v < 3) add('automobiliste', c.mesh.position, c, { car: c, state: c.wreck ? 'accidenté, dans sa voiture' : 'arrêté' });
      else if (!g.person && c.mesh.position.distanceTo(me) < 10) add('automobiliste', c.mesh.position, c, { car: c, state: 'roule à côté, vitre ouverte' });
    }
    for (const r of g.riders || []) if (!r.dead && !g.traffic.cars.some(c => c.riderObj === r)) add('blesse', r.piv.position, r, { state: 'motard de la gendarmerie au sol' });
    const P = g.patrol; if (P?.officer && ['talk', 'stop'].includes(P.state)) add('gendarme', P.officer.grp.position, P.officer, { patrol: P });
    if (g.check && g.check.state !== 'done' && g.checkArm) { const p = new THREE.Vector3(); g.checkArm.getWorldPosition(p); p.y = 0; add('gendarme_controle', p, g.check); }
    for (const o of g.officers || []) if (o !== P?.officer && !o.dead) add('gendarme', o.grp.position, o, { state: o.mode });
    for (const p of g.services?.people || []) add(p.g.children.length > 9 ? 'secouriste' : 'secouriste', p.g.position, p);
    for (const site of g.works?.sites?.values?.() || []) for (const k of site.workers) add('ouvrier', k.g.position, k, { state: k.tool });
    return out.sort((a, b) => a.d - b.d);
  }

  step() {
    if (this.open || this.g.state !== 'play') { this.hint.style.display = 'none'; return; }
    const c = this.candidates()[0];
    if (c && (this.g.person || c.kind.startsWith('gendarme') || c.d < 12)) { this.hint.style.display = 'block'; this.hint.textContent = `💬 T : parler à ${this.label(c)}`; this.target = c; }
    else { this.hint.style.display = 'none'; this.target = null; }
  }
  label(c) { return { blesse: 'la victime', automobiliste: 'l’automobiliste', gendarme: 'le gendarme', gendarme_controle: 'le gendarme du contrôle', secouriste: 'le secouriste', ouvrier: 'l’ouvrier' }[c.kind] + ' (' + nameOf(c.obj) + ')'; }

  show() {
    const c = this.target || this.candidates()[0];
    if (!c) { this.g.hud?.toast('Personne à qui parler ici (approche-toi, ou F pour descendre du camion)'); return; }
    this.cur = c; this.open = true; this.el.style.display = 'block';
    this.el.querySelector('.who').textContent = `Tu parles à ${this.label(c)}`;
    this.inp.value = ''; setTimeout(() => this.inp.focus(), 20);
  }
  hide() { this.open = false; this.el.style.display = 'none'; this.inp.blur(); }

  mic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { this.g.hud?.toast('Micro non disponible dans ce navigateur (utilise Chrome ou Edge)'); return; }
    const r = new SR(); r.lang = 'fr-FR'; r.interimResults = false;
    r.onresult = e => { const t = e.results[0][0].transcript; this.inp.value = t; this.send(t); };
    r.onerror = () => this.g.hud?.toast('Micro : rien entendu');
    try { r.start(); this.g.hud?.toast('🎤 Parle…'); } catch (e) { }
  }

  async send(text) {
    text = String(text || '').trim(); if (!text || !this.cur) return;
    const g = this.g, c = this.cur; this.inp.value = '';
    g.hud?.msg(`🗣️ Toi : « ${text} »`);
    const hist = (c.obj._chat ||= []); hist.push({ role: 'user', content: text });
    const pl = g.player, acts = ACTIONS[c.kind];
    const sit = {
      personnage: { role: c.kind, prenom: nameOf(c.obj), etat: c.state || 'normal', gravite_accident: c.sev ?? null },
      joueur: { a_pied: !!g.person, vehicule: pl?.def?.name, equipe: g.team, vitesse_kmh: Math.round(pl?.kmh || 0), degats_camion: Math.round(pl?.damage || 0) },
      partie: { mode: g.mode, poursuite_en_cours: !!(g.released && g.mode !== 'free'), controle_patrouille: g.patrol?.state || null, amende_prevue: g.patrol?.flashed ? 90 : 0, meteo: g.env?.weather, cargaison: 'fromages industriels (en réalité illégaux)' },
    };
    const sys = `Tu joues UN personnage dans un jeu de camion sur autoroute française : ${this.label(c)}. Reste dans ton rôle, réagis de façon humaine et crédible à ce que dit le joueur (gentillesse, mensonge, insulte, humour, aveu…), avec ta personnalité, en français parlé, 1 à 3 phrases courtes. Tu peux être convaincu, mais pas naïf : un gendarme ne laisse pas filer quelqu'un d'insolent ou de suspect. Réponds UNIQUEMENT en JSON : {"reponse":"…","action":"${acts.join('|')}","emotion":"calme|content|inquiet|enerve|douleur|amuse"}`;
    const msgs = [{ role: 'system', content: sys }, { role: 'user', content: 'Situation : ' + JSON.stringify(sit) }, ...hist.slice(-8)];
    this.el.querySelector('.who').textContent = `${this.label(c)} réfléchit…`;
    const r = await Brain.ask(msgs, 400);
    this.el.querySelector('.who').textContent = `Tu parles à ${this.label(c)}`;
    const rep = r?.reponse ? String(r.reponse).slice(0, 220) : ['Hein ? Pardon, je suis un peu sonné…', 'Euh… oui ?', 'Je vous écoute.'][Math.floor(Math.random() * 3)];
    hist.push({ role: 'assistant', content: JSON.stringify(r || { reponse: rep }) });
    const who = { cur: c.pos, mesh: c.obj.grp || c.obj.piv || c.obj.g || c.obj.mesh || { position: c.pos }, type: { h: c.kind === 'automobiliste' ? (c.car?.type?.h || 1.5) : 0.4 } };
    g.bubble?.(who, rep);
    g.hud?.msg(`💬 ${nameOf(c.obj)} : « ${rep} »`);
    const female = /a$|e$|ès$|ne$/i.test(nameOf(c.obj)) && !/Patrick|Thierry|Gérard|Jean-Luc|Bernard|Mamadou/.test(nameOf(c.obj));
    Voice.say(rep, { pitch: c.kind.startsWith('gendarme') ? 0.78 : female ? 1.25 : 0.95, rate: 1.08, voice: c.kind.startsWith('gendarme') ? 1 : female ? 0 : 2 });
    this.act(c, String(r?.action || 'aucune'), r?.emotion);
  }

  act(c, a, emo) {
    const g = this.g, o = c.obj;
    if (emo === 'enerve' && o.mode && o.arms) o.mode = 'angry';
    switch (a) {
      case 'se_relever': if (o.piv && o.state === 'lie') { o.state = 'up'; o.rest = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, new THREE.Euler().setFromQuaternion(o.piv.quaternion, 'YXZ').y, 0, 'YXZ')); } if (o.grp) { o.mode = 'phone'; o.grp.rotation.z = 0; o.grp.position.y = 0; } break;
      case 'appeler_secours': if (c.car || o.piv) g.services?.report({ s: (c.car?.s) ?? g.player.road.s, dir: c.car?.dir ?? 1, severe: true, cars: c.car ? [c.car] : [], hurt: [o] }); g.hud?.toast('🚑 Les secours sont prévenus'); break;
      case 'appeler_police': if (g.mode !== 'free' && g.team === 'truck') { g.heat = Math.min(100, (g.heat || 0) + 8); g.radio?.('Un automobiliste signale le camion à la centrale !', 'pol'); } else g.hud?.toast('📱 Il appelle la police…'); break;
      case 'klaxonner': g.audio?.honkAt?.(c.pos, false); break;
      case 'partir': if (c.car && !c.car.wreck) { c.car.v0 *= 1.15; c.car.feel = 'angry'; c.car.feelT = 6; } break;
      case 'remercier': profile.money += 50; saveProfile(); g.hud?.toast('🙏 Il te remercie (+50 €)'); break;
      case 'echanger_constat': g.hud?.toast('📝 Constat amiable rempli'); break;
      case 'offrir_cafe': g.hud?.toast('☕ Café offert : tu es en forme !'); if (g.coop) g.coop.chars?.forEach(ch => ch.fatigue = Math.max(0, ch.fatigue - 30)); break;
      case 'soigner_joueur': if (g.player) { g.player.damage = Math.max(0, g.player.damage - 15); g.hud?.toast('🩹 Il te soigne (et jette un œil au camion)'); } break;
      case 'laisser_partir': { const P = c.patrol || g.patrol; if (P?.state === 'talk' || P?.state === 'stop') { P.flashed = 0; P.lines = [[P.t + 0.3, 'Bon… allez, filez. Et que je ne vous y reprenne pas.']]; P.line = 0; } break; }
      case 'amende': { const P = c.patrol || g.patrol; const f = 135; profile.money = Math.max(0, profile.money - f); saveProfile(); g.hud?.toast(`💸 Amende : −${f} €`); if (P) P.paid = true; break; }
      case 'arreter': {
        const P = c.patrol || g.patrol;
        if (c.kind === 'gendarme_controle' && g.checkBreak) g.checkBreak('Vous vous moquez de moi ? Sortez du véhicule ! … Il démarre !', true);
        else if (P && P.ai) { P.state = 'refus'; P.t = 0; P.ai.role = 'chase'; g.hud?.big('IL VOUS ARRÊTE !', 'wanted'); }
        else if (g.released) g.heat = Math.min(100, (g.heat || 0) + 10);
        break;
      }
      case 'laisser_passer': if (c.kind === 'gendarme_controle' && g.check && g.check.state !== 'done') { g.check.state = 'waved'; g.check.t = 0; g.hud?.toast('👮 Il te fait signe de passer…'); } break;
      case 'fouiller_remorque': if (g.check && g.check.state === 'inspect') g.check.t = Math.max(g.check.t, 6.5); break;
      case 'alcootest': g.hud?.toast('🎈 Soufflez… 0,00 g/L'); break;
      case 's_enerver': if (c.car) { c.car.feel = 'angry'; c.car.feelT = 8; c.car.flash = 2; g.audio?.honkAt?.(c.pos, false); } break;
    }
  }
}
