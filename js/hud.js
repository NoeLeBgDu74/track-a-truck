// Interface en jeu : compteur, compte-tours, GPS, minicarte, chrono, état du véhicule, messages radio
import { clamp, fmtTime, roadToWorld, roadYaw, DEST_S, DEST, EXIT_GAP, worldToRoad } from './config.js';

const $ = id => document.getElementById(id);
const _p = { x: 0, z: 0 };

export class HUD {
  constructor() {
    this.speedo = $('speedo').getContext('2d');
    this.map = $('minimap').getContext('2d');
    this.feed = $('feed'); this.toastT = 0; this.mapZoom = 0.55;
  }
  show(on) { $('hud').classList.toggle('on', on); }
  setRole(team, mode) {
    document.body.dataset.team = team;
    $('h-role').textContent = mode === 'free' ? 'MODE LIBRE' : (team === 'truck' ? 'ÉQUIPE CAMION' : 'ÉQUIPE POLICE');
    $('bust').style.display = mode === 'free' ? 'none' : '';
    $('h-timer').style.display = mode === 'free' ? 'none' : '';
    $('route').style.display = mode === 'free' ? 'none' : '';
    $('siren-hint').style.display = team === 'police' ? '' : 'none';
    this.feed.innerHTML = '';
  }
  msg(text, kind = '') {
    const d = document.createElement('div'); d.className = 'msg ' + kind; d.innerHTML = text;
    this.feed.prepend(d);
    while (this.feed.children.length > 5) this.feed.lastChild.remove();
    setTimeout(() => d.classList.add('old'), 7000);
    setTimeout(() => d.remove(), 9000);
  }
  toast(text) { const t = $('toast'); t.textContent = text; t.classList.add('on'); clearTimeout(this._tt); this._tt = setTimeout(() => t.classList.remove('on'), 1600); }
  big(text, cls = '') { const b = $('bigtext'); b.textContent = text; b.className = 'on ' + cls; clearTimeout(this._bt); if (text) this._bt = setTimeout(() => b.className = '', 1100); else b.className = ''; }

  update(g) {
    const v = g.player, foot = g.person;
    // compteur
    const ctx = this.speedo, W = 230, H = 230;
    ctx.clearRect(0, 0, W, H);
    if (v) {
      const kmh = v.kmh, max = v.def.vmax > 150 ? 260 : 140;
      const cx = W / 2, cy = H / 2 + 6, R = 98;
      const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
      ctx.lineCap = 'round';
      ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.beginPath(); ctx.arc(cx, cy, R, a0, a1); ctx.stroke();
      const acc = getComputedStyle(document.body).getPropertyValue('--acc').trim() || '#ff7a1a';
      ctx.strokeStyle = acc; ctx.beginPath(); ctx.arc(cx, cy, R, a0, a0 + (a1 - a0) * clamp(kmh / max)); ctx.stroke();
      // graduations
      ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '600 12px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const stepK = max > 200 ? 20 : 10;
      for (let k = 0; k <= max; k += stepK) {
        const a = a0 + (a1 - a0) * k / max, big = k % (stepK * 2) === 0;
        ctx.strokeStyle = 'rgba(255,255,255,' + (big ? 0.8 : 0.35) + ')'; ctx.lineWidth = big ? 2.5 : 1.5;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (R - 16), cy + Math.sin(a) * (R - 16)); ctx.lineTo(cx + Math.cos(a) * (R - (big ? 26 : 21)), cy + Math.sin(a) * (R - (big ? 26 : 21))); ctx.stroke();
        if (big) ctx.fillText(k, cx + Math.cos(a) * (R - 38), cy + Math.sin(a) * (R - 38));
      }
      // compte-tours (arc intérieur)
      const rp = clamp((v.rpm - 0) / (v.def.red * 1.1));
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.beginPath(); ctx.arc(cx, cy, R - 52, a0, a1); ctx.stroke();
      ctx.strokeStyle = v.rpm > v.def.red * 0.92 ? '#ff3030' : '#9fd0ff'; ctx.beginPath(); ctx.arc(cx, cy, R - 52, a0, a0 + (a1 - a0) * rp); ctx.stroke();
      // aiguille
      const an = a0 + (a1 - a0) * clamp(kmh / max);
      ctx.strokeStyle = '#ff3b2f'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx - Math.cos(an) * 10, cy - Math.sin(an) * 10); ctx.lineTo(cx + Math.cos(an) * (R - 8), cy + Math.sin(an) * (R - 8)); ctx.stroke();
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(cx, cy, 7, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '700 40px Rajdhani, sans-serif'; ctx.fillText(Math.round(kmh), cx, cy + 46);
      ctx.font = '600 11px Rajdhani, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillText('KM/H', cx, cy + 68);
      $('h-gear').textContent = v.reverse ? 'R' : (v.kmh < 1 && v.thr < 0.05 ? 'N' : v.gear);
      $('h-rpm').textContent = Math.round(v.rpm / 10) * 10 + ' tr/min';
      const hp = 100 - v.damage;
      $('h-dmg-bar').style.width = hp + '%';
      $('h-dmg-bar').style.background = hp > 60 ? '#3fd07a' : hp > 30 ? '#f0b020' : '#ff3b2f';
      $('h-dmg').textContent = Math.round(hp) + '%';
      $('h-veh').textContent = v.def.name;
      $('i-lights').classList.toggle('on', v.headlights);
      $('i-siren').classList.toggle('on', v.siren);
      $('i-hand').classList.toggle('on', v.handbrake);
      $('i-wiper').classList.toggle('on', v.wiping);
      $('i-spike').classList.toggle('on', v.spikes > 0);
    }
    $('speedwrap').style.opacity = foot ? 0.25 : 1;

    // chrono
    if (g.mode !== 'free') {
      $('h-timer').textContent = fmtTime(g.timeLeft);
      $('h-timer').classList.toggle('warn', g.timeLeft < 30);
    }
    // objectif / GPS
    const ref = v || (foot && { road: g.toRoad(foot.pos.x, foot.pos.z), curPos: foot.pos, yaw: foot.yaw });
    if (!ref) return;
    const s = ref.road.s;
    const truck = g.mode === 'chase' ? g.targetTruck() : null;
    let lines = '';
    if (g.mode === 'free') {
      lines = `<b>PK ${(s / 1000).toFixed(1)}</b><span>Autoroute A77 — direction Lyon</span>`;
    } else if (g.team === 'truck') {
      const left = Math.max(0, DEST_S - s) / 1000;
      const pol = g.nearestPolice(v?.curPos || ref.curPos);
      lines = `<b>Livraison : ${left.toFixed(1)} km</b><span>Plateforme Logistique — Sortie 18</span><span class="${pol.d < 80 ? 'red' : ''}">Police la plus proche : ${pol.d < 1e8 ? Math.round(pol.d) + ' m' : '—'}</span>`;
    } else if (truck) {
      const ds = truck.road.s - s;
      lines = `<b>Suspect : ${truck.def.name}</b><span>${ds >= 0 ? Math.round(ds) + ' m devant' : Math.round(-ds) + ' m derrière'} — ${Math.round(truck.kmh)} km/h</span><span>Arrivée du suspect : ${((DEST_S - truck.road.s) / 1000).toFixed(1)} km</span>`;
    }
    $('h-obj').innerHTML = lines;
    // instruction GPS
    let instr = 'Continuez tout droit', dist = '';
    const toExit = EXIT_GAP[0] - s;
    if (g.mode === 'free') { instr = 'Circulation libre'; }
    else if (g.team === 'police' && truck) { instr = truck.road.s > s ? 'Rattrapez le suspect' : 'Suspect derrière vous'; dist = Math.abs(Math.round(truck.road.s - s)) + ' m'; }
    else if (toExit > 1000) { instr = 'Suivez l’A77 — Sortie 18'; dist = (toExit / 1000).toFixed(1) + ' km'; }
    else if (toExit > 0) { instr = 'Sortie 18 à droite ⬈'; dist = Math.round(toExit / 10) * 10 + ' m'; }
    else if (s < DEST.s1) { instr = 'Entrez dans la plateforme ⬈'; dist = Math.max(0, Math.round((DEST.s0 + DEST.s1) / 2 - s)) + ' m'; }
    else { instr = 'Demi-tour impossible : faites marche arrière'; }
    $('gps-i').textContent = instr; $('gps-d').textContent = dist;
    // barre d'itinéraire
    if (g.mode !== 'free') {
      const pct = x => clamp((x + 200) / (DEST_S + 200)) * 100;
      const marks = [];
      const me = v || ref;
      marks.push(`<i class="me" style="left:${pct(me.road.s)}%"></i>`);
      for (const p of g.police) if (p.v !== g.player) marks.push(`<i class="pol" style="left:${pct(p.v.road.s)}%"></i>`);
      for (const t of g.fugitives) marks.push(`<i class="tr" style="left:${pct(t.v.road.s)}%"></i>`);
      $('route-marks').innerHTML = marks.join('');
    }
    // jauge d'interpellation
    if (g.mode === 'chase') {
      const b = g.bust;
      $('bust').classList.toggle('on', b > 0.01);
      $('bust-bar').style.width = (b * 100) + '%';
      $('bust-t').textContent = g.team === 'truck' ? 'INTERPELLATION EN COURS — ACCÉLÉREZ !' : 'IMMOBILISATION DU SUSPECT';
    }
    this.drawMap(g, ref);
  }

  drawMap(g, ref) {
    const c = this.map, W = 220, H = 220, cxm = W / 2, cym = H * 0.62, z = this.mapZoom;
    c.clearRect(0, 0, W, H);
    c.save();
    c.beginPath(); c.arc(W / 2, H / 2, W / 2 - 2, 0, 7); c.clip();
    c.fillStyle = 'rgba(14,20,26,0.82)'; c.fillRect(0, 0, W, H);
    const px = ref.curPos.x, pz = ref.curPos.z, yaw = ref.yaw;
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const T = (x, zz) => { const dx = x - px, dz = zz - pz; const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs; return [cxm - lx * z, cym - lz * z]; };
    // éléments hors route
    const s0 = ref.road.s;
    const poly = (pts, fill) => { c.beginPath(); pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath(); c.fillStyle = fill; c.fill(); };
    if (s0 > EXIT_GAP[0] - 600 && s0 < DEST.s1 + 400) {
      const q = []; for (const [s, d] of [[DEST.s0, DEST.d0], [DEST.s1, DEST.d0], [DEST.s1, DEST.d1], [DEST.s0, DEST.d1]]) { roadToWorld(s, d, _p); q.push(T(_p.x, _p.z)); }
      poly(q, 'rgba(64,255,144,0.35)');
      const r = []; for (const [s, d] of [[EXIT_GAP[0], -15], [DEST.s0, -15], [DEST.s0, -27], [EXIT_GAP[0], -16]]) { roadToWorld(s, d, _p); r.push(T(_p.x, _p.z)); }
      poly(r, 'rgba(200,200,210,0.5)');
    }
    // route
    for (const [w, col] of [[34 * z, 'rgba(120,128,140,0.85)'], [2 * z + 0.6, 'rgba(255,255,255,0.35)']]) {
      c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'butt'; c.beginPath();
      for (let s = s0 - 260 / z * 0.6; s < s0 + 300 / z * 0.6; s += 8) { roadToWorld(s, 0, _p); const [x, y] = T(_p.x, _p.z); s === s0 ? c.moveTo(x, y) : c.lineTo(x, y); }
      c.stroke();
    }
    // trafic
    c.fillStyle = 'rgba(220,220,230,0.75)';
    for (const car of g.traffic.cars) { const [x, y] = T(car.cur.x, car.cur.z); if (x < -5 || y < -5 || x > W + 5 || y > H + 5) continue; c.fillRect(x - 1.5, y - 2.5, 3, 5); }
    // barrages / herses
    for (const sp of g.spikes) { roadToWorld(sp.s, sp.d, _p); const [x, y] = T(_p.x, _p.z); c.fillStyle = '#ffd030'; c.fillRect(x - 5, y - 1.5, 10, 3); }
    // véhicules
    const flash = (g.time * 4) % 1 < 0.5;
    const dot = (v, col, r = 5) => { const [x, y] = T(v.curPos.x, v.curPos.z); const cx2 = clamp(x, 8, W - 8), cy2 = clamp(y, 8, H - 8); c.fillStyle = col; c.beginPath(); c.arc(cx2, cy2, r, 0, 7); c.fill(); c.strokeStyle = '#000'; c.lineWidth = 1.5; c.stroke(); };
    for (const p of g.police) if (p.v !== g.player) dot(p.v, flash ? '#2f7dff' : '#ff3040');
    for (const r of g.remotes.values()) dot(r, r.team === 'police' ? '#2f7dff' : '#ff9a1a', 5);
    for (const t of g.fugitives) dot(t.v, '#ff9a1a', 6);
    // destination
    if (g.mode !== 'free') { roadToWorld((DEST.s0 + DEST.s1) / 2, -58, _p); const [x, y] = T(_p.x, _p.z); const cx2 = clamp(x, 10, W - 10), cy2 = clamp(y, 10, H - 10); c.fillStyle = '#40ff90'; c.font = '700 16px sans-serif'; c.textAlign = 'center'; c.fillText('⚑', cx2, cy2 + 5); }
    // joueur
    c.translate(cxm, cym); c.fillStyle = '#fff'; c.beginPath(); c.moveTo(0, -9); c.lineTo(6, 7); c.lineTo(0, 4); c.lineTo(-6, 7); c.closePath(); c.fill();
    c.restore();
    c.strokeStyle = 'rgba(255,255,255,0.25)'; c.lineWidth = 2; c.beginPath(); c.arc(W / 2, H / 2, W / 2 - 2, 0, 7); c.stroke();
  }
}
