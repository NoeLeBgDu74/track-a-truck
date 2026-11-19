// Autoroute générée progressivement par tronçons de 200 m (maillages + collisions Rapier)
import * as THREE from 'three';
import {
  clamp, HALF, RAIL, EDGE, INNER, LANE_W, cx, roadYaw, roadToWorld, worldToRoad, TUNNELS, REST_AREAS, OVERPASSES, DEST, DEST_S, EXIT_GAP,
  railOpen, rng, EXIT_NUM, laneD,
} from './config.js';
import { canvasTex, buildTraffic, MAT } from './models.js';
import { TRAFFIC_TYPES, EXIT15, D77, VILLAGE } from './config.js';

const CH = 200, STEP = 5;
const _p = { x: 0, z: 0 };
const qYaw = a => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });

// ---------- textures ----------
function asphaltBase(g, w, h, seed = 1) {
  const r = rng(seed);
  g.fillStyle = '#3b3d40'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < w * h / 18; i++) { const v = 40 + r() * 40 | 0; g.fillStyle = `rgba(${v},${v},${v + 2},${0.25 + r() * 0.4})`; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
  for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(20,20,22,${r() * 0.12})`; g.beginPath(); g.ellipse(r() * w, r() * h, 20 + r() * 80, 10 + r() * 40, r() * 3, 0, 7); g.fill(); }
}
function roadTexture() {
  // largeur = d de -17 à +17 (34 m) ; hauteur = 12 m de route
  const W = 2048, H = 512, ppm = W / 34;
  const t = canvasTex(W, H, (g) => {
    asphaltBase(g, W, H, 7);
    const X = d => (d + 17) * ppm;
    // bandes de roulement plus sombres
    for (const sd of [-1, 1]) for (let l = 0; l < 3; l++) {
      const c = sd * (INNER + 1.8 + l * LANE_W);
      for (const o of [-0.85, 0.85]) { g.fillStyle = 'rgba(18,18,20,0.22)'; g.fillRect(X(c + o) - 0.35 * ppm, 0, 0.7 * ppm, H); }
    }
    // accotements / terre-plein
    g.fillStyle = 'rgba(80,78,70,0.35)'; g.fillRect(X(-0.6), 0, 1.2 * ppm, H);
    g.fillStyle = '#4b5a33'; g.fillRect(0, 0, X(-16.2), H); g.fillRect(X(16.2), 0, W - X(16.2), H);
    g.fillStyle = 'rgba(110,100,80,0.8)'; g.fillRect(X(-16.2), 0, 0.6 * ppm, H); g.fillRect(X(15.6), 0, 0.6 * ppm, H);
    const line = (d, wdt, dash) => {
      g.fillStyle = '#f2f2ee';
      if (!dash) g.fillRect(X(d) - wdt * ppm / 2, 0, wdt * ppm, H);
      else { const dh = 3 / 12 * H; g.fillRect(X(d) - wdt * ppm / 2, H / 2 - dh / 2, wdt * ppm, dh); }
    };
    for (const sd of [-1, 1]) {
      line(sd * INNER, 0.22, false); line(sd * EDGE, 0.25, false);
      line(sd * (INNER + LANE_W), 0.15, true); line(sd * (INNER + 2 * LANE_W), 0.15, true);
    }
    // usure de la peinture
    const r = rng(3);
    for (let i = 0; i < 1400; i++) { g.fillStyle = 'rgba(60,60,62,0.5)'; g.fillRect(r() * W, r() * H, 2, 2); }
  });
  t.wrapT = THREE.RepeatWrapping; t.wrapS = THREE.ClampToEdgeWrapping;
  return t;
}
function grassTexture() {
  return canvasTex(512, 512, (g, w, h) => {
    const r = rng(11);
    g.fillStyle = '#4e6b2e'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) { const v = r(); g.fillStyle = v < 0.5 ? `rgba(70,${100 + r() * 40 | 0},40,0.5)` : `rgba(${110 + r() * 40 | 0},${120 + r() * 30 | 0},60,0.35)`; g.fillRect(r() * w, r() * h, 2, 3 + r() * 4); }
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(90,80,40,${r() * 0.15})`; g.beginPath(); g.arc(r() * w, r() * h, 10 + r() * 50, 0, 7); g.fill(); }
  }, { repeat: true });
}
function fieldTexture() {
  return canvasTex(256, 256, (g, w, h) => {
    const r = rng(5);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 8) { g.fillStyle = `rgba(0,0,0,${0.08 + r() * 0.06})`; g.fillRect(x, 0, 3, h); }
    for (let i = 0; i < 2000; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.1})`; g.fillRect(r() * w, r() * h, 2, 2); }
  }, { repeat: true });
}
function concreteTexture() {
  return canvasTex(256, 256, (g, w, h) => {
    const r = rng(9); g.fillStyle = '#a8a69f'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3000; i++) { const v = 130 + r() * 60 | 0; g.fillStyle = `rgba(${v},${v},${v - 4},0.35)`; g.fillRect(r() * w, r() * h, 2, 2); }
    g.fillStyle = 'rgba(60,60,60,0.25)'; g.fillRect(0, 0, w, 2); g.fillRect(0, 0, 2, h);
  }, { repeat: true });
}
const signCache = {};
function signTex(lines, bg = '#1a4fa0', w = 1024, h = 384) {
  const key = lines.join('|') + bg + w;
  return signCache[key] ||= canvasTex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#fff'; g.lineWidth = 10; g.strokeRect(14, 14, w - 28, h - 28);
    g.fillStyle = '#fff'; g.textBaseline = 'middle';
    const n = lines.length;
    lines.forEach((l, i) => {
      const big = i === 0;
      g.font = `${big ? 700 : 600} ${big ? Math.min(92, h / (n + 0.6)) : Math.min(70, h / (n + 1))}px Arial`;
      if (l.startsWith('>')) { g.textAlign = 'right'; g.fillText(l.slice(1), w - 50, (i + 0.75) * h / (n + 0.5)); }
      else { g.textAlign = 'left'; g.fillText(l, 50, (i + 0.75) * h / (n + 0.5)); }
    });
  });
}

// ---------- géométrie balayée le long du tracé ----------
function sweep(profile, s0, s1, dOff, step = STEP, uScale = 1, closed = false) {
  const rows = Math.max(1, Math.ceil((s1 - s0) / step));
  const pos = [], uv = [], idx = [];
  const np = profile.length;
  for (let i = 0; i <= rows; i++) {
    const s = s0 + (s1 - s0) * i / rows;
    for (let j = 0; j < np; j++) {
      const [d, y] = profile[j];
      roadToWorld(s, dOff + d, _p);
      pos.push(_p.x, y, _p.z); uv.push(j / (np - 1), s / uScale);
    }
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < np - 1; j++) {
    const a = i * np + j, b = a + 1, c = a + np, e = c + 1;
    idx.push(a, c, b, b, c, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function flatQuad(sA, sB, dA0, dA1, dB0, dB1, y, uvScale = 8) { // trapèze au sol entre deux abscisses
  const rows = Math.max(1, Math.ceil(Math.abs(sB - sA) / STEP));
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows, s = sA + (sB - sA) * t, d0 = dA0 + (dB0 - dA0) * t, d1 = dA1 + (dB1 - dA1) * t;
    for (const d of [d0, d1]) { roadToWorld(s, d, _p); pos.push(_p.x, y, _p.z); uv.push(_p.x / uvScale, _p.z / uvScale); }
  }
  for (let i = 0; i < rows; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  if (g.attributes.normal.getY(0) < 0) { idx.reverse(); g.setIndex(idx); g.computeVertexNormals(); }
  return g;
}

export class World {
  constructor(scene, R, phys, seed = 1) {
    this.scene = scene; this.R = R; this.phys = phys; this.seed = seed;
    this.chunks = new Map(); this.turbines = []; this.glows = []; this.arrows = [];
    this.roadworks = [];
    this.cones = [];
    this.t = 0;
    this.initMaterials();
    // sol
    const gt = grassTexture(); gt.repeat.set(8000 / 16, 8000 / 16);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.MeshStandardMaterial({ map: gt, roughness: 0.95 }));
    this.ground.rotation.x = -Math.PI / 2; this.ground.position.y = -0.02; this.ground.receiveShadow = true;
    scene.add(this.ground);
    const gb = phys.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
    phys.createCollider(R.ColliderDesc.cuboid(30000, 0.5, 60000).setFriction(1.0), gb);
    // collines lointaines (suivent la caméra)
    this.hills = this.makeHills(); scene.add(this.hills);
  }

  initMaterials() {
    const rt = roadTexture(); rt.repeat.set(1, 1 / 12);
    this.roadMat = new THREE.MeshStandardMaterial({ map: rt, roughness: 0.88, metalness: 0.0 });
    const at = canvasTex(512, 512, (g, w, h) => asphaltBase(g, w, h, 21), { repeat: true });
    this.lotMat = new THREE.MeshStandardMaterial({ map: at, roughness: 0.9 });
    this.concTex = concreteTexture();
    this.concMat = new THREE.MeshStandardMaterial({ map: this.concTex, roughness: 0.85, side: THREE.DoubleSide });
    this.railMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.35, metalness: 0.85, side: THREE.DoubleSide });
    this.postMat = new THREE.MeshStandardMaterial({ color: 0x8d9196, roughness: 0.5, metalness: 0.7 });
    this.tunnelWall = new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.6, side: THREE.DoubleSide });
    this.tunnelLight = new THREE.MeshStandardMaterial({ color: 0xffe0a0, emissive: 0xffc870, emissiveIntensity: 2.2 });
    this.lampHead = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0xffd9a0, emissiveIntensity: 0.0 });
    this.fieldTex = fieldTexture(); this.fieldTex.repeat.set(10, 10);
    this.fieldMat = new THREE.MeshStandardMaterial({ map: this.fieldTex, roughness: 1 });
    this.trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 3, 6); this.trunkGeo.translate(0, 1.5, 0);
    this.crownGeo = new THREE.IcosahedronGeometry(2.6, 1); this.crownGeo.scale(1, 1.15, 1); this.crownGeo.translate(0, 5.4, 0);
    this.pineGeo = new THREE.ConeGeometry(2.2, 8, 8); this.pineGeo.translate(0, 6.5, 0);
    this.trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4330, roughness: 1 });
    this.leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
    this.wallMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    const roofGeo = new THREE.CylinderGeometry(0.72, 0.72, 1, 3); roofGeo.rotateZ(Math.PI / 2); roofGeo.rotateX(Math.PI / 2); roofGeo.rotateZ(Math.PI / 2);
    this.roofGeo = new THREE.BufferGeometry().copy(new THREE.ConeGeometry(0.75, 0.45, 4, 1)); this.roofGeo.rotateY(Math.PI / 4); this.roofGeo.scale(1.42, 1, 1.42); this.roofGeo.translate(0, 0.72, 0);
    this.roofMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
    this.boxGeo = new THREE.BoxGeometry(1, 1, 1); this.boxGeo.translate(0, 0.5, 0);
    this.coneGeo = new THREE.ConeGeometry(0.2, 0.75, 10); this.coneGeo.translate(0, 0.375, 0);
    this.coneMat = new THREE.MeshStandardMaterial({ color: 0xff5a10, roughness: 0.6, emissive: 0x401000 });
    this.whiteMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 });
    this.darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.6, metalness: 0.4 });
  }

  makeHills() {
    const N = 160, pos = [], idx = [], col = [], r = rng(77);
    const h = [];
    for (let i = 0; i < N; i++) h.push(60 + 160 * Math.abs(Math.sin(i * 0.21) * Math.cos(i * 0.07 + 1)) + r() * 60);
    const c1 = new THREE.Color(0x4d6a48), c2 = new THREE.Color(0x7d8f80);
    for (let i = 0; i <= N; i++) {
      const a = i / N * Math.PI * 2, hh = h[i % N];
      for (const [rad, y, c] of [[2300, -5, c1], [2600, hh, c2], [3300, hh * 1.6 + 40, c2]]) { pos.push(Math.cos(a) * rad, y, Math.sin(a) * rad); col.push(c.r, c.g, c.b); }
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < 2; j++) { const a = i * 3 + j, b = a + 3; idx.push(a, a + 1, b, a + 1, b + 1, b); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    return m;
  }

  setRoadworks(list) { this.roadworks = list; }

  setWet(w) {
    this.roadMat.roughness = 0.88 - w * 0.62; this.roadMat.metalness = w * 0.12;
    this.roadMat.color.setScalar(1 - w * 0.35);
    this.lotMat.roughness = 0.9 - w * 0.6; this.lotMat.color.setScalar(1 - w * 0.3);
  }
  setNight(n) { this.lampHead.emissiveIntensity = n * 3.5; }

  update(minS, maxS, cam, dt, force = false) {
    this.t += dt;
    this.ground.position.x = Math.round(cam.x / 16) * 16; this.ground.position.z = Math.round(cam.z / 16) * 16;
    this.hills.position.set(cam.x, 0, cam.z);
    const k0 = Math.floor((minS - 500) / CH), k1 = Math.floor((maxS + 1300) / CH);
    let built = 0;
    for (let k = k0; k <= k1; k++) if (!this.chunks.has(k)) { this.build(k); if (++built >= 2 && !force) break; }
    for (const [k, c] of this.chunks) if (k < k0 - 2 || k > k1 + 2) this.unload(k);
    for (const t of this.turbines) t.rotor.rotation.z += dt * t.speed;
    const blink = (this.t % 1) < 0.5;
    for (const a of this.arrows) a.material.emissiveIntensity = blink ? 3 : 0.1;
    // cônes dynamiques
    for (const c of this.cones) {
      if (c.body.isSleeping()) continue;
      const p = c.body.translation(), q = c.body.rotation();
      c.mesh.position.set(p.x, p.y - 0.375, p.z); c.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    }
  }

  unload(k) {
    const c = this.chunks.get(k);
    this.scene.remove(c.group);
    c.group.traverse(o => { if (o.geometry && o.userData.own) o.geometry.dispose(); });
    this.phys.removeRigidBody(c.body);
    for (const b of c.dyn) this.phys.removeRigidBody(b.body);
    this.cones = this.cones.filter(x => !c.dyn.includes(x));
    this.turbines = this.turbines.filter(t => t.k !== k);
    this.arrows = this.arrows.filter(a => !c.arrows.includes(a));
    this.chunks.delete(k);
  }

  build(k) {
    const R = this.R, s0 = k * CH, s1 = s0 + CH, r = rng(k * 7919 + this.seed * 31 + 5);
    const g = new THREE.Group(); g.matrixAutoUpdate = true;
    const body = this.phys.createRigidBody(R.RigidBodyDesc.fixed());
    const c = { group: g, body, dyn: [], glows: [], arrows: [] };
    const own = m => { m.userData.own = true; return m; };
    const add = (geo, mat, shadow = false, recv = true) => { const m = own(new THREE.Mesh(geo, mat)); m.castShadow = shadow; m.receiveShadow = recv; g.add(m); return m; };
    const col = (hx, hy, hz, x, y, z, yaw = 0) => this.phys.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRotation(qYaw(yaw)).setFriction(0.4).setRestitution(0.1), body);

    // chaussée
    const road = sweep([[-HALF, 0.02], [HALF, 0.02]], s0, s1, 0, STEP, 1);
    const uv = road.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i)); // v = s (repeat 1/12)
    add(road, this.roadMat);

    // terre-plein central (béton type GBA) + collisions
    const jersey = [[-0.32, 0.02], [-0.24, 0.25], [-0.1, 0.82], [0.1, 0.82], [0.24, 0.25], [0.32, 0.02]];
    add(sweep(jersey, s0, s1, 0, 10), this.concMat, true);
    // glissières extérieures + poteaux
    const tun = TUNNELS.find(([a, b]) => s1 > a && s0 < b);
    const postsPos = [];
    for (const side of [-1, 1]) {
      let a = s0;
      const flush = (b) => {
        if (b - a < 1) return;
        const d = side * RAIL;
        add(sweep([[0, 0.5], [side * 0.08, 0.62], [0, 0.72], [side * 0.08, 0.84], [0, 0.92]], a, b, d, 10), this.railMat, true);
        for (let s = Math.ceil(a / 4) * 4; s < b; s += 4) { roadToWorld(s, d + side * 0.12, _p); postsPos.push(_p.x, _p.z, roadYaw(s)); }
      };
      for (let s = s0; s < s1; s += 10) {
        const sm = s + 5, open = railOpen(sm, side) || (tun && sm > tun[0] && sm < tun[1]);
        if (open) { flush(s); a = s + 10; } else {
          roadToWorld(sm, side * RAIL, _p); col(0.25, 0.7, 5.2, _p.x, 0.7, _p.z, roadYaw(sm));
        }
      }
      flush(s1);
    }
    for (let s = s0; s < s1; s += 10) { roadToWorld(s + 5, 0, _p); col(0.32, 0.6, 5.2, _p.x, 0.6, _p.z, roadYaw(s + 5)); }
    if (postsPos.length) {
      const im = own(new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.95, 0.12).translate(0, 0.47, 0), this.postMat, postsPos.length / 3));
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
      for (let i = 0; i < postsPos.length / 3; i++) { q.setFromEuler(e.set(0, postsPos[i * 3 + 2], 0)); m4.compose(new THREE.Vector3(postsPos[i * 3], 0, postsPos[i * 3 + 1]), q, one); im.setMatrixAt(i, m4); }
      im.castShadow = true; g.add(im);
    }

    // candélabres sur le terre-plein (hors tunnel)
    const lampPos = [];
    for (let s = Math.ceil(s0 / 60) * 60; s < s1; s += 60) { if (tun && s > tun[0] - 20 && s < tun[1] + 20) continue; lampPos.push(s); }
    if (lampPos.length) {
      const pole = new THREE.CylinderGeometry(0.1, 0.16, 11, 6).translate(0, 5.5, 0);
      const arm = new THREE.BoxGeometry(5, 0.12, 0.12).translate(0, 10.9, 0);
      const head = new THREE.BoxGeometry(0.9, 0.18, 0.35);
      const ip = own(new THREE.InstancedMesh(pole, this.postMat, lampPos.length)), ia = own(new THREE.InstancedMesh(arm, this.postMat, lampPos.length));
      const ih = own(new THREE.InstancedMesh(head, this.lampHead, lampPos.length * 2));
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
      lampPos.forEach((s, i) => {
        roadToWorld(s, 0, _p); const yaw = roadYaw(s);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        m4.compose(new THREE.Vector3(_p.x, 0.8, _p.z), q, one); ip.setMatrixAt(i, m4); ia.setMatrixAt(i, m4);
        for (const sd of [-1, 1]) { roadToWorld(s, sd * 2.4, _p); m4.compose(new THREE.Vector3(_p.x, 11.6, _p.z), q, one); ih.setMatrixAt(i * 2 + (sd > 0 ? 1 : 0), m4); c.glows.push([_p.x, 11.45, _p.z]); }
      });
      ip.castShadow = true; g.add(ip, ia, ih);
    }

    // tunnel
    if (tun) this.buildTunnel(g, add, col, tun, s0, s1, c);
    // passages supérieurs
    for (const so of OVERPASSES) if (so >= s0 && so < s1) this.buildOverpass(g, add, col, so, r);
    // aires de repos
    for (const ra of REST_AREAS) if (s1 > ra.s0 - 40 && s0 < ra.s1 + 40) this.buildRest(g, add, col, ra, Math.max(s0, ra.s0 - 40), Math.min(s1, ra.s1 + 40), r, c);
    // sortie + plateforme logistique
    if (s1 > EXIT_GAP[0] && s0 < EXIT_GAP[1] + 300) this.buildDepot(g, add, col, s0, s1, c);
    // itinéraire bis : sortie 15 + départementale D77 + village
    if (s1 > EXIT15[0] - 1200 && s0 < D77.s1 + 200) this.buildD77(g, add, col, s0, s1, c, r);
    // panneaux
    this.buildSigns(g, add, col, s0, s1);
    // travaux
    for (const w of this.roadworks) if (s1 > w.s0 - 60 && s0 < w.s1) this.buildWorks(g, add, col, w, Math.max(s0, w.s0 - 60), Math.min(s1, w.s1), c);
    // paysage
    this.buildScenery(g, s0, s1, r, k, tun, c);

    this.scene.add(g);
    this.chunks.set(k, c);
  }

  buildTunnel(g, add, col, [ta, tb], s0, s1, c) {
    const a = Math.max(s0, ta), b = Math.min(s1, tb);
    for (const side of [-1, 1]) {
      add(sweep([[0, 0], [0, 6.6]], a, b, side * 16.3, 10), this.tunnelWall);
      for (let s = a; s < b; s += 10) { roadToWorld(s + 5, side * 16.6, _p); col(0.5, 3.5, 5.2, _p.x, 3.5, _p.z, roadYaw(s + 5)); }
      // trottoir
      add(sweep([[0, 0.25], [side * 0.9, 0.25]], a, b, side * 15.4, 10), this.concMat);
      add(sweep([[-0.15, 6.5], [0.15, 6.5]], a, b, side * 9, 10), this.tunnelLight);
      add(sweep([[-0.15, 6.9], [0.15, 6.9]], a, b, side * 2.5, 10), this.tunnelLight);
    }
    const roof = sweep([[16.5, 7.2], [10, 7.6], [0, 7.8], [-10, 7.6], [-16.5, 7.2]], a, b, 0, 10);
    add(roof, this.tunnelWall, true);
    // colline au-dessus + portails
    const mound = sweep([[-60, 0], [-34, 9], [-17, 11], [17, 11], [34, 9], [60, 0]], a, b, 0, 10);
    const mm = add(mound, new THREE.MeshStandardMaterial({ color: 0x4f6b35, roughness: 1, flatShading: true }), true);
    for (const sp of [ta, tb]) if (sp >= s0 && sp < s1) {
      roadToWorld(sp, 0, _p);
      const portal = add(new THREE.BoxGeometry(40, 4.5, 1.5), this.concMat, true);
      portal.position.set(_p.x, 9.3, _p.z); portal.rotation.y = roadYaw(sp);
      for (const side of [-1, 1]) {
        const w = add(new THREE.BoxGeometry(26, 11.5, 1.5), this.concMat, true);
        roadToWorld(sp, side * 29.6, _p); w.position.set(_p.x, 5.75, _p.z); w.rotation.y = roadYaw(sp);
      }
      const sign = add(new THREE.PlaneGeometry(9, 1.6), new THREE.MeshBasicMaterial({ map: signTex(['TUNNEL DU ' + (ta === TUNNELS[0][0] ? 'MONT-ROUX' : 'BOIS-NOIR') + '   ' + (tb - ta) + ' m'], '#1a4fa0', 1024, 180), side: THREE.DoubleSide }));
      roadToWorld(sp - 0.8, -7, _p); sign.position.set(_p.x, 9.6, _p.z); sign.rotation.y = roadYaw(sp) + Math.PI;
    }
  }

  buildOverpass(g, add, col, so, r) {
    roadToWorld(so, 0, _p); const yaw = roadYaw(so);
    const grp = new THREE.Group(); grp.position.set(_p.x, 0, _p.z); grp.rotation.y = yaw; g.add(grp);
    const m = (geo, mat, x, y, z) => { const o = new THREE.Mesh(geo, mat); o.userData.own = true; o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; grp.add(o); return o; };
    m(new THREE.BoxGeometry(130, 1.1, 11), this.concMat, 0, 6.9, 0);
    m(new THREE.BoxGeometry(130, 0.05, 8), this.lotMat, 0, 7.48, 0);
    for (const z of [-5.3, 5.3]) m(new THREE.BoxGeometry(130, 1.1, 0.35), this.concMat, 0, 7.9, z);
    for (const x of [0, -19.5, 19.5]) for (const z of [-3, 3]) m(new THREE.CylinderGeometry(0.6, 0.6, 6.4, 10), this.concMat, x, 3.2, z);
    for (const side of [-1, 1]) {
      const emb = m(new THREE.BoxGeometry(70, 7.5, 16), new THREE.MeshStandardMaterial({ color: 0x5b7340, roughness: 1 }), side * 98, 3.5, 0);
      emb.geometry.attributes.position.array.forEach((v, i, arr) => { if (i % 3 === 1 && v > 0 && Math.sign(arr[i - 1]) === side) arr[i] = -3.75; });
      emb.geometry.computeVertexNormals();
    }
    col(0.7, 3.2, 3.6, _p.x, 3.2, _p.z, yaw);
    // quelques voitures sur le pont (décor)
    if (r() < 0.7) {
      const t = buildTraffic(TRAFFIC_TYPES[0], r); t.position.set(-20 + r() * 40, 7.5, -2); t.rotation.y = Math.PI / 2; grp.add(t);
    }
  }

  buildSigns(g, add, col, s0, s1) {
    const gantry = (s, lines, side = -1) => {
      roadToWorld(s, side * 8.2, _p); const yaw = roadYaw(s);
      const grp = new THREE.Group(); grp.position.set(_p.x, 0, _p.z); grp.rotation.y = yaw; g.add(grp);
      const post = new THREE.CylinderGeometry(0.22, 0.25, 7.5, 8);
      for (const dx of [-8.0, 8.4]) { const p = new THREE.Mesh(post, this.postMat); p.position.set(dx * -side, 3.75, 0); p.castShadow = true; grp.add(p); }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(17, 0.5, 0.5), this.postMat); beam.position.set(0, 7.2, 0); grp.add(beam);
      const pan = new THREE.Mesh(new THREE.PlaneGeometry(11, 3.6), new THREE.MeshStandardMaterial({ map: signTex(lines), roughness: 0.5, emissive: 0xffffff, emissiveMap: signTex(lines), emissiveIntensity: 0.12 }));
      pan.position.set(0, 7.0, side > 0 ? 0.3 : -0.3); pan.rotation.y = side > 0 ? 0 : Math.PI; pan.castShadow = true; grp.add(pan);
      for (const dx of [-8.0, 8.4]) { roadToWorld(s, side * 8.2 + dx * -side * 1, _p); }
    };
    for (let s = Math.ceil(s0 / 1000) * 1000 + 500; s < s1; s += 1000) {
      if (TUNNELS.some(([a, b]) => s > a - 60 && s < b + 60)) continue;
      const left = DEST_S - s;
      if (left > 1400) {
        const ra = REST_AREAS.find(r => r.s0 > s && r.s0 - s < 2600);
        gantry(s, ['Plateforme Logistique', '>' + (left / 1000).toFixed(0) + ' km', ra ? ra.name + '  ' + ((ra.s0 - s) / 1000).toFixed(1) + ' km' : 'Lyon  ' + ((left + 32000) / 1000).toFixed(0) + ' km']);
      } else if (left > 0) gantry(s, ['Sortie ' + EXIT_NUM + '  ⬈', 'Plateforme Logistique', '>' + Math.round((left - 200) / 100) * 100 + ' m'], -1);
      else gantry(s, ['Lyon', '>' + ((32000 - (s - DEST_S)) / 1000).toFixed(0) + ' km']);
      gantry(s - 300, ['Paris', '>' + ((s + 120000) / 1000).toFixed(0) + ' km'], 1);
    }
    // panneaux 130 + bornes kilométriques
    for (let s = Math.ceil(s0 / 100) * 100; s < s1; s += 100) {
      if (TUNNELS.some(([a, b]) => s > a && s < b)) continue;
      roadToWorld(s, -16.4, _p);
      const b = new THREE.Mesh(this.boxGeo, this.whiteMat); b.scale.set(0.25, 0.8, 0.12); b.position.set(_p.x, 0, _p.z); g.add(b);
      if (s % 2000 === 0) {
        const t = canvasTex(128, 128, (c) => { c.fillStyle = '#fff'; c.beginPath(); c.arc(64, 64, 62, 0, 7); c.fill(); c.strokeStyle = '#d01818'; c.lineWidth = 14; c.beginPath(); c.arc(64, 64, 54, 0, 7); c.stroke(); c.fillStyle = '#111'; c.font = '700 44px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('130', 64, 66); });
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2), this.postMat); p.position.set(_p.x, 1.1, _p.z); g.add(p);
        const d = new THREE.Mesh(new THREE.CircleGeometry(0.45, 24), new THREE.MeshStandardMaterial({ map: t })); d.position.set(_p.x, 2.4, _p.z); d.rotation.y = roadYaw(s) + Math.PI; g.add(d);
      }
    }
    // pré-signalisation aires
    for (const ra of REST_AREAS) for (const dist of [1000, 500]) {
      const s = ra.s0 - dist; if (s < s0 || s >= s1) continue;
      roadToWorld(s, -17, _p);
      const pan = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.6), new THREE.MeshStandardMaterial({ map: signTex([ra.name, 'P  ⛽  🍴', '>' + dist + ' m'], '#1a4fa0', 640, 400) }));
      pan.position.set(_p.x, 3.2, _p.z); pan.rotation.y = roadYaw(s) + Math.PI; g.add(pan);
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3), this.postMat); p.position.set(_p.x, 1.5, _p.z); g.add(p);
    }
  }

  buildRest(g, add, col, ra, a, b, r, c) {
    const lot = flatQuad(Math.max(a, ra.s0), Math.min(b, ra.s1), -HALF + 0.5, -78, -HALF + 0.5, -78, 0.015, 8);
    add(lot, this.lotMat);
    // bretelles en biseau
    if (a < ra.s0) add(flatQuad(a, ra.s0, -HALF + 0.5, -HALF, -HALF + 0.5, -40, 0.015), this.lotMat);
    if (b > ra.s1) add(flatQuad(ra.s1, b, -HALF + 0.5, -40, -HALF + 0.5, -HALF, 0.015), this.lotMat);
    const mid = (ra.s0 + ra.s1) / 2;
    if (mid >= a && mid < b) {
      roadToWorld(mid, -62, _p); const yaw = roadYaw(mid);
      // station-service : bâtiment + auvent
      const bld = add(new THREE.BoxGeometry(14, 4.5, 26), new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.8 }), true);
      bld.position.set(_p.x, 2.25, _p.z); bld.rotation.y = yaw;
      const glass = add(new THREE.BoxGeometry(0.1, 2.5, 20), MAT.glass); roadToWorld(mid, -54.95, _p); glass.position.set(_p.x, 1.6, _p.z); glass.rotation.y = yaw;
      roadToWorld(mid + 60, -40, _p);
      const can = add(new THREE.BoxGeometry(16, 0.7, 22), new THREE.MeshStandardMaterial({ color: 0xf4f4f4, emissive: 0xffffff, emissiveIntensity: 0.05 }), true);
      can.position.set(_p.x, 5.6, _p.z); can.rotation.y = yaw;
      const stripe = add(new THREE.BoxGeometry(16.1, 0.25, 22.1), new THREE.MeshStandardMaterial({ color: 0x1fa055, roughness: 0.5 })); stripe.position.copy(can.position); stripe.rotation.y = yaw;
      for (const dx of [-5, 5]) for (const dz of [-7, 0, 7]) {
        roadToWorld(mid + 60 + dz, -40 + dx, _p);
        const p = add(new THREE.BoxGeometry(0.5, 5.3, 0.5), this.whiteMat, true); p.position.set(_p.x, 2.65, _p.z);
        const pump = add(new THREE.BoxGeometry(0.8, 1.8, 0.5), new THREE.MeshStandardMaterial({ color: 0x1fa055 }), true); pump.position.set(_p.x, 0.9, _p.z + 1.2);
        this.phys.createCollider(this.R.ColliderDesc.cuboid(0.4, 0.9, 0.4).setTranslation(_p.x, 0.9, _p.z + 1.2), c.body);
      }
      roadToWorld(mid, -62, _p); col(7, 2.25, 13, _p.x, 2.25, _p.z, yaw);
      const sign = add(new THREE.PlaneGeometry(6, 2), new THREE.MeshStandardMaterial({ map: signTex([ra.name], '#1fa055', 768, 256), emissive: 0xffffff, emissiveMap: signTex([ra.name], '#1fa055', 768, 256), emissiveIntensity: 0.3 }));
      roadToWorld(mid, -54.9, _p); sign.position.set(_p.x, 5.4, _p.z); sign.rotation.y = yaw - Math.PI / 2;
    }
    // poids lourds stationnés
    for (let s = Math.ceil(a / 30) * 30; s < b; s += 30) {
      if (s < ra.s0 + 20 || s > ra.s1 - 20 || r() < 0.35) continue;
      const t = buildTraffic(TRAFFIC_TYPES[3], r); roadToWorld(s, -30, _p);
      const yaw = roadYaw(s) + 0.5;
      t.position.set(_p.x, 0, _p.z); t.rotation.y = yaw; g.add(t);
      if (t.userData.trailer) { const tr = t.userData.trailer; tr.position.set(0, 0, -1.15); t.add(tr); }
      const cxp = _p.x - Math.sin(yaw) * 5.1, czp = _p.z - Math.cos(yaw) * 5.1;
      this.phys.createCollider(this.R.ColliderDesc.cuboid(1.3, 2, 8.3).setTranslation(cxp, 2, czp).setRotation(qYaw(yaw)), c.body);
    }
    for (let s = Math.ceil(a / 40) * 40; s < b; s += 40) if (s > ra.s0 && s < ra.s1) { roadToWorld(s, -19.5, _p); c.glows.push([_p.x, 8, _p.z]); const p = add(new THREE.CylinderGeometry(0.1, 0.12, 8, 6), this.postMat); p.position.set(_p.x, 4, _p.z); }
  }

  buildD77(g, add, col, s0, s1, c, r) {
    const R = this.R, H = D77.half, dd = D77.d;
    if (!this.d77Mat) {
      const t = canvasTex(512, 512, (ctx, w, h) => {
        asphaltBase(ctx, w, h, 33);
        ctx.fillStyle = '#e9e9e2'; ctx.fillRect(10, 0, 8, h); ctx.fillRect(w - 18, 0, 8, h);
        for (let y = 0; y < h; y += 128) ctx.fillRect(w / 2 - 4, y, 8, 64);
        ctx.fillStyle = '#6b6a55'; ctx.fillRect(0, 0, 8, h); ctx.fillRect(w - 8, 0, 8, h);
      }, { repeat: true });
      t.repeat.set(1, 1 / 10);
      this.d77Mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 });
    }
    // bretelle de sortie 15 (diagonale vers la départementale)
    const a = Math.max(s0, EXIT15[0]), b = Math.min(s1, D77.s0);
    if (b > a) {
      const f = s => clamp((s - EXIT15[0]) / (D77.s0 - EXIT15[0]), 0, 1), e = s => { const k = f(s); return k * k * (3 - 2 * k); };
      const rows = Math.ceil((b - a) / 5), pos = [], uv = [], idx = [];
      for (let i = 0; i <= rows; i++) {
        const sv = a + (b - a) * i / rows, cd = -15.5 + (dd + 15.5) * e(sv);
        for (const off of [H, -H]) { roadToWorld(sv, cd + off, _p); pos.push(_p.x, 0.03, _p.z); uv.push(off > 0 ? 1 : 0, sv / 10); }
      }
      for (let i = 0; i < rows; i++) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
      if (geo.attributes.normal.getY(0) < 0) { idx.reverse(); geo.setIndex(idx); geo.computeVertexNormals(); }
      add(geo, this.d77Mat);
    }
    // la D77
    const a2 = Math.max(s0, D77.s0), b2 = Math.min(s1, D77.s1);
    if (b2 > a2) {
      const geo = sweep([[-H, 0.03], [H, 0.03]], a2, b2, dd, 5, 10);
      if (geo.attributes.normal.getY(0) < 0) { const ix = [...geo.index.array].reverse(); geo.setIndex(ix); geo.computeVertexNormals(); }
      add(geo, this.d77Mat);
      // poteaux de bord de route + panneaux
      for (let sv = Math.ceil(a2 / 50) * 50; sv < b2; sv += 50) for (const side of [-1, 1]) { roadToWorld(sv, dd + side * (H + 0.8), _p); const m = add(new THREE.CylinderGeometry(0.06, 0.06, 1, 6), this.whiteMat); m.position.set(_p.x, 0.5, _p.z); }
      if (D77.s0 + 60 >= a2 && D77.s0 + 60 < b2) this.roadSign(add, D77.s0 + 60, dd - 6, ['D77', 'Plateforme Logistique', '>par l’arrière'], '#e0a020');
      if (VILLAGE.s0 - 80 >= a2 && VILLAGE.s0 - 80 < b2) this.roadSign(add, VILLAGE.s0 - 80, dd - 6, [VILLAGE.name], '#ffffff', '#c22020');
    }
    // panneau avancé sur l'autoroute
    if (EXIT15[0] - 700 >= s0 && EXIT15[0] - 700 < s1) this.roadSign(add, EXIT15[0] - 700, -17, ['Sortie 15', 'D77 — ' + VILLAGE.name, '>700 m'], '#1a4fa0');
    // liaison vers l'arrière de la plateforme
    const a3 = Math.max(s0, D77.s1), b3 = Math.min(s1, DEST.s0 + 6);
    if (b3 > a3) add(flatQuad(a3, b3, dd + H - (a3 - D77.s1) / (DEST.s0 + 6 - D77.s1) * (dd + H + 62), dd - H - (a3 - D77.s1) / (DEST.s0 + 6 - D77.s1) * (dd - H + 80), dd + H - (b3 - D77.s1) / (DEST.s0 + 6 - D77.s1) * (dd + H + 62), dd - H - (b3 - D77.s1) / (DEST.s0 + 6 - D77.s1) * (dd - H + 80), 0.03, 8), this.lotMat);
    // village
    if (s1 > VILLAGE.s0 && s0 < VILLAGE.s1) {
      const n = 14, walls = new THREE.InstancedMesh(this.boxGeo, this.wallMat, n), roofs = new THREE.InstancedMesh(this.roofGeo, this.roofMat, n);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), cl = new THREE.Color();
      let k = 0;
      for (let i = 0; i < n; i++) {
        const sv = VILLAGE.s0 + (i / n) * (VILLAGE.s1 - VILLAGE.s0) + r() * 10;
        if (sv < s0 || sv >= s1) continue;
        const side = i % 2 ? 1 : -1, dv = dd + side * (13 + r() * 6);
        roadToWorld(sv, dv, _p);
        const w = 8 + r() * 4, l = 9 + r() * 5, h = 5 + r() * 3;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), roadYaw(sv) + (r() < 0.5 ? 0 : Math.PI / 2));
        m4.compose(pos.set(_p.x, 0, _p.z), q, sc.set(w, h, l)); walls.setMatrixAt(k, m4); walls.setColorAt(k, cl.set([0xefe6d2, 0xe2d4b8, 0xd9cfc0, 0xf3efe6, 0xe8d0b0][k % 5]));
        m4.compose(pos.set(_p.x, h - 0.72, _p.z), q, sc.set(w, 3.2, l)); roofs.setMatrixAt(k, m4); roofs.setColorAt(k, cl.set([0xa3452d, 0x8e3a26, 0x5a5a5e][k % 3]));
        const yaw = roadYaw(sv);
        this.phys.createCollider(R.ColliderDesc.cuboid(Math.max(w, l) / 2, h / 2, Math.max(w, l) / 2).setTranslation(_p.x, h / 2, _p.z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }), c.body);
        k++;
      }
      walls.count = roofs.count = k;
      for (const im of [walls, roofs]) { im.castShadow = true; im.receiveShadow = true; im.userData.own = true; g.add(im); }
      // clocher
      const cs = (VILLAGE.s0 + VILLAGE.s1) / 2;
      if (cs >= s0 && cs < s1) {
        roadToWorld(cs, dd - 32, _p);
        const t1 = add(new THREE.BoxGeometry(6, 18, 6), new THREE.MeshStandardMaterial({ color: 0xd8cfb8, roughness: 0.9 }), true); t1.position.set(_p.x, 9, _p.z);
        const t2 = add(new THREE.ConeGeometry(4.5, 8, 4), new THREE.MeshStandardMaterial({ color: 0x4a4f58 }), true); t2.position.set(_p.x, 22, _p.z); t2.rotation.y = Math.PI / 4;
        const nave = add(new THREE.BoxGeometry(10, 9, 22), new THREE.MeshStandardMaterial({ color: 0xd8cfb8, roughness: 0.9 }), true); roadToWorld(cs - 14, dd - 32, _p); nave.position.set(_p.x, 4.5, _p.z); nave.rotation.y = roadYaw(cs);
        col(5, 9, 11, _p.x, 4.5, _p.z, roadYaw(cs));
        // tracteur garé sur le bas-côté (obstacle)
        roadToWorld(cs + 80, dd + H + 0.5, _p);
        const tr = new THREE.Group(); tr.position.set(_p.x, 0, _p.z); tr.rotation.y = roadYaw(cs);
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.4, 3.2), new THREE.MeshStandardMaterial({ color: 0x2b8a3a })); body.position.y = 1.2; tr.add(body);
        const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.4, 1.4), MAT.glass); cabin.position.set(0, 2.5, -0.6); tr.add(cabin);
        for (const [x, z, rr] of [[1, -1, 0.9], [-1, -1, 0.9], [0.95, 1.1, 0.55], [-0.95, 1.1, 0.55]]) { const wh = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, 0.5, 14), this.darkMat); wh.rotation.z = Math.PI / 2; wh.position.set(x, rr, z); tr.add(wh); }
        tr.traverse(o => o.castShadow = true); g.add(tr);
        col(1.2, 1.4, 1.8, _p.x, 1.4, _p.z, roadYaw(cs));
      }
    }
  }

  roadSign(add, s, d, lines, bg, border) {
    roadToWorld(s, d, _p);
    const tex = signTex(lines, bg, 640, 360);
    const pan = add(new THREE.PlaneGeometry(4.2, 2.4), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.1 }));
    pan.position.set(_p.x, 3, _p.z); pan.rotation.y = roadYaw(s) + Math.PI;
    for (const o of [-1.6, 1.6]) { const p = add(new THREE.CylinderGeometry(0.07, 0.07, 3), this.postMat); roadToWorld(s, d + o, _p); p.position.set(_p.x, 1.5, _p.z); }
  }

  buildDepot(g, add, col, s0, s1, c) {
    // bretelle de sortie
    const a = Math.max(s0, EXIT_GAP[0]), b = Math.min(s1, DEST.s0);
    if (b > a) {
      const t = s => (s - EXIT_GAP[0]) / (DEST.s0 - EXIT_GAP[0]);
      add(flatQuad(a, b, -HALF + 0.5, -HALF - 1 - t(a) * 10, -HALF + 0.5, -HALF - 1 - t(b) * 10, 0.016), this.lotMat);
    }
    const la = Math.max(s0, DEST.s0), lb = Math.min(s1, DEST.s1);
    if (lb > la) {
      add(flatQuad(la, lb, -HALF + 0.5, DEST.d1, -HALF + 0.5, DEST.d1, 0.015, 8), this.lotMat);
      // marquage d'arrivée
      for (let s = Math.ceil(la / 12) * 12; s < lb; s += 12) {
        const m = add(flatQuad(s, s + 3.5, -50, -66, -50, -66, 0.03), new THREE.MeshBasicMaterial({ color: 0xf0c020 }));
      }
    }
    const mid = (DEST.s0 + DEST.s1) / 2;
    if (mid >= s0 && mid < s1) {
      roadToWorld(mid, -125, _p); const yaw = roadYaw(mid);
      const wh = add(new THREE.BoxGeometry(60, 14, 180), new THREE.MeshStandardMaterial({ color: 0xc9ccd2, roughness: 0.7, metalness: 0.2 }), true);
      wh.position.set(_p.x, 7, _p.z); wh.rotation.y = yaw; col(30, 7, 90, _p.x, 7, _p.z, yaw);
      for (let i = -6; i <= 6; i++) {
        roadToWorld(mid + i * 13, -94.9, _p);
        const door = add(new THREE.BoxGeometry(0.1, 4, 3.6), new THREE.MeshStandardMaterial({ color: 0x3a5a8a })); door.position.set(_p.x, 2.2, _p.z); door.rotation.y = yaw;
      }
      const t = signTex(['PLATEFORME LOGISTIQUE', 'TRACK A TRUCK — Quai de livraison'], '#b0161e', 1024, 256);
      const s = add(new THREE.PlaneGeometry(40, 10), new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.35 }));
      roadToWorld(mid, -94.8, _p); s.position.set(_p.x, 11, _p.z); s.rotation.y = yaw - Math.PI / 2;
      // balise lumineuse d'objectif
      roadToWorld(mid, -58, _p);
      const beam = add(new THREE.CylinderGeometry(9, 9, 60, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0x40ff90, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }), false, false);
      beam.position.set(_p.x, 30, _p.z);
      const ring = add(new THREE.RingGeometry(8.4, 9, 48), new THREE.MeshBasicMaterial({ color: 0x40ff90, side: THREE.DoubleSide }), false, false);
      ring.rotation.x = -Math.PI / 2; ring.position.set(_p.x, 0.05, _p.z);
      this.beam = beam;
      for (let i = -4; i <= 4; i++) { roadToWorld(mid + i * 25, -22, _p); c.glows.push([_p.x, 9, _p.z]); }
    }
  }

  buildWorks(g, add, col, w, a, b, c) {
    const d = laneD(w.dir, w.lane), R = this.R;
    for (let s = Math.ceil(a / 8) * 8; s < b; s += 8) {
      const taper = Math.min(1, Math.max(0, (s - (w.s0 - 60)) / 60));
      const tow = w.lane === 0 ? -w.dir : w.dir; // vers la voie restée ouverte
      const dc = s < w.s0 ? (d - tow * 1.6) + (tow * 3.3) * taper : d + tow * 1.7;
      const p = roadToWorld(s, dc, { x: 0, z: 0 });
      const mesh = new THREE.Mesh(this.coneGeo, this.coneMat); mesh.castShadow = true; g.add(mesh);
      const body = this.phys.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(p.x, 0.375, p.z).setCanSleep(true));
      this.phys.createCollider(R.ColliderDesc.cylinder(0.375, 0.2).setDensity(40).setFriction(0.6), body);
      body.sleep();
      mesh.position.set(p.x, 0, p.z);
      const cone = { body, mesh }; c.dyn.push(cone); this.cones.push(cone);
    }
    // flèche lumineuse de rabattement
    if (w.s0 - 40 >= a && w.s0 - 40 < b) {
      roadToWorld(w.s0 - 40, d, _p);
      const tr = add(new THREE.BoxGeometry(2.2, 1.2, 3.5), new THREE.MeshStandardMaterial({ color: 0xf0c020 }), true); tr.position.set(_p.x, 0.9, _p.z); tr.rotation.y = roadYaw(w.s0);
      col(1.1, 1.4, 1.8, _p.x, 1.4, _p.z, roadYaw(w.s0));
      const t = canvasTex(256, 256, (ctx) => { ctx.fillStyle = '#111'; ctx.fillRect(0, 0, 256, 256); ctx.fillStyle = '#ffcc33'; ctx.beginPath(); const dir = (w.lane === 0) ? 1 : -1; ctx.translate(128, 128); ctx.scale(dir, 1); ctx.moveTo(-90, -30); ctx.lineTo(20, -30); ctx.lineTo(20, -80); ctx.lineTo(100, 0); ctx.lineTo(20, 80); ctx.lineTo(20, 30); ctx.lineTo(-90, 30); ctx.fill(); });
      const am = new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 2 });
      const ar = add(new THREE.PlaneGeometry(2.1, 2.1), am); ar.position.set(_p.x, 2.7, _p.z); ar.rotation.y = roadYaw(w.s0) + (w.dir > 0 ? Math.PI : 0);
      this.arrows.push(ar); c.arrows.push(ar);
      const pan = add(new THREE.PlaneGeometry(2.2, 1.4), new THREE.MeshStandardMaterial({ map: signTex(['TRAVAUX', 'voie fermée'], '#e0a020', 512, 320) }));
      roadToWorld(w.s0 - 300, w.dir * -16.5, _p); pan.position.set(_p.x, 2.2, _p.z); pan.rotation.y = roadYaw(w.s0) + (w.dir > 0 ? Math.PI : 0);
    }
  }

  buildScenery(g, s0, s1, r, k, tun, c) {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), col = new THREE.Color();
    const onD77 = (s, d) => (s > EXIT15[0] - 20 && s < D77.s0 + 30 && d < -14 && d > -150) || (s > D77.s0 - 30 && s < D77.s1 + 140 && d < -126 && d > -156) || (s > D77.s1 - 20 && s < DEST.s0 + 20 && d < -55 && d > -150) || (s > VILLAGE.s0 - 60 && s < VILLAGE.s1 + 60 && d < -100 && d > -215);
    const blocked = (s, d) => onD77(s, d) || (d < -18 && d > -100 && REST_AREAS.some(ra => s > ra.s0 - 50 && s < ra.s1 + 50)) || (d < -18 && d > -170 && s > EXIT_GAP[0] - 20 && s < DEST.s1 + 40) || (tun && s > tun[0] - 10 && s < tun[1] + 10 && Math.abs(d) < 62);
    // champs
    const nf = 6, fi = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.fieldMat, nf);
    const fc = [0xd8c070, 0x86a040, 0x8a6a48, 0xa8b860, 0x6f8f3a, 0xc8a050];
    for (let i = 0; i < nf; i++) {
      const side = i % 2 ? 1 : -1, d = side * (90 + r() * 420), s = s0 + r() * CH;
      if (blocked(s, d)) { m4.makeScale(0, 0, 0); fi.setMatrixAt(i, m4); continue; }
      roadToWorld(s, d, _p);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 0.6 - 0.3);
      m4.compose(pos.set(_p.x, 0.0 + i * 0.002, _p.z), q, sc.set(120 + r() * 120, 1, 150 + r() * 80)); fi.setMatrixAt(i, m4);
      fi.setColorAt(i, col.set(fc[(r() * fc.length) | 0]));
    }
    fi.receiveShadow = true; fi.userData.own = true; g.add(fi);
    // arbres (feuillus + conifères)
    const n = 70, trunks = new THREE.InstancedMesh(this.trunkGeo, this.trunkMat, n), crowns = new THREE.InstancedMesh(this.crownGeo, this.leafMat, n), pines = new THREE.InstancedMesh(this.pineGeo, this.leafMat, n);
    let ci = 0, pi = 0;
    for (let i = 0; i < n; i++) {
      let s = s0 + r() * CH, side = r() < 0.5 ? -1 : 1, d = side * (21 + Math.pow(r(), 1.6) * 260);
      if (r() < 0.25) d = side * (19.5 + r() * 8); // haie près de la route
      if (blocked(s, d)) continue;
      roadToWorld(s, d, _p);
      const scl = 0.7 + r() * 0.7;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6);
      m4.compose(pos.set(_p.x, 0, _p.z), q, sc.set(scl, scl * (0.8 + r() * 0.5), scl));
      trunks.setMatrixAt(ci + pi, m4);
      if (r() < 0.35) { pines.setMatrixAt(pi, m4); pines.setColorAt(pi, col.setHSL(0.3 + r() * 0.05, 0.4, 0.18 + r() * 0.06)); pi++; }
      else { crowns.setMatrixAt(ci, m4); crowns.setColorAt(ci, col.setHSL(0.2 + r() * 0.1, 0.45, 0.22 + r() * 0.1)); ci++; }
    }
    trunks.count = ci + pi; crowns.count = ci; pines.count = pi;
    for (const im of [trunks, crowns, pines]) { im.castShadow = true; im.receiveShadow = true; im.userData.own = true; g.add(im); }
    // hameaux / zones d'activités
    if (r() < 0.45) {
      const side = r() < 0.5 ? -1 : 1, d0 = side * (120 + r() * 350), sC = s0 + r() * CH;
      const nb = 4 + (r() * 9 | 0);
      const walls = new THREE.InstancedMesh(this.boxGeo, this.wallMat, nb), roofs = new THREE.InstancedMesh(this.roofGeo, this.roofMat, nb);
      const ind = r() < 0.3;
      let bi = 0;
      for (let i = 0; i < nb; i++) {
        const s = sC + (r() - 0.5) * 120, d = d0 + (r() - 0.5) * 120;
        if (blocked(s, d)) continue;
        roadToWorld(s, d, _p);
        const w = ind ? 25 + r() * 30 : 7 + r() * 6, l = ind ? 30 + r() * 40 : 9 + r() * 8, h = ind ? 8 + r() * 5 : 5 + r() * 3;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (r() < 0.5 ? 0 : Math.PI / 2) + r() * 0.2);
        m4.compose(pos.set(_p.x, 0, _p.z), q, sc.set(w, h, l)); walls.setMatrixAt(bi, m4);
        walls.setColorAt(bi, col.set(ind ? [0xb8bcc4, 0x9aa3ad, 0xd0d0cc][bi % 3] : [0xefe6d2, 0xe2d4b8, 0xd9cfc0, 0xf3efe6][bi % 4]));
        m4.compose(pos.set(_p.x, h - 0.72 * (ind ? 0.2 : 1), _p.z), q, sc.set(w, ind ? 0.4 : 3.2, l)); roofs.setMatrixAt(bi, m4);
        roofs.setColorAt(bi, col.set(ind ? 0x6a6f78 : [0xa3452d, 0x8e3a26, 0x5a5a5e][bi % 3]));
        bi++;
      }
      walls.count = roofs.count = bi;
      for (const im of [walls, roofs]) { im.castShadow = true; im.receiveShadow = true; im.userData.own = true; g.add(im); }
    }
    // éoliennes
    if (k % 3 === 0 && r() < 0.8) {
      const side = r() < 0.5 ? -1 : 1;
      for (let i = 0; i < 2; i++) {
        roadToWorld(s0 + i * 100 + r() * 60, side * (380 + r() * 300), _p);
        const t = new THREE.Group(); t.position.set(_p.x, 0, _p.z);
        const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.2, 80, 12), this.whiteMat); tower.position.y = 40; t.add(tower);
        const nac = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.8, 8), this.whiteMat); nac.position.set(0, 81, 1); t.add(nac);
        const rotor = new THREE.Group(); rotor.position.set(0, 81, 5.2);
        for (let j = 0; j < 3; j++) { const bl = new THREE.Mesh(new THREE.BoxGeometry(2.2, 40, 0.4).translate(0, 20, 0), this.whiteMat); bl.rotation.z = j * Math.PI * 2 / 3; rotor.add(bl); }
        t.add(rotor); t.rotation.y = Math.PI * (side > 0 ? 0.5 : -0.5) + 0.3;
        for (const o of [tower, nac]) o.castShadow = true;
        g.add(t); this.turbines.push({ rotor, speed: 0.6 + r() * 0.5, k });
      }
    }
  }

  // positions de lumières (pour les halos de nuit) proches de la caméra
  lampGlows(cam, out) {
    for (const [, c] of this.chunks) for (const p of c.glows) if (Math.abs(p[2] - cam.z) < 900) out.push(p);
  }
}
