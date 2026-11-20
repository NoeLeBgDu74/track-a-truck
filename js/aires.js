// Aires de service vivantes : des gens vont et viennent (boutique, camions garés, toilettes), un employé nettoie,
// et quand on s'arrête sous l'auvent de la station, un menu « Station-service » s'ouvre :
// plein, réparation du camion, gadgets rechargés, café, sandwich — dans tous les modes.
import * as THREE from 'three';
import { roadToWorld, roadYaw, REST_AREAS, profile, saveProfile } from './config.js';

const _p = { x: 0, z: 0 };
const mats = {};
const M = c => (mats[c] ||= new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 }));
function walker(top, pants) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const b = (m, w, h, d, x, y, z, par = body) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; par.add(o); return o; };
  const legs = [-1, 1].map(sx => { const l = new THREE.Group(); l.position.set(sx * 0.11, 0.85, 0); b(M(pants), 0.15, 0.85, 0.18, 0, -0.42, 0, l); body.add(l); return l; });
  b(M(top), 0.44, 0.6, 0.25, 0, 1.18, 0); b(M([0xe0b090, 0xc08a60, 0x8a5a3a][Math.floor(Math.random() * 3)]), 0.22, 0.25, 0.22, 0, 1.64, 0);
  const arms = [-1, 1].map(sx => { const a = new THREE.Group(); a.position.set(sx * 0.29, 1.45, 0); b(M(top), 0.1, 0.58, 0.1, 0, -0.27, 0, a); body.add(a); return a; });
  return { g, body, legs, arms, t: Math.random() * 10 };
}
const at = (s, d) => { roadToWorld(s, d, _p); return new THREE.Vector3(_p.x, 0, _p.z); };

export class Aires {
  constructor(game) {
    this.g = game; this.sites = new Map(); this.menu = null;
    const css = document.createElement('style'); css.textContent = `
#aire{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:70;width:min(420px,calc(100vw - 32px));background:rgba(12,16,24,.95);border:1px solid #1fa055;border-radius:14px;padding:14px;color:#e8ecf2;font:14px system-ui;box-shadow:0 10px 40px #000a}
#aire h3{margin:0 0 4px;color:#3fd07a}#aire p{margin:0 0 10px;color:#9fb0c8;font-size:12px}
#aire .g{display:grid;grid-template-columns:1fr 1fr;gap:6px}#aire button{background:#1d2738;color:#fff;border:1px solid #33435e;border-radius:9px;padding:9px;text-align:left;cursor:pointer;font:13px system-ui}
#aire button small{display:block;color:#8d9ab0;font-size:11px}#aire button:hover{background:#28354d}#aire .x{margin-top:8px;width:100%;text-align:center}`;
    document.head.appendChild(css);
  }
  clear() { for (const s of this.sites.values()) this.g.scene.remove(s.root); this.sites.clear(); this.close(); }
  build(ra) {
    const root = new THREE.Group(), mid = (ra.s0 + ra.s1) / 2, people = [];
    const door = at(mid, -54.2), pts = [door, at(mid - 40, -30), at(mid + 30, -30), at(mid + 60, -36), at(mid - 70, -32), at(mid + 95, -30), at(mid - 20, -45), at(mid + 15, -48)];
    const cols = [[0x3a5a8a, 0x2a2e3a], [0x8a2a2a, 0x2a2a30], [0x2a6a3a, 0x3a3a40], [0xd8d0c0, 0x2a3550], [0x222222, 0x4a4a50], [0xc8a040, 0x2a2e3a], [0x6a3a8a, 0x2a2e3a]];
    for (let i = 0; i < 7; i++) {
      const w = walker(...cols[i]); const from = pts[1 + (i % (pts.length - 1))].clone(); w.g.position.copy(from); root.add(w.g);
      w.route = [from, door]; w.k = 1; w.wait = Math.random() * 6; people.push(w);
    }
    // employé qui nettoie devant la boutique
    const emp = walker(0x1fa055, 0x2a3550); emp.g.position.copy(at(mid + 6, -53.5)); emp.broom = true; root.add(emp.g);
    const broom = new THREE.Group(); const st = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.3, 6), M(0x8a5a2a)); st.position.y = -0.6; broom.add(st); const hd = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.12), M(0x333333)); hd.position.y = -1.25; broom.add(hd); emp.arms[1].add(broom);
    people.push(emp);
    this.g.scene.add(root);
    return { ra, root, people, mid };
  }
  step(dt) {
    const g = this.g, pl = g.player; if (!pl || g.state === 'menu') return;
    for (const ra of REST_AREAS) {
      const near = Math.abs(pl.road.s - (ra.s0 + ra.s1) / 2) < 600;
      if (near && !this.sites.has(ra.name)) this.sites.set(ra.name, this.build(ra));
      if (!near && this.sites.has(ra.name)) { g.scene.remove(this.sites.get(ra.name).root); this.sites.delete(ra.name); }
    }
    for (const site of this.sites.values()) {
      for (const w of site.people) {
        w.t += dt; const [L, R] = w.arms;
        if (w.broom) { R.rotation.x = -0.6 + Math.sin(w.t * 3) * 0.4; w.body.rotation.x = 0.15; continue; }
        if (w.wait > 0) { w.wait -= dt; w.legs.forEach(l => l.rotation.x *= 0.85); L.rotation.x = Math.sin(w.t) * 0.1; continue; }
        const tgt = w.route[w.k], d = tgt.clone().sub(w.g.position); d.y = 0; const len = d.length();
        if (len < 0.3) { w.k = 1 - w.k; w.wait = 3 + Math.random() * 8; if (w.k === 1 && Math.random() < 0.5) w.route[0] = [at(site.mid - 40, -30), at(site.mid + 30, -30), at(site.mid - 70, -32), at(site.mid + 95, -30)][Math.floor(Math.random() * 4)]; continue; }
        w.g.rotation.y = Math.atan2(d.x, d.z); w.g.position.addScaledVector(d.normalize(), Math.min(len, 1.3 * dt));
        w.legs[0].rotation.x = Math.sin(w.t * 7) * 0.45; w.legs[1].rotation.x = -Math.sin(w.t * 7) * 0.45; L.rotation.x = -Math.sin(w.t * 7) * 0.35; R.rotation.x = Math.sin(w.t * 7) * 0.35;
      }
    }
    // arrêt sous l'auvent de la station → menu
    const ra = REST_AREAS.find(r => Math.abs(pl.road.s - ((r.s0 + r.s1) / 2 + 60)) < 13 && pl.road.d < -32 && pl.road.d > -48);
    if (ra && pl.kmh < 3 && !g.person) { this.stopT = (this.stopT || 0) + dt; if (this.stopT > 1.2 && !this.menu && !this.dismissed) this.open(ra); }
    else { this.stopT = 0; this.dismissed = false; if (this.menu && pl.kmh > 6) this.close(); }
  }
  open(ra) {
    const g = this.g, v = g.player, dmg = Math.round(v.damage), rep = Math.max(40, dmg * 6);
    const el = this.menu = document.createElement('div'); el.id = 'aire';
    el.innerHTML = `<h3>⛽ ${ra.name}</h3><p>Station-service ouverte 24 h/24 · ton argent : ${profile.money} €</p><div class="g">
<button data-a="fuel">⛽ Faire le plein<small>${g.coop ? 'Gazole à 100 %' : 'Réservoir plein'} · 85 €</small></button>
<button data-a="repair">🔧 Réparer le camion<small>Dégâts ${dmg} % · ${rep} €</small></button>
<button data-a="gadgets">🎒 Recharger les gadgets<small>Huile, clous, fumigènes · 120 €</small></button>
<button data-a="coffee">☕ Café serré<small>Fatigue −40 % · 3 €</small></button>
<button data-a="food">🥪 Sandwich + bananes<small>Faim −60 % · 9 €</small></button>
<button data-a="wash">🧽 Lavage express<small>Il brille ! · 15 €</small></button></div><button class="x" data-a="close">Repartir</button>`;
    document.body.appendChild(el);
    el.addEventListener('click', e => { const b = e.target.closest('button'); if (b) this.act(b.dataset.a, rep); });
    ['keydown', 'keyup'].forEach(t => el.addEventListener(t, e => e.stopPropagation()));
  }
  close() { this.menu?.remove(); this.menu = null; }
  pay(n) { if (profile.money < n) { this.g.hud?.toast('Pas assez d’argent !'); return false; } profile.money -= n; saveProfile(); return true; }
  act(a, rep) {
    const g = this.g, v = g.player, c = g.coop;
    if (a === 'close') { this.close(); this.dismissed = true; return; }
    if (a === 'fuel' && this.pay(85)) { if (c) c.fuel = 100; g.hud?.toast('⛽ Plein fait'); }
    if (a === 'repair' && this.pay(rep)) { v.damage = 0; v.disabled = false; v.flat = 0; v.spikes = 0; g.hud?.toast('🔧 Camion réparé (le mécano siffle d’admiration)'); }
    if (a === 'gadgets' && this.pay(120)) { if (c) Object.assign(c, { oil: 3, nails: 2, smoke: 2, paint: 2, cones: 2, crackers: 2, detour: 1 }); if (g.fugGad) Object.assign(g.fugGad, { oil: 2, nails: 2, smoke: 1, paint: 1, cones: 1, crackers: 1 }); if (g.duel && g.team === 'truck') Object.assign(g.duel, { oil: 2, nails: 2, smoke: 1 }); g.hud?.toast('🎒 Gadgets rechargés'); }
    if (a === 'coffee' && this.pay(3)) { if (c) c.chars.forEach(ch => ch.fatigue = Math.max(0, ch.fatigue - 40)); g.hud?.toast('☕ Ah, ça réveille !'); }
    if (a === 'food' && this.pay(9)) { if (c) { c.chars.forEach(ch => ch.faim = Math.max(0, ch.faim - 60)); c.sandwiches = Math.max(c.sandwiches, 3); c.bananas = Math.max(c.bananas, 5); } g.hud?.toast('🥪 Miam'); }
    if (a === 'wash' && this.pay(15)) { v.model?.group?.traverse(o => { if (o.material?.roughness != null && o.name === 'paint') o.material.roughness = 0.15; }); g.hud?.toast('🧽 Tout propre !'); }
    if (this.menu) { this.close(); this.open(REST_AREAS.find(r => Math.abs(v.road.s - ((r.s0 + r.s1) / 2 + 60)) < 13) || REST_AREAS[0]); }
  }
}
