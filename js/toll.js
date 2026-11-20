// Barrière de péage (PK 2,7) : grande marquise, îlots avec cabines, barrières levantes par voie.
// Voie de gauche « t » = télépéage (passer à moins de 30 km/h), autres voies : s'arrêter devant la barrière pour payer.
// Forcer une barrière la casse (elle s'envole), et en poursuite ça alerte la police. Le trafic ralentit et passe.
import * as THREE from 'three';
import { roadToWorld, roadYaw, laneD, SHOULDER_D, profile, saveProfile } from './config.js';

export const TOLL_S = 2700;
const _p = { x: 0, z: 0 };
const M = (c, e, ei = 0.5) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.1, emissive: e || 0x000000, emissiveIntensity: e ? ei : 0 });
function canvasSign(lines, bg, fg, w = 512, h = 128) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, w, h); x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
  lines.forEach((l, i) => { x.font = `900 ${i ? h * 0.26 : h * 0.5}px Arial`; x.fillText(l, w / 2, h * (lines.length === 1 ? 0.5 : i ? 0.78 : 0.38)); });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Toll {
  constructor(game) { this.g = game; this.built = null; this.t = 0; }
  clear() { if (this.built) { this.g.scene.remove(this.built.root); for (const b of this.built.bodies) this.g.phys.removeRigidBody(b); } this.built = null; this.paid = null; }
  build() {
    const g = this.g, R = g.R, root = new THREE.Group(), bodies = [], lanes = [];
    const conc = M(0xd8d6d0), cabin = M(0xf2f2ee), glass = M(0x1a2430), stripe = M(0xd8342a), roof = M(0xe8e8e4), green = M(0x0f7a3a);
    const at = (s, d) => { roadToWorld(s, d, _p); return new THREE.Vector3(_p.x, 0, _p.z); };
    const yaw = roadYaw(TOLL_S);
    const box = (m, w, h, dd, s, d, y, ry = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), m); const p = at(s, d); o.position.set(p.x, y, p.z); o.rotation.y = yaw + ry; o.castShadow = true; o.receiveShadow = true; root.add(o); return o; };
    const solid = (w, h, dd, s, d) => { const p = at(s, d); const b = g.phys.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(p.x, h / 2, p.z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })); g.phys.createCollider(R.ColliderDesc.cuboid(w / 2, h / 2, dd / 2), b); bodies.push(b); };
    // grande marquise au-dessus des deux sens
    box(roof, 34, 0.5, 14, TOLL_S, 0, 6.6); box(green, 34.2, 0.9, 0.3, TOLL_S - 7, 0, 6.2);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.6), new THREE.MeshStandardMaterial({ map: canvasSign(['PÉAGE', 'A77 · Gare de Champ-Fleuri'], '#0f7a3a', '#ffffff', 1024, 192), emissive: 0xffffff, emissiveIntensity: 0.15 }));
    { const p = at(TOLL_S - 7.2, -6.5); sign.position.set(p.x, 6.4, p.z); sign.rotation.y = yaw + Math.PI; root.add(sign); }
    for (const dir of [1, -1]) {
      const edges = [4.8, 8.4, 12.0, 15.4].map(e => -dir * e);
      const centers = [laneD(dir, 0), laneD(dir, 1), laneD(dir, 2), SHOULDER_D(dir)];
      edges.forEach((d, i) => {
        box(conc, 0.55, 0.18, 16, TOLL_S, d, 0.09); solid(0.42, 2.4, 1.8, TOLL_S, d); // îlot bas (bordure) + cabine solide
        box(stripe, 0.57, 0.3, 0.4, TOLL_S - dir * 8, d, 0.2); // nez d'îlot rouge et blanc
        box(cabin, 0.44, 2.4, 1.8, TOLL_S, d, 1.4); box(glass, 0.46, 0.9, 1.5, TOLL_S, d, 1.85); box(stripe, 0.48, 0.15, 1.82, TOLL_S, d, 2.65);
        for (let k = 0; k < 2; k++) box(M(0x8a8e95), 0.2, 6.4, 0.2, TOLL_S + (k ? 5 : -5), d, 3.2);
      });
      centers.forEach((d, i) => {
        const tele = i === 0, closed = i === 3 && dir < 0;
        // panneau de voie au-dessus (t orange / CB / croix rouge)
        const ps = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.1), new THREE.MeshStandardMaterial({ map: canvasSign([closed ? '✕' : tele ? 't' : '▼', closed ? '' : tele ? 'télépéage' : 'CB · espèces'], closed ? '#9a1010' : tele ? '#f08a00' : '#1a6a2a', '#ffffff', 256, 200), emissive: 0xffffff, emissiveIntensity: 0.35 }));
        const pp = at(TOLL_S - dir * 7.1, d); ps.position.set(pp.x, 5.5, pp.z); ps.rotation.y = yaw + (dir > 0 ? Math.PI : 0); root.add(ps);
        // barrière levante (pivot sur l'îlot de droite de la voie)
        const pivD = d - dir * 1.4, piv = new THREE.Group(), bp = at(TOLL_S + dir * 1.5, pivD); piv.position.set(bp.x, 1.05, bp.z); piv.rotation.y = yaw + (dir > 0 ? 0 : Math.PI); root.add(piv);
        const arm = new THREE.Group(); piv.add(arm);
        for (let k = 0; k < 6; k++) { const seg = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.1, 0.08), k % 2 ? M(0xd8342a) : M(0xf4f4f4)); seg.position.set(dir * (0.25 + k * 0.47), 0, 0); arm.add(seg); }
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff2020, emissiveIntensity: 2 })); const lp = at(TOLL_S + dir * 1.0, pivD); lamp.position.set(lp.x, 2.6, lp.z); root.add(lamp);
        lanes.push({ dir, i, d, tele, closed, arm, open: 0, want: 0, lamp, broken: false });
      });
    }
    g.scene.add(root);
    this.built = { root, bodies, lanes };
  }
  laneAt(dir, d) { let best = null, bd = 9; for (const L of this.built.lanes) if (L.dir === dir && Math.abs(L.d - d) < bd) { bd = Math.abs(L.d - d); best = L; } return best; }
  step(dt) {
    const g = this.g, pl = g.player; if (!pl) return;
    const near = Math.abs(pl.road.s - TOLL_S) < 700;
    if (near && !this.built) this.build();
    if (!near && this.built) this.clear();
    if (!this.built) return;
    this.t += dt;
    for (const L of this.built.lanes) L.want = 0;
    // trafic : télépéage pour tout le monde, les barrières s'ouvrent devant eux
    for (const c of g.traffic?.cars || []) {
      if (c.wreck) continue; const ds = (TOLL_S - c.s) * c.dir;
      if (ds > -6 && ds < 22) { const L = this.laneAt(c.dir, c.d); if (L) L.want = 1; }
    }
    // joueur (sens +s)
    const ds = TOLL_S + 1.5 - (pl.road.s + pl.def.len / 2), L = pl.road.d < 0 ? this.laneAt(1, pl.road.d) : null;
    if (L && !L.broken && ds > -3 && ds < 45) {
      if (!this.hinted) { this.hinted = true; g.hud?.msg(L.tele ? '🟠 <b>Péage</b> : voie télépéage, passe à moins de 30 km/h.' : '🎫 <b>Péage</b> : arrête-toi devant la barrière pour payer (ou prends la voie « t » à gauche).'); }
      if (L.tele) { if (pl.kmh < 32 && ds < 18) { L.want = 1; this.payOnce(L, 14.2, true); } }
      else if (pl.kmh < 3 && ds < 10 && ds > -0.5) { this.stopT = (this.stopT || 0) + dt; if (this.stopT > 1.4) { L.want = 1; this.payOnce(L, 18.4, false); } }
      else if (this.paid === L) L.want = 1;
      // barrière percutée fermée
      if (ds < 0.6 && ds > -2.5 && L.open < 0.5 && pl.kmh > 10) this.smash(L, pl);
    } else { this.stopT = 0; if (ds < -20) { this.hinted = false; this.paid = null; } }
    for (const R of g.remotes?.values?.() || []) { const rr = R.road || null; if (rr) { const LL = this.laneAt(rr.d < 0 ? 1 : -1, rr.d); if (LL && Math.abs(TOLL_S - rr.s) < 20) LL.want = 1; } }
    for (const L of this.built.lanes) {
      if (L.broken) continue;
      L.open += ((L.want ? 1 : 0) - L.open) * Math.min(1, dt * (L.want ? 3 : 1.4));
      L.arm.rotation.z = L.dir * L.open * 1.45;
      L.lamp.material.emissive.setHex(L.open > 0.8 ? 0x20ff40 : 0xff2020);
    }
  }
  payOnce(L, price, tele) {
    if (this.paid === L) return; this.paid = L;
    const g = this.g;
    if (g.mode !== 'online' || g.convoy) { profile.money = Math.max(0, profile.money - Math.round(price)); saveProfile(); }
    g.hud?.toast(tele ? `🟠 Bip ! Télépéage : ${price.toFixed(2).replace('.', ',')} €` : `🎫 Ticket payé : ${price.toFixed(2).replace('.', ',')} € — bonne route !`);
    g.audio?.beep?.(1500, 0.08, 0.08);
  }
  smash(L, v) {
    if (L.broken) return; L.broken = true;
    const g = this.g; L.arm.parent.remove(L.arm);
    const wp = v.curPos.clone(); wp.y = 1.1;
    for (let k = 0; k < 6; k++) g.spawnProp?.('carton', wp.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 0.5, (Math.random() - 0.5) * 2)), { x: v.lastV.x * 0.6 + (Math.random() - 0.5) * 4, y: 4 + Math.random() * 3, z: v.lastV.z * 0.6 + (Math.random() - 0.5) * 4 });
    g.audio?.crash?.(wp, 4);
    g.hud?.big('PÉAGE FORCÉ !', 'wanted');
    if (g.team === 'truck' && g.mode !== 'free') { g.heat = Math.min(100, (g.heat || 0) + 12); g.radio?.('Centrale : le poids lourd vient de forcer la barrière du péage de Champ-Fleuri !', 'pol'); }
    else if (g.mode === 'free') { const f = 135; profile.money = Math.max(0, profile.money - f); saveProfile(); g.hud?.toast(`📸 Barrière cassée : amende de ${f} €`); g.flashN = (g.flashN || 0) + 1; }
  }
  // le trafic ralentit dans la gare de péage
  speedCap(car) { const ds = (TOLL_S - car.s) * car.dir; return ds > -15 && ds < 90 ? Math.max(7, 7 + Math.max(0, ds - 25) * 0.35) : null; }
}
