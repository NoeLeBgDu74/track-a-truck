// Panneau créateur caché : taper « admin » au clavier (ou 5 tapes rapides dans le coin haut-droit),
// puis le code 1712. Fonctionne dans tous les modes (solo, carrière, coop, duel, invité en ligne : actions locales).
import { profile, saveProfile, VEHICLES, UPGRADES, MISSIONS, ACHIEVEMENTS, DEST_S, settings } from './config.js';
import { Brain } from './brain.js';

const CODE = '1712';
const css = `
#adm-lock,#adm{position:fixed;z-index:9999;font:13px system-ui,sans-serif;color:#e8ecf2}
#adm-lock{inset:0;background:rgba(5,8,14,.72);display:flex;align-items:center;justify-content:center}
#adm-lock .bx{background:#121822;border:1px solid #2c3a52;border-radius:12px;padding:18px 20px;text-align:center;box-shadow:0 10px 40px #0008}
#adm-lock input{font:700 22px monospace;letter-spacing:8px;width:130px;text-align:center;background:#0a0e15;color:#ffb347;border:1px solid #33435e;border-radius:8px;padding:6px;margin-top:10px}
#adm{top:10px;right:10px;width:320px;max-height:calc(100vh - 20px);overflow:auto;background:rgba(14,19,28,.94);border:1px solid #2c3a52;border-radius:12px;padding:10px 12px;box-shadow:0 10px 40px #0009;backdrop-filter:blur(6px)}
#adm h3{margin:0 0 6px;font-size:14px;color:#ffb347;display:flex;justify-content:space-between;align-items:center}
#adm h4{margin:10px 0 4px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#7f8ca3}
#adm .row{display:flex;flex-wrap:wrap;gap:5px;justify-content:flex-start}
#adm button{margin:0;float:none;background:#1d2738;color:#e8ecf2;border:1px solid #33435e;border-radius:7px;padding:5px 8px;font:12px system-ui;cursor:pointer}
#adm button:hover{background:#28354d}#adm button.on{background:#b0601a;border-color:#ffb347}
#adm label{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:3px 0}
#adm input[type=range]{width:150px}#adm select{background:#1d2738;color:#e8ecf2;border:1px solid #33435e;border-radius:6px}
#adm .st{font:11px monospace;color:#9fb0c8;white-space:pre-wrap;background:#0a0e15;border-radius:6px;padding:6px;margin-top:6px}
@media (max-width:520px){#adm{left:8px;right:8px;width:auto;max-height:60vh}}`;

export class Admin {
  constructor(game) {
    this.g = game; this.open = false; this.ok = false; this.buf = ''; this.taps = [];
    this.god = false; this.turbo = false; this.freeze = false; this.ghostPol = false; this.noTraffic = false;
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
  }

  toggle() {
    if (!this.ok) return this.askCode();
    this.open = !this.open;
    if (this.open) this.build(); else this.el?.remove();
  }

  askCode() {
    if (document.getElementById('adm-lock')) return;
    const d = document.createElement('div'); d.id = 'adm-lock';
    d.innerHTML = `<div class="bx">🔒 <b>Accès créateur</b><br><input type="password" inputmode="numeric" maxlength="4" autocomplete="off"><div style="margin-top:8px;color:#7f8ca3;font-size:11px">Échap pour annuler</div></div>`;
    document.body.appendChild(d);
    const inp = d.querySelector('input'); setTimeout(() => inp.focus(), 30);
    const stop = e => e.stopPropagation();
    inp.addEventListener('keydown', e => { stop(e); if (e.key === 'Escape') d.remove(); });
    inp.addEventListener('keyup', stop);
    inp.addEventListener('input', () => {
      if (inp.value.length < 4) return;
      if (inp.value === CODE) { this.ok = true; d.remove(); this.open = true; this.build(); this.g.hud?.toast('🛠️ Mode créateur activé'); }
      else { inp.value = ''; inp.style.borderColor = '#e04040'; setTimeout(() => d.remove(), 500); }
    });
    d.addEventListener('pointerdown', e => { if (e.target === d) d.remove(); });
  }

  pl() { return this.g.player; }
  toast(t) { this.g.hud?.toast(t); }

  build() {
    this.el?.remove();
    const g = this.g, el = this.el = document.createElement('div'); el.id = 'adm';
    const tog = (k, label) => `<button data-t="${k}" class="${this[k] ? 'on' : ''}">${label}</button>`;
    el.innerHTML = `
<h3>🛠️ Panneau créateur <button data-a="close">✕</button></h3>
<h4>Joueur</h4><div class="row">
${tog('god', '🛡️ Invincible')}${tog('turbo', '🚀 Turbo x2')}<button data-a="repair">🔧 Réparer</button><button data-a="flip">↩️ Remettre sur roues</button>
<button data-a="tp1">⏩ +1 km</button><button data-a="tp5">⏩ +5 km</button><button data-a="tpdest">🏁 Arrivée</button><button data-a="tpback">⏪ −1 km</button></div>
<h4>Police</h4><div class="row">
${tog('freeze', '🧊 Figer la police')}${tog('ghostPol', '👻 Police aveugle')}<button data-a="pol2">➕ 2 voitures</button><button data-a="polback">↩️ Police à 600 m</button>
<button data-a="heat0">🌡️ Recherche 0</button><button data-a="heatmax">🔥 Recherche max</button><button data-a="heli">🚁 Hélico</button><button data-a="spike">⛓️ Herse devant</button></div>
<h4>Trafic</h4><div class="row">
${tog('noTraffic', '🚫 Vider le trafic')}<button data-a="pileup">💥 Carambolage devant</button><button data-a="spawn10">🚗 +10 voitures</button></div>
<h4>Monde</h4>
<label>Heure <input type="range" min="0" max="24" step="0.25" data-r="tod" value="${g.env.timeOfDay}"></label>
<label>Météo <select data-s="weather">${['clear', 'rain', 'storm', 'fog', 'auto'].map(w => `<option ${g.env.weather === w ? 'selected' : ''}>${w}</option>`).join('')}</select></label>
<label>Vitesse du jeu <input type="range" min="0.2" max="2" step="0.1" data-r="speed" value="${g.timeScale || 1}"></label>
<h4>Partie</h4><div class="row">
<button data-a="win">🏆 Gagner</button><button data-a="lose">💀 Perdre</button><button data-a="time">⏱️ +60 s</button><button data-a="gadgets">🎒 Gadgets pleins</button><button data-a="slow">🐢 Ralenti</button></div>
<h4>Profil</h4><div class="row">
<button data-a="money">💰 +10 000 €</button><button data-a="unlock">🔓 Tout débloquer</button><button data-a="reset">🗑️ Effacer le profil</button></div>
<div class="st" id="adm-st"></div>`;
    document.body.appendChild(el);
    ['keydown', 'keyup'].forEach(t => el.addEventListener(t, e => e.stopPropagation()));
    el.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.t) { this[b.dataset.t] = !this[b.dataset.t]; b.classList.toggle('on', this[b.dataset.t]); this.onToggle(b.dataset.t); }
      if (b.dataset.a) this.act(b.dataset.a);
    });
    el.addEventListener('input', e => {
      const r = e.target.dataset.r;
      if (r === 'tod') { g.env.cycle = false; g.env.timeOfDay = +e.target.value; g.env.envDirty = true; }
      if (r === 'speed') g.timeScale = +e.target.value;
    });
    el.addEventListener('change', e => { if (e.target.dataset.s === 'weather') g.env.setWeather(e.target.value); });
  }

  onToggle(k) {
    const g = this.g;
    if (k === 'noTraffic' && this.noTraffic && !g.netTraffic && !g.mirror) { g.traffic.clear(); this.toast('Trafic vidé'); }
    if (k === 'god' && !this.god && this.pl()) this.pl().armor = 1;
  }

  act(a) {
    const g = this.g, v = this.pl(), M = g.mirror;
    const tp = ds => { if (!v || M) return this.toast('Indisponible ici'); const s = Math.max(0, v.road.s + ds); v.resetOnRoad(s, v.road.d); };
    switch (a) {
      case 'close': this.open = false; this.el.remove(); break;
      case 'repair': if (v) { v.damage = 0; v.disabled = false; v.flat = 0; this.toast('Réparé'); } break;
      case 'flip': if (v && !M) v.resetOnRoad(v.road.s, v.road.d); break;
      case 'tp1': tp(1000); break; case 'tp5': tp(5000); break; case 'tpback': tp(-1000); break;
      case 'tpdest': tp(DEST_S - 150 - (v?.road.s || 0)); break;
      case 'pol2': if (M || !g.player) return this.toast('Indisponible ici'); for (const k of [-1, 1]) g.addPolice(g.player.road.s - 90, g.player.road.d + k * 3.5, 'chase'); this.toast('+2 unités'); break;
      case 'polback': for (const p of g.police || []) if (p.v !== v && v) p.v.resetOnRoad(Math.max(0, v.road.s - 600 - Math.random() * 80), p.v.road.d); this.toast('Police repoussée'); break;
      case 'heat0': g.heat = 0; g.bust = 0; g.wanted = 0; this.toast('Plus recherché'); break;
      case 'heatmax': g.heat = 100; g.wanted = 5; g.released = true; this.toast('Recherche max !'); break;
      case 'heli': g.heliOn = true; this.toast('Hélico en route'); break;
      case 'spike': if (v && !M) { g.addSpike(v.road.s + 120, v.road.d, 7); this.toast('Herse posée à 120 m'); } break;
      case 'pileup': if (!v || M || g.netTraffic) return this.toast('Indisponible ici'); {
        const cars = g.traffic.cars.filter(c => !c.wreck && c.s > v.road.s + 40 && c.s < v.road.s + 400).slice(0, 5);
        cars.forEach((c, i) => g.traffic.makeWreck(c, (Math.random() - 0.5) * 14, Math.sign(Math.cos(c.curYaw)) * (10 + i * 2)));
        this.toast(cars.length ? `💥 ${cars.length} véhicules accidentés devant` : 'Aucune voiture devant');
      } break;
      case 'spawn10': if (M || g.netTraffic || !v) return this.toast('Indisponible ici'); for (let i = 0; i < 10; i++) g.traffic.trySpawn?.(v.road.s + 150 + Math.random() * 600, true); this.toast('+10 voitures'); break;
      case 'win': if (g.state === 'play' && !M) g.finish(true, 'Victoire (créateur)', 'Partie terminée depuis le panneau créateur.'); break;
      case 'lose': if (g.state === 'play' && !M) g.finish(false, 'Défaite (créateur)', 'Partie terminée depuis le panneau créateur.'); break;
      case 'time': g.timeLeft = (g.timeLeft || 0) + 60; this.toast('+60 s'); break;
      case 'gadgets': if (g.coop) { Object.assign(g.coop, { oil: 9, nails: 9, smoke: 9, paint: 9, cones: 9, crackers: 9, detour: 9, bananas: 9, sandwiches: 9, fuel: 100 }); } g.fugGad && Object.assign(g.fugGad, { oil: 9, nails: 9, smoke: 9, paint: 9, cones: 9, crackers: 9 }); this.toast('Gadgets à 9'); break;
      case 'slow': g.slow = 4; document.body.classList.add('slowmo'); break;
      case 'money': profile.money += 10000; saveProfile(); this.toast('+10 000 €'); break;
      case 'unlock':
        for (const m of MISSIONS) profile.stars[m.id] = Math.max(profile.stars[m.id] || 0, 3);
        for (const id of Object.keys(VEHICLES)) { profile.up[id] ||= {}; for (const k of Object.keys(UPGRADES)) profile.up[id][k] = Math.max(profile.up[id][k] || 0, UPGRADES[k].cost.length); }
        for (const a2 of ACHIEVEMENTS) profile.ach[a2.id] ||= Date.now();
        saveProfile(); this.toast('Tout est débloqué (relance la partie pour les améliorations)'); break;
      case 'reset': if (confirm('Effacer tout le profil (argent, étoiles, améliorations) ?')) { localStorage.removeItem('tat_profile'); location.reload(); } break;
    }
  }

  // appelé à chaque pas de simulation
  step(dt) {
    const g = this.g, v = g.player;
    if (v) {
      if (this.god) { v.armor = 0; v.damage = 0; v.disabled = false; g.bust = 0; }
      if (this.turbo) { v._pMul0 ??= v.pMul; v.pMul = v._pMul0 * 2; } else if (v._pMul0 != null) { v.pMul = v._pMul0; v._pMul0 = null; }
    }
    for (const p of g.police || []) {
      if (p.v === v) continue;
      if (this.freeze) { p.v.body?.setLinvel?.({ x: 0, y: 0, z: 0 }, true); p.ai && (p.ai.frozen = true); } else if (p.ai) p.ai.frozen = false;
      if (this.ghostPol) p.v.blindT = Math.max(p.v.blindT || 0, 0.6);
    }
    if (this.noTraffic && !g.netTraffic && !g.mirror && g.traffic.cars.length) g.traffic.clear();
    if (this.open && (this.stT = (this.stT || 0) - dt) <= 0) {
      this.stT = 0.5; const s = document.getElementById('adm-st');
      if (s) s.textContent = `mode ${g.mode || '-'} · état ${g.state}${g.mirror ? ' · invité' : ''}\n` + (v ? `PK ${(v.road.s / 1000).toFixed(2)} km · ${Math.round(v.kmh)} km/h · dégâts ${Math.round(v.damage)} %\n` : '') + `police ${g.police?.length || 0} · trafic ${g.traffic?.cars.length || 0} · chaleur ${Math.round(g.heat || 0)}\nIA : ${Brain.enabled() ? (Brain.status || 'prête') : 'désactivée'}`;
    }
  }
}
