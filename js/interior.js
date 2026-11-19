// Intérieur détaillé et vivant des véhicules du joueur (cabine de poids lourd ou habitacle de police) :
// planche de bord enveloppante, combiné d'instruments à aiguilles (canvas animé), écran GPS/multimédia,
// volant à branches, colonne, pédales, levier, sièges à suspension avec ceintures, contre-portes, pavillon,
// étagère de rangement + radio CB avec combiné au fil spiralé, pare-soleil, couchette avec rideau,
// objets suspendus qui réagissent aux accélérations (dés en peluche, sapin désodorisant, combiné CB),
// chien à tête oscillante, gobelet de café, photo de famille, plafonnier.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTex } from './models.js';
import { fmtTime, clamp } from './config.js';

const TRUCK_CAB = { delivery: { floor: 1.0, top: 3.1, cabLen: 2.0 }, flatbed: { floor: 1.08, top: 3.3, cabLen: 2.2 }, semi: { floor: 1.15, top: 3.55, cabLen: 2.4 } };

let M = null;
function mats() {
  if (M) return M;
  const fabric = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#2b2d33'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '80,84,96' : '20,20,24'},0.35)`; g.fillRect(Math.random() * w, Math.random() * h, 1, 1); }
    g.strokeStyle = 'rgba(150,150,160,0.35)'; g.setLineDash([4, 4]); g.lineWidth = 2;
    for (let x = 32; x < w; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  }, { repeat: true });
  const grain = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#1e1f23'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6000; i++) { const v = 20 + Math.random() * 25 | 0; g.fillStyle = `rgb(${v},${v},${v + 3})`; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
  }, { repeat: true });
  const headliner = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#9c9a94'; g.fillRect(0, 0, w, h); for (let i = 0; i < 5000; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } }, { repeat: true });
  M = {
    dash: new THREE.MeshStandardMaterial({ map: grain, roughness: 0.75, metalness: 0.05, color: 0xffffff }),
    dashLight: new THREE.MeshStandardMaterial({ color: 0x3a3c42, roughness: 0.6 }),
    fabric: new THREE.MeshStandardMaterial({ map: fabric, roughness: 0.95 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.45, metalness: 0.05 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.18, metalness: 1 }),
    alu: new THREE.MeshStandardMaterial({ color: 0x8a8e95, roughness: 0.35, metalness: 0.8 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x0e0e10, roughness: 0.9 }),
    headliner: new THREE.MeshStandardMaterial({ map: headliner, roughness: 1, side: THREE.DoubleSide }),
    wood: new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.55 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xe8b81a, roughness: 0.5 }),
    red: new THREE.MeshStandardMaterial({ color: 0xc22020, roughness: 0.5 }),
    white: new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.7 }),
    blanket: new THREE.MeshStandardMaterial({ color: 0x3d5a8a, roughness: 1 }),
    curtain: new THREE.MeshStandardMaterial({ color: 0x5a2a2a, roughness: 1, side: THREE.DoubleSide }),
    green: new THREE.MeshStandardMaterial({ color: 0x1f8a3a, roughness: 0.7, side: THREE.DoubleSide }),
    fluffy: new THREE.MeshStandardMaterial({ color: 0xff3fa0, roughness: 1 }),
    led: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x30ff60, emissiveIntensity: 1.5 }),
    ledR: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff3030, emissiveIntensity: 1.5 }),
    ledB: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x3070ff, emissiveIntensity: 1.5 }),
    dome: new THREE.MeshStandardMaterial({ color: 0xfff4dc, emissive: 0xfff0d0, emissiveIntensity: 0.2 }),
    cable: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 }),
    dog: new THREE.MeshStandardMaterial({ color: 0xb07a40, roughness: 0.8 }),
  };
  return M;
}

class Kit { // fusion de géométries par matériau (statique)
  constructor() { this.p = new Map(); }
  add(mat, geo, x, y, z, rx = 0, ry = 0, rz = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z);
    if (!this.p.has(mat)) this.p.set(mat, []);
    this.p.get(mat).push(g); return g;
  }
  box(mat, w, h, d, x, y, z, rx, ry, rz, r = 0) { return this.add(mat, r ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz); }
  cyl(mat, r1, r2, h, x, y, z, rx, ry, rz, seg = 16) { return this.add(mat, new THREE.CylinderGeometry(r1, r2, h, seg), x, y, z, rx, ry, rz); }
  build(group) {
    for (const [mat, list] of this.p) {
      for (const g of list) for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      const m = new THREE.Mesh(mergeGeometries(list, false), mat); m.receiveShadow = true; m.castShadow = false; group.add(m);
    }
  }
}

function pendulum(L) { return { L, ax: 0, az: 0, vx: 0, vz: 0 }; }
function stepPend(p, acc, dt) {
  const g = 9.81, c = 1.6;
  const fx = -(g / p.L) * Math.sin(p.ax) - (acc.z / p.L) * Math.cos(p.ax) - c * p.vx; // avant/arrière
  const fz = -(g / p.L) * Math.sin(p.az) - (acc.x / p.L) * Math.cos(p.az) - c * p.vz; // latéral
  p.vx += fx * dt; p.vz += fz * dt; p.ax += p.vx * dt; p.az += p.vz * dt;
  p.ax = clamp(p.ax, -1.2, 1.2); p.az = clamp(p.az, -1.2, 1.2);
}

export class Interior {
  constructor(v) {
    this.v = v; const def = v.def, m = mats();
    this.truck = def.team === 'truck';
    this.group = new THREE.Group(); this.group.name = 'interior';
    const K = new Kit(), cab = def.cab, dx = cab.x;
    let F, B, T, front, rear, W;
    if (this.truck) {
      const c = TRUCK_CAB[def.id]; F = c.floor; B = F + 0.95; T = B + 0.93; front = def.len / 2 - 0.14; rear = def.len / 2 - c.cabLen + 0.12; W = def.w / 2 - 0.08;
    } else {
      B = cab.belt; F = (def.id === 'suv' ? 0.42 : 0.3) + 0.07; T = (def.id === 'suv' ? 1.78 : def.id === 'wagon' ? 1.5 : 1.42) - 0.06; front = cab.wz + 0.05; rear = front - 2.4; W = def.w / 2 - 0.1;
    }
    Object.assign(this, { F, B, T, front, rear, W });
    const dashD = this.truck ? 0.6 : 0.62, dz = front - dashD / 2; // planche de bord
    const eyeY = cab.y, seatZ = cab.z - (this.truck ? 0.05 : 0.0);

    // --- planche de bord enveloppante ---
    K.box(m.dash, W * 2, B - F - 0.25, dashD, 0, (B + F + 0.25) / 2 - 0.05, dz, 0, 0, 0, 0.05);
    K.box(m.dash, W * 2 - 0.02, 0.06, dashD + 0.05, 0, B + 0.02, dz - 0.02, -0.08, 0, 0, 0.03); // dessus
    K.box(m.dash, 0.56, 0.035, 0.2, dx, B + 0.2, dz - 0.16, -0.1, 0, 0, 0.015); // casquette du combiné
    // aile centrale orientée vers le conducteur
    // console centrale + accoudoir (voiture) / tunnel moteur (camion)
    if (this.truck) K.box(m.dashLight, 0.62, 0.32, front - rear - dashD - 0.6, 0, F + 0.16, (front - dashD + rear + 0.6) / 2, 0, 0, 0, 0.08);
    else { K.box(m.dash, 0.22, 0.3, 0.75, 0, F + 0.2, dz - dashD / 2 - 0.35, 0, 0, 0, 0.04); K.box(m.leather, 0.2, 0.08, 0.32, 0, B - 0.15, seatZ - 0.15, 0, 0, 0, 0.03); }
    // aérateurs + rangées de boutons
    for (const x of [-W + 0.15, -0.15, 0.15, W - 0.15]) { K.box(m.rubber, 0.16, 0.06, 0.03, x, B - 0.06, front - dashD - 0.0, 0, 0, 0); for (let i = 0; i < 4; i++) K.box(m.alu, 0.14, 0.005, 0.035, x, B - 0.08 + i * 0.013, front - dashD + 0.005, 0, 0, 0); }
    for (let r = 0; r < 2; r++) for (let i = 0; i < 6; i++) K.box(i % 3 ? m.dashLight : m.alu, 0.05, 0.03, 0.02, dx - 0.95 + i * 0.07, B - 0.28 - r * 0.06, front - dashD + 0.09, -0.25, 0.35, 0);
    // boîte à gants
    K.box(m.dash, 0.5, 0.22, 0.02, -dx, B - 0.22, front - dashD - 0.005, 0, 0, 0, 0.01);
    K.box(m.chrome, 0.1, 0.02, 0.02, -dx, B - 0.14, front - dashD - 0.02, 0, 0, 0);
    // joint du pare-brise
    K.box(m.rubber, W * 2, 0.04, 0.04, 0, B + 0.06, front - 0.02, 0, 0, 0);
    // colonne + volant
    // volant face au conducteur, sous le combiné (on lit les compteurs au-dessus de la jante)
    const wheelY = eyeY - (this.truck ? 0.56 : 0.36), wheelZ = cab.z + (this.truck ? 0.56 : 0.47), tilt = this.truck ? -0.6 : -0.32;
    const colDir = new THREE.Vector3(0, -Math.sin(-tilt) * 0 - 0.55, 0.83).normalize(), colL = this.truck ? 0.55 : 0.4;
    K.cyl(m.leather, 0.045, 0.06, colL, dx, wheelY + colDir.y * colL / 2, wheelZ + colDir.z * colL / 2, Math.atan2(colDir.z, colDir.y), 0, 0);
    K.box(m.leather, 0.16, 0.12, 0.14, dx, wheelY + colDir.y * colL * 0.9, wheelZ + colDir.z * colL * 0.9, 0, 0, 0, 0.03); // carénage de colonne
    for (const sx2 of [-1, 1]) K.box(m.leather, 0.12, 0.02, 0.02, dx + sx2 * 0.1, wheelY + colDir.y * 0.12, wheelZ + colDir.z * 0.12 + 0.02, 0, 0, sx2 * 0.2); // commodos
    // pédales
    for (const [i, px] of [[0, 0.16], [1, 0], [2, -0.14]]) K.box(m.alu, i === 2 ? 0.12 : 0.08, 0.14, 0.03, dx + px, F + 0.18, dz - dashD / 2 - 0.05, -0.5, 0, 0);
    // levier / frein de parc
    K.cyl(m.leather, 0.012, 0.016, 0.16, dx - 0.34, B - 0.2, front - dashD - 0.05, 0.6, 0, 0);
    K.add(m.yellow, new THREE.SphereGeometry(0.025, 10, 8), dx - 0.34, B - 0.13, front - dashD - 0.1);

    // --- sièges (driver + passager) ---
    for (const sx of [dx, -dx]) {
      const sy = F + (this.truck ? 0.48 : 0.28);
      K.box(m.alu, 0.38, this.truck ? 0.3 : 0.1, 0.4, sx, sy - (this.truck ? 0.22 : 0.08), seatZ - 0.05);         // suspension pneumatique
      K.box(m.fabric, 0.52, 0.14, 0.52, sx, sy, seatZ - 0.05, 0, 0, 0, 0.06);                                     // assise
      K.box(m.fabric, 0.52, 0.72, 0.14, sx, sy + 0.42, seatZ - 0.36, 0.18, 0, 0, 0.06);                          // dossier
      K.box(m.leather, 0.12, 0.6, 0.16, sx + 0.24, sy + 0.4, seatZ - 0.34, 0.18, 0, 0, 0.05); K.box(m.leather, 0.12, 0.6, 0.16, sx - 0.24, sy + 0.4, seatZ - 0.34, 0.18, 0, 0, 0.05); // maintiens
      K.box(m.fabric, 0.3, 0.2, 0.12, sx, sy + 0.9, seatZ - 0.46, 0.18, 0, 0, 0.05);                              // appui-tête
      K.box(m.rubber, 0.05, 0.85, 0.01, sx + 0.06, sy + 0.38, seatZ - 0.27, 0.18, 0, 0.55);                      // ceinture
      K.box(m.chrome, 0.05, 0.03, 0.02, sx - 0.12, sy + 0.1, seatZ - 0.15, 0, 0, 0);
      if (this.truck) K.box(m.leather, 0.06, 0.06, 0.3, sx + (sx > 0 ? -0.3 : 0.3), sy + 0.25, seatZ - 0.1, 0, 0, 0, 0.02); // accoudoir
    }
    if (!this.truck) { // banquette arrière
      K.box(m.fabric, W * 1.8, 0.14, 0.5, 0, F + 0.3, seatZ - 0.95, 0, 0, 0, 0.05);
      K.box(m.fabric, W * 1.8, 0.6, 0.12, 0, F + 0.62, seatZ - 1.22, 0.15, 0, 0, 0.05);
      K.box(m.alu, W * 1.9, 0.6, 0.02, 0, B + 0.15, seatZ - 0.62); // grille de séparation
    }
    // --- contre-portes ---
    for (const sx of [1, -1]) {
      const x = sx * (W - 0.02);
      K.box(m.dash, 0.05, B - F - 0.1, front - rear - dashD, x, (B + F) / 2, (front - dashD + rear) / 2 + 0.1, 0, 0, 0, 0.02);
      K.box(m.leather, 0.1, 0.05, 0.5, x - sx * 0.05, B - 0.22, seatZ + 0.05, 0, 0, 0, 0.02);          // accoudoir
      K.box(m.chrome, 0.03, 0.04, 0.14, x - sx * 0.05, B - 0.08, seatZ + 0.22, 0, 0, 0);               // poignée
      K.cyl(m.rubber, 0.07, 0.07, 0.02, x - sx * 0.03, F + 0.25, seatZ + 0.25, 0, 0, Math.PI / 2, 14); // haut-parleur
      K.box(m.dashLight, 0.04, 0.12, 0.4, x - sx * 0.03, F + 0.22, seatZ - 0.15, 0, 0, 0);              // vide-poche
      for (let i = 0; i < 2; i++) K.box(m.alu, 0.03, 0.015, 0.04, x - sx * 0.06, B - 0.19, seatZ - 0.05 + i * 0.06, 0, 0, 0); // lève-vitres
      // montant + poignée de maintien
      K.box(m.dash, 0.06, T - B, 0.1, x - sx * 0.02, (T + B) / 2, front - 0.08, -0.08, 0, 0);
      if (this.truck) K.cyl(m.leather, 0.018, 0.018, 0.45, x - sx * 0.08, B + 0.45, front - 0.18, 0, 0, 0, 8);
    }
    // --- pavillon ---
    K.box(m.headliner, W * 2, 0.02, front - rear, 0, T, (front + rear) / 2);
    K.box(m.dome, 0.25, 0.03, 0.1, 0, T - 0.02, (front + rear) / 2);
    // pare-soleil
    K.box(m.fabric, 0.55, 0.02, 0.24, dx, T - 0.05, front - 0.2, 0.25, 0, 0, 0.01);
    K.box(m.fabric, 0.55, 0.02, 0.24, -dx, T - 0.03, front - 0.16, 0.05, 0, 0, 0.01);

    let cbPos = null, dicePos, treePos;
    if (this.truck) {
      // étagère de rangement au-dessus du pare-brise avec casiers
      const sh = 0.2;
      K.box(m.dash, W * 2, sh, 0.36, 0, T - sh / 2, front - 0.4, 0, 0, 0, 0.03);
      for (let i = -2; i <= 2; i++) K.box(m.dashLight, 0.36, 0.14, 0.01, i * 0.42, T - sh / 2, front - 0.585, 0, 0, 0, 0.01);
      // radio CB
      cbPos = new THREE.Vector3(-dx + 0.05, T - sh - 0.05, front - 0.55);
      K.box(m.leather, 0.32, 0.08, 0.2, cbPos.x, cbPos.y, cbPos.z);
      K.box(m.led, 0.1, 0.025, 0.005, cbPos.x + 0.05, cbPos.y, cbPos.z - 0.102);
      for (let i = 0; i < 3; i++) K.cyl(m.alu, 0.015, 0.015, 0.02, cbPos.x - 0.12 + i * 0.05, cbPos.y, cbPos.z - 0.11, Math.PI / 2, 0, 0, 10);
      // tachygraphe
      K.box(m.leather, 0.25, 0.06, 0.18, 0.25, T - sh - 0.03, front - 0.5); K.box(m.ledR, 0.06, 0.015, 0.005, 0.25, T - sh - 0.03, front - 0.592);
      // couchette avec matelas, couverture, oreiller, rideau (cabine longue du semi uniquement)
      if (def.id === 'semi') {
      const bz = rear + 0.27;
      K.box(m.dashLight, W * 2, 0.5, 0.52, 0, F + 0.25, bz);
      K.box(m.fabric, W * 2 - 0.05, 0.14, 0.5, 0, F + 0.57, bz, 0, 0, 0, 0.05);
      K.box(m.blanket, W * 1.3, 0.08, 0.46, -0.25, F + 0.66, bz, 0, 0, 0.04, 0.04);
      K.box(m.white, 0.42, 0.12, 0.28, W - 0.3, F + 0.69, bz, 0, 0.2, 0, 0.06);
      for (let i = 0; i < 6; i++) K.box(m.curtain, 0.18, T - F - 0.7, 0.03, -W + 0.1 + i * 0.16, (T + F + 0.7) / 2, bz + 0.28 + (i % 2) * 0.04, 0, 0.5 * (i % 2 ? 1 : -1), 0);
      K.cyl(m.chrome, 0.012, 0.012, W * 2, 0, T - 0.05, bz + 0.3, 0, 0, Math.PI / 2, 8);
      }
      dicePos = new THREE.Vector3(0.05, T - sh, front - 0.62);
      treePos = new THREE.Vector3(-0.35, T - sh, front - 0.62);
    } else {
      // rétroviseur intérieur
      K.box(m.leather, 0.26, 0.07, 0.03, 0, T - 0.1, front - 0.12, 0.2, 0, 0, 0.02);
      this.innerMirror = new THREE.Vector3(0, T - 0.1, front - 0.15);
      // contrôleur sirène + radio police
      K.box(m.leather, 0.2, 0.08, 0.18, 0, B - 0.12, dz - dashD / 2 - 0.2, -0.3, 0, 0, 0.02);
      cbPos = new THREE.Vector3(-0.05, B - 0.05, dz - dashD / 2 - 0.25);
      dicePos = new THREE.Vector3(0, T - 0.14, front - 0.12);
      treePos = null;
    }
    K.build(this.group);

    // --- éléments dynamiques ---
    // volant
    this.wheel = new THREE.Group(); this.wheel.position.set(dx, wheelY, wheelZ); this.wheel.rotation.x = tilt;
    const spin = new THREE.Group(); this.wheel.add(spin); this.wheelSpin = spin;
    const R = this.truck ? 0.25 : 0.19;
    spin.add(new THREE.Mesh(new THREE.TorusGeometry(R, 0.028, 10, 36), m.leather));
    for (const a of [Math.PI / 2, Math.PI * 7 / 6, Math.PI * 11 / 6]) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.035, R, 0.02), m.alu); sp.position.set(Math.cos(a) * R / 2, Math.sin(a) * R / 2, 0); sp.rotation.z = a - Math.PI / 2; spin.add(sp); }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.05, 20), m.leather); hub.rotation.x = Math.PI / 2; spin.add(hub);
    const logo = new THREE.Mesh(new THREE.CircleGeometry(0.045, 20), new THREE.MeshStandardMaterial({ map: canvasTex(64, 64, (g) => { g.fillStyle = '#222'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#ddd'; g.font = '700 26px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(this.truck ? 'TT' : '★', 32, 34); }), metalness: 0.6, roughness: 0.3 }));
    logo.position.z = -0.03; logo.rotation.y = Math.PI; spin.add(logo);
    this.group.add(this.wheel);

    // combiné d'instruments (canvas animé)
    this.gC = document.createElement('canvas'); this.gC.width = 512; this.gC.height = 192; this.gX = this.gC.getContext('2d');
    this.gTex = new THREE.CanvasTexture(this.gC); this.gTex.colorSpace = THREE.SRGBColorSpace;
    this.gMat = new THREE.MeshStandardMaterial({ map: this.gTex, emissive: 0xffffff, emissiveMap: this.gTex, emissiveIntensity: 0.6, roughness: 0.3 });
    const gauge = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.195), this.gMat);
    gauge.position.set(dx, B + 0.1, dz - 0.2); gauge.rotation.set(-0.35, Math.PI, 0); this.group.add(gauge);
    // écran central
    this.sC = document.createElement('canvas'); this.sC.width = 384; this.sC.height = 240; this.sX = this.sC.getContext('2d');
    this.sTex = new THREE.CanvasTexture(this.sC); this.sTex.colorSpace = THREE.SRGBColorSpace;
    this.sMat = new THREE.MeshStandardMaterial({ map: this.sTex, emissive: 0xffffff, emissiveMap: this.sTex, emissiveIntensity: 0.75, roughness: 0.2 });
    const scrW = this.truck ? 0.4 : 0.3, scrH = scrW * 0.625;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(scrW, scrH), this.sMat);
    const sxp = this.truck ? dx - 0.6 : 0, syp = B + scrH / 2 + 0.03, szp = front - dashD + 0.2;
    scr.position.set(sxp, syp, szp); scr.rotation.set(-0.12, Math.PI + (this.truck ? 0.38 : 0), 0); this.group.add(scr);
    const bez = new THREE.Mesh(new RoundedBoxGeometry(scrW + 0.03, scrH + 0.03, 0.025, 2, 0.008), m.leather); bez.position.copy(scr.position); bez.rotation.copy(scr.rotation); bez.translateZ(-0.016); this.group.add(bez);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.05), m.leather); foot.position.set(sxp, B + 0.04, szp + 0.03); this.group.add(foot);
    // voyants de la console police
    if (!this.truck) { this.ledB = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.05), m.ledB.clone()); this.ledR = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.05), m.ledR.clone()); this.ledB.position.set(0.05, B - 0.075, dz - dashD / 2 - 0.2); this.ledR.position.set(-0.05, B - 0.075, dz - dashD / 2 - 0.2); this.group.add(this.ledB, this.ledR); }

    // dés en peluche (pendule)
    this.dice = new THREE.Group(); this.dice.position.copy(dicePos); this.dicePend = pendulum(0.2);
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.18, 4), m.white); string.position.y = -0.09; this.dice.add(string);
    const dieTex = canvasTex(64, 64, (g) => { g.fillStyle = '#ff3fa0'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#fff'; for (const [x, y] of [[16, 16], [48, 48], [32, 32], [16, 48], [48, 16]]) { g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); } });
    for (const ox of [-0.04, 0.045]) { const d = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.07, 0.07, 2, 0.015), new THREE.MeshStandardMaterial({ map: dieTex, roughness: 1 })); d.position.set(ox, -0.2 - (ox > 0 ? 0.03 : 0), 0); d.rotation.set(0.3, ox * 10, 0.2); this.dice.add(d); }
    this.group.add(this.dice);
    // sapin désodorisant
    if (treePos) {
      this.tree = new THREE.Group(); this.tree.position.copy(treePos); this.treePend = pendulum(0.14);
      const s2 = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.08, 4), m.white); s2.position.y = -0.04; this.tree.add(s2);
      const shape = new THREE.Shape([[0, 0], [0.04, -0.04], [0.02, -0.04], [0.05, -0.08], [0.025, -0.08], [0.06, -0.12], [0.008, -0.12], [0.008, -0.14], [-0.008, -0.14], [-0.008, -0.12], [-0.06, -0.12], [-0.025, -0.08], [-0.05, -0.08], [-0.02, -0.04], [-0.04, -0.04]].map(([x, y]) => new THREE.Vector2(x, y)));
      const tm = new THREE.Mesh(new THREE.ShapeGeometry(shape), m.green); tm.position.y = -0.08; this.tree.add(tm);
      this.group.add(this.tree);
    }
    // combiné CB au fil spiralé
    if (cbPos) {
      this.mic = new THREE.Group(); this.mic.position.copy(cbPos).add(new THREE.Vector3(0.12, -0.04, -0.08)); this.micPend = pendulum(0.28);
      class Helix extends THREE.Curve { getPoint(t, o = new THREE.Vector3()) { const a = t * Math.PI * 2 * 14; return o.set(Math.cos(a) * 0.012, -t * 0.24, Math.sin(a) * 0.012); } }
      this.mic.add(new THREE.Mesh(new THREE.TubeGeometry(new Helix(), 200, 0.003, 4), m.cable));
      const hs = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.1, 0.035, 2, 0.012), m.leather); hs.position.y = -0.29; this.mic.add(hs);
      this.group.add(this.mic);
    }
    // chien à tête oscillante + gobelet de café + photo
    const dogX = -dx + 0.25, dogY = B + 0.08, dogZ = front - dashD + 0.12;
    const dogB = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.05, 0.1, 2, 0.02), m.dog); dogB.position.set(dogX, dogY + 0.025, dogZ); this.group.add(dogB);
    this.dogHead = new THREE.Group(); this.dogHead.position.set(dogX, dogY + 0.06, dogZ - 0.04); this.dogPend = { y: 0, v: 0, p: 0, pv: 0 };
    const dh = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.055, 0.06, 2, 0.02), m.dog); dh.position.y = 0.03; this.dogHead.add(dh);
    for (const ex of [-0.025, 0.025]) { const ear = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.035, 0.03), new THREE.MeshStandardMaterial({ color: 0x5a3a1a })); ear.position.set(ex, 0.045, 0.01); ear.rotation.z = ex * 12; this.dogHead.add(ear); }
    this.group.add(this.dogHead);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.028, 0.1, 14), m.white); cup.position.set(this.truck ? -0.12 : 0, this.truck ? F + 0.37 : F + 0.4, this.truck ? dz - dashD / 2 - 0.15 : dz - dashD / 2 - 0.55); this.group.add(cup);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.037, 0.015, 14), m.red); lid.position.copy(cup.position).y += 0.055; this.group.add(lid);
    const photo = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.065), new THREE.MeshStandardMaterial({ map: canvasTex(128, 96, (g) => { g.fillStyle = '#f3efe2'; g.fillRect(0, 0, 128, 96); g.fillStyle = '#7fb8e8'; g.fillRect(6, 6, 116, 50); g.fillStyle = '#4a8a3a'; g.fillRect(6, 56, 116, 34); const ppl = [[30, '#c84'], [55, '#e9b'], [80, '#97c'], [100, '#c96']]; for (const [x, c] of ppl) { g.fillStyle = c; g.fillRect(x - 6, 48, 12, 28); g.fillStyle = '#e8c09a'; g.beginPath(); g.arc(x, 42, 7, 0, 7); g.fill(); } g.fillStyle = '#c33'; g.font = '700 10px Arial'; g.fillText('Papa ♥', 8, 88); }) }));
    photo.position.set(dx + 0.3, B + 0.1, front - dashD + 0.08); photo.rotation.set(-0.3, Math.PI - 0.3, 0); this.group.add(photo);

    // --- rétroviseurs extérieurs avec vrai reflet (rendu dans une texture) ---
    this.mirrors = [];
    if (this.truck) for (const sx of [1, -1]) {
      const wo = def.w / 2, mz = front + 0.02, my = B + 0.38, mx = sx * (wo + 0.36);
      const rt = new THREE.WebGLRenderTarget(192, 384, { samples: 0 }); rt.texture.colorSpace = THREE.SRGBColorSpace;
      const glassMat = new THREE.MeshBasicMaterial({ map: rt.texture, color: 0xdde6ee });
      const arms = new Kit();
      for (const ay of [my + 0.3, my - 0.26]) { // bras supérieur et inférieur fixés au montant
        const ax0 = sx * (wo - 0.02), len = Math.abs(mx - ax0);
        arms.cyl(m.leather, 0.018, 0.018, len + 0.05, (ax0 + mx) / 2, ay, mz - 0.18, 0, 0.35 * sx, Math.PI / 2, 8);
        arms.box(m.leather, 0.06, 0.08, 0.06, ax0, ay, mz - 0.25);
      }
      arms.box(m.leather, 0.1, 0.62, 0.26, mx, my, mz - 0.02, 0, 0, 0, 0.03);           // coque principale
      arms.box(m.leather, 0.1, 0.24, 0.24, mx, my - 0.48, mz - 0.02, 0, 0, 0, 0.03);    // miroir grand angle
      arms.cyl(m.leather, 0.015, 0.015, 0.16, mx, my - 0.33, mz - 0.02, 0, 0, 0, 8);
      arms.build(this.group);
      const pg = new THREE.PlaneGeometry(0.22, 0.56); const uv = pg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
      const glass = new THREE.Mesh(pg, glassMat); glass.position.set(mx, my, mz - 0.155); glass.rotation.y = Math.PI + sx * 0.18; this.group.add(glass);
      const pg2 = new THREE.PlaneGeometry(0.2, 0.2); const uv2 = pg2.attributes.uv; for (let i = 0; i < uv2.count; i++) { uv2.setX(i, 1 - uv2.getX(i)); uv2.setY(i, uv2.getY(i) * 0.4 + 0.1); }
      const g2 = new THREE.Mesh(pg2, glassMat); g2.position.set(mx, my - 0.48, mz - 0.145); g2.rotation.y = Math.PI + sx * 0.3; this.group.add(g2);
      const anchor = new THREE.Object3D(); anchor.position.set(mx + sx * 0.02, my, mz - 0.25); anchor.rotation.y = Math.PI - sx * 0.12; this.group.add(anchor);
      this.mirrors.push({ sx, rt, anchor });
    }
    if (this.innerMirror) {
      const rt = new THREE.WebGLRenderTarget(320, 96); rt.texture.colorSpace = THREE.SRGBColorSpace;
      const pg = new THREE.PlaneGeometry(0.24, 0.065); const uv = pg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
      const glass = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ map: rt.texture, color: 0xdde6ee })); glass.position.copy(this.innerMirror); glass.rotation.set(-0.2, Math.PI, 0); this.group.add(glass);
      const anchor = new THREE.Object3D(); anchor.position.copy(this.innerMirror).add(new THREE.Vector3(0, 0.02, -0.25)); anchor.rotation.y = Math.PI; this.group.add(anchor);
      this.mirrors.push({ sx: 0, rt, anchor, aspect: 3.3, fov: 18 });
    }
    this.mirrorCam = new THREE.PerspectiveCamera(22, 0.5, 0.3, 900);
    this.mirrorI = 0;

    this.t = 0; this.drawT = 0; this.acc = new THREE.Vector3();
  }

  // un rétroviseur rafraîchi par image (alternance gauche/droite)
  renderMirrors(renderer, scene) {
    if (!this.mirrors.length) return;
    const mr = this.mirrors[this.mirrorI++ % this.mirrors.length];
    mr.anchor.updateWorldMatrix(true, false);
    mr.anchor.getWorldPosition(this.mirrorCam.position); mr.anchor.getWorldQuaternion(this.mirrorCam.quaternion);
    this.mirrorCam.aspect = mr.aspect || 0.5; this.mirrorCam.fov = mr.fov || 22; this.mirrorCam.updateProjectionMatrix();
    this.mirrorCam.rotateY(Math.PI); // la caméra regarde vers l'arrière
    const old = renderer.getRenderTarget(), xr = renderer.xr.enabled, sh = renderer.shadowMap.autoUpdate;
    renderer.xr.enabled = false; renderer.shadowMap.autoUpdate = false;
    this.group.visible = false;
    renderer.setRenderTarget(mr.rt); renderer.render(scene, this.mirrorCam);
    renderer.setRenderTarget(old); renderer.xr.enabled = xr; renderer.shadowMap.autoUpdate = sh;
    this.group.visible = true;
  }

  update(dt, game, active) {
    const v = this.v, a = v.accL || this.acc;
    this.wheelSpin.rotation.z = -v.steer * (this.truck ? 5.5 : 7);
    if (!active) return;
    this.t += dt;
    const acc = { x: a.x, z: a.z };
    stepPend(this.dicePend, acc, dt); this.dice.rotation.set(-this.dicePend.ax, 0, this.dicePend.az);
    if (this.tree) { stepPend(this.treePend, acc, dt); this.tree.rotation.set(-this.treePend.ax, Math.sin(this.t * 0.7) * 0.6, this.treePend.az); }
    if (this.mic) { stepPend(this.micPend, acc, dt); this.mic.rotation.set(-this.micPend.ax, 0, this.micPend.az); }
    // tête du chien : ressort excité par les secousses verticales et les accélérations
    const d = this.dogPend;
    d.v += (-60 * d.y - 3 * d.v - (a.y || 0) * 2 - a.z * 0.6) * dt; d.y += d.v * dt;
    d.pv += (-50 * d.p - 2.5 * d.pv - a.x * 0.8) * dt; d.p += d.pv * dt;
    this.dogHead.rotation.set(clamp(d.y, -0.6, 0.6), 0, clamp(d.p, -0.6, 0.6));
    const night = game.env.night;
    this.gMat.emissiveIntensity = 0.35 + night * 0.9; this.sMat.emissiveIntensity = 0.45 + night * 0.8;
    if (this.ledB) { const on = v.siren; this.ledB.material.emissiveIntensity = on && v.flashA ? 4 : 0.2; this.ledR.material.emissiveIntensity = on && v.flashB ? 4 : 0.2; }
    this.drawT -= dt;
    if (this.drawT <= 0) { this.drawT = 1 / 20; this.drawGauges(game); this.drawScreen(game); }
  }

  drawGauges(game) {
    const g = this.gX, v = this.v, W = 512, H = 192, def = v.def;
    g.fillStyle = '#050608'; g.fillRect(0, 0, W, H);
    const dial = (cx, val, max, label, step, red) => {
      const R = 78, a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
      g.strokeStyle = '#1d222a'; g.lineWidth = 2; g.beginPath(); g.arc(cx, 96, R + 6, 0, 7); g.stroke();
      for (let k = 0; k <= max; k += step) {
        const a = a0 + (a1 - a0) * k / max, big = (k / step) % 2 === 0;
        g.strokeStyle = red && k >= red ? '#ff3b2f' : '#dfe8f2'; g.lineWidth = big ? 3 : 1.5;
        g.beginPath(); g.moveTo(cx + Math.cos(a) * (R - (big ? 14 : 9)), 96 + Math.sin(a) * (R - (big ? 14 : 9))); g.lineTo(cx + Math.cos(a) * R, 96 + Math.sin(a) * R); g.stroke();
        if (big) { g.fillStyle = '#cfd9e6'; g.font = '600 13px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(max > 300 ? k / 1000 : k, cx + Math.cos(a) * (R - 26), 96 + Math.sin(a) * (R - 26)); }
      }
      const an = a0 + (a1 - a0) * clamp(val / max);
      g.strokeStyle = '#ff4a2a'; g.lineWidth = 3.5; g.beginPath(); g.moveTo(cx - Math.cos(an) * 10, 96 - Math.sin(an) * 10); g.lineTo(cx + Math.cos(an) * (R - 6), 96 + Math.sin(an) * (R - 6)); g.stroke();
      g.fillStyle = '#222'; g.beginPath(); g.arc(cx, 96, 8, 0, 7); g.fill();
      g.fillStyle = '#7d8a99'; g.font = '600 11px Arial'; g.fillText(label, cx, 140);
    };
    const vmax = def.vmax > 150 ? 260 : 140;
    dial(96, v.kmh, vmax, 'km/h', vmax > 150 ? 20 : 10);
    dial(W - 96, v.rpm, Math.ceil(def.red / 500) * 500 + 500, 'x1000 tr/min', 500, def.red);
    // écran central : rapport, carburant, heure, voyants
    g.fillStyle = '#0c1a24'; g.fillRect(186, 22, 140, 148);
    g.fillStyle = '#7fd8ff'; g.font = '700 46px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(v.reverse ? 'R' : (v.kmh < 1 && v.thr < 0.05 ? 'N' : 'D' + v.gear), 256, 62);
    g.font = '600 15px Arial'; g.fillText(Math.round(v.kmh) + ' km/h', 256, 100);
    const fuel = game.coop ? game.coop.fuel / 100 : 0.8;
    g.fillStyle = '#26323c'; g.fillRect(200, 120, 112, 8); g.fillStyle = fuel < 0.2 ? '#ff3b2f' : '#3fd07a'; g.fillRect(200, 120, 112 * fuel, 8);
    g.fillStyle = '#8fa3b5'; g.font = '600 11px Arial'; g.fillText('⛽', 192, 124);
    const h = game.env.timeOfDay; g.fillText(String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.floor((h % 1) * 60)).padStart(2, '0') + '   ' + Math.round(v.road.s / 100) / 10 + ' km', 256, 150);
    const bl = v.blink && (performance.now() % 760) < 380;
    g.fillStyle = bl && (v.blink & 1) ? '#3fd07a' : '#1a2027'; g.font = '700 22px Arial'; g.fillText('◀', 200, 40); g.fillStyle = bl && (v.blink & 2) ? '#3fd07a' : '#1a2027'; g.fillText('▶', 312, 40);
    if (v.manual) { g.fillStyle = '#ffb35c'; g.font = '700 11px Arial'; g.fillText('MANUELLE', 256, 112); }
    const leds = [['P', v.handbrake, '#ff3b2f'], ['💡', v.headlights, '#3fd07a'], ['⚠', v.damage > 50, '#ffb020'], ['🚨', v.siren, '#3070ff'], ['❄', game.env.wet > 0.5, '#7fd8ff']];
    leds.forEach(([t, on, c], i) => { g.fillStyle = on ? c : '#1a2027'; g.font = '700 14px Arial'; g.fillText(t, 26 + i * 30 + (i > 2 ? 360 : 0), 178); });
    this.gTex.needsUpdate = true;
  }

  drawScreen(game) {
    const g = this.sX, W = 384, H = 240;
    g.fillStyle = '#0b1016'; g.fillRect(0, 0, W, H);
    const map = document.getElementById('minimap');
    if (map) g.drawImage(map, 6, 26, 180, 180);
    g.fillStyle = '#1b2733'; g.fillRect(0, 0, W, 22);
    g.fillStyle = '#cfe3f5'; g.font = '600 13px Arial'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText(this.truck ? 'NAVI • A77 → Sortie 18' : 'POLICE • MODE POURSUITE', 8, 11);
    g.textAlign = 'right'; g.fillText(fmtTime(game.timeLeft ?? 0), W - 8, 11);
    g.textAlign = 'left';
    const lines = [document.getElementById('gps-i')?.textContent || '', document.getElementById('gps-d')?.textContent || ''];
    g.fillStyle = '#ffb35c'; g.font = '700 16px Arial'; wrap(g, lines[0], 196, 50, 180, 19);
    g.fillStyle = '#ffffff'; g.font = '700 30px Arial'; g.fillText(lines[1], 196, 120);
    if (game.coop) {
      const st = ['RADIO ÉTEINTE', 'TECHNO ROUTIÈRE 98.7', 'BERCEUSE FM', 'RADIO MUSETTE'][game.coop.station];
      g.fillStyle = '#7fd8ff'; g.font = '600 12px Arial'; g.fillText('♪ ' + st, 196, 160);
      g.fillStyle = '#8fa3b5'; g.fillText('Conducteur : ' + game.coop.drv.name, 196, 182);
    } else {
      g.fillStyle = '#8fa3b5'; g.font = '600 12px Arial'; g.fillText(this.truck ? 'Cargaison : Tomme Dorée 22 t' : 'Cible : poids lourd volé', 196, 160);
    }
    g.fillStyle = '#3fd07a'; g.fillRect(196, 200, 170 * clamp(1 - this.v.damage / 100), 6); g.fillStyle = '#8fa3b5'; g.font = '600 11px Arial'; g.fillText('État du véhicule', 196, 220);
    this.sTex.needsUpdate = true;
  }
}

function wrap(g, text, x, y, maxW, lh) {
  const words = text.split(' '); let line = '';
  for (const w of words) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > maxW && line) { g.fillText(line, x, y); y += lh; line = w; } else line = t; }
  g.fillText(line, x, y);
}
