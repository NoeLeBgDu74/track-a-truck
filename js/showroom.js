// Écran d'accueil : salle d'exposition de nuit (indépendante de l'autoroute)
// Semi-remorque sur plateau tournant, voitures de police gyrophares allumés, sol mouillé miroir,
// faisceaux lumineux, brume au sol, mur de LED, caméra cinématique + parallaxe souris.
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { VEHICLES, settings } from './config.js';
import { buildPlayerTruck, buildTrailer, buildPoliceCar, makeWheel, canvasTex } from './models.js';

function showcase(id, paint) {
  const def = VEHICLES[id], g = new THREE.Group();
  const m = def.team === 'police' ? buildPoliceCar(def, paint) : buildPlayerTruck(def, paint);
  g.add(m.group);
  for (const [x, z] of def.wheels) { const w = makeWheel(def.wheelR, def.team === 'truck' ? 0.38 : 0.26); w.position.set(x, def.wheelR, z); g.add(w); }
  if (def.trailer) {
    const t = buildTrailer(def); t.group.position.set(0, 0, def.trailer.kingpin); g.add(t.group);
    for (const az of def.trailer.axles) for (const sx of [1, -1]) { const w = makeWheel(0.5, 0.4); w.position.set(sx, 0.5, def.trailer.kingpin + az); g.add(w); }
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const head = m.group.getObjectByName('head'); if (head) { head.material = head.material.clone(); head.material.emissiveIntensity = 4; }
  const tail = m.group.getObjectByName('tail'); if (tail) { tail.material = tail.material.clone(); tail.material.emissiveIntensity = 1.5; }
  return { group: g, lights: m.lights, def };
}

export class Showroom {
  constructor(renderer) {
    this.renderer = renderer;
    const S = this.scene = new THREE.Scene();
    S.background = new THREE.Color(0x04060a);
    S.fog = new THREE.FogExp2(0x070a10, 0.014);
    const pm = new THREE.PMREMGenerator(renderer);
    S.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; S.environmentIntensity = 0.7;
    this.camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.1, 400);
    this.t = 0; this.mx = 0; this.my = 0;
    addEventListener('pointermove', e => { this.mx = e.clientX / innerWidth - 0.5; this.my = e.clientY / innerHeight - 0.5; });

    // sol miroir mouillé + voile rugueux
    const refl = new Reflector(new THREE.CircleGeometry(80, 64), { textureWidth: 1024, textureHeight: 1024, color: 0x3a3f48 });
    refl.rotation.x = -Math.PI / 2; refl.position.y = -0.01; S.add(refl);
    const wetTex = canvasTex(512, 512, (g, w, h) => {
      g.fillStyle = 'rgba(8,10,14,1)'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 90; i++) { const x = Math.random() * w, y = Math.random() * h, r = 20 + Math.random() * 90; const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(8,10,14,0)'); gr.addColorStop(1, 'rgba(8,10,14,0.9)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
    }, { repeat: true });
    wetTex.repeat.set(6, 6);
    const veil = new THREE.Mesh(new THREE.CircleGeometry(80, 64), new THREE.MeshStandardMaterial({ map: wetTex, transparent: true, opacity: 0.72, roughness: 0.35, metalness: 0.2, color: 0xffffff }));
    veil.rotation.x = -Math.PI / 2; veil.receiveShadow = true; S.add(veil);

    // plateau tournant avec anneau lumineux
    this.turn = new THREE.Group(); S.add(this.turn);
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(12, 12.3, 0.22, 96), new THREE.MeshStandardMaterial({ color: 0x15181e, roughness: 0.3, metalness: 0.8 }));
    plat.position.y = 0.11; plat.receiveShadow = true; this.turn.add(plat);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff7a1a });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(12.2, 0.06, 8, 160), ringMat); ring.rotation.x = Math.PI / 2; ring.position.y = 0.2; S.add(ring);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(12.6, 0.025, 8, 160), new THREE.MeshBasicMaterial({ color: 0x2f7dff })); ring2.rotation.x = Math.PI / 2; ring2.position.y = 0.03; S.add(ring2);
    this.ringMat = ringMat;

    // le camion vedette (celui choisi au garage)
    const id = settings.vehicle.truck || 'semi';
    this.truck = showcase(id, settings.paint[id]);
    this.truck.group.position.set(0, 0.22, VEHICLES[id].trailer ? 4.5 : 0);
    this.turn.add(this.truck.group);

    // voitures de police en V derrière
    this.cops = [];
    for (const [cid, x, z, ry] of [['suv', -9.5, -11, 0.75], ['sedan', 9.5, -11.5, -0.7], ['wagon', 0, -17, 0.05]]) {
      const c = showcase(cid); c.group.position.set(x, 0, z); c.group.rotation.y = ry; S.add(c.group); this.cops.push(c);
    }
    this.flash = [new THREE.PointLight(0x2050ff, 0, 30, 1.6), new THREE.PointLight(0xff2030, 0, 30, 1.6)];
    this.flash[0].position.set(-6, 2.5, -12); this.flash[1].position.set(6, 2.5, -12); S.add(...this.flash);

    // éclairage studio
    S.add(new THREE.HemisphereLight(0x5a6a8a, 0x101014, 0.9));
    const key = new THREE.SpotLight(0xffe2c0, 2600, 80, 0.45, 0.5, 1.5); key.position.set(-14, 18, 16); key.target.position.set(0, 1, 0); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004;
    const rim = new THREE.SpotLight(0x7fb0ff, 1800, 80, 0.5, 0.6, 1.5); rim.position.set(16, 12, -20); rim.target.position.set(0, 2, 0);
    const top = new THREE.SpotLight(0xffffff, 1400, 40, 0.42, 0.7, 1.5); top.position.set(0, 22, 2); top.target.position.set(0, 0, 0); top.castShadow = true;
    S.add(key, key.target, rim, rim.target, top, top.target);
    this.key = key;

    // faisceaux volumétriques (cônes additifs) qui balaient
    const beamMat = c => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const beamGeo = new THREE.ConeGeometry(4, 26, 32, 1, true); beamGeo.translate(0, -13, 0);
    this.beams = [];
    for (const [x, c] of [[-16, 0xff8a3a], [-6, 0xffffff], [6, 0xffffff], [16, 0x5a8aff]]) {
      const b = new THREE.Mesh(beamGeo, beamMat(c)); b.position.set(x, 24, -24); S.add(b); this.beams.push(b);
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, 1, 16), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: c, emissiveIntensity: 2 })); lamp.position.copy(b.position); S.add(lamp);
    }

    // mur de LED en fond
    const wallTex = canvasTex(1024, 512, (g, w, h) => {
      g.fillStyle = '#05070b'; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 16) for (let y = 0; y < h; y += 16) { const v = Math.random(); g.fillStyle = v > 0.985 ? '#ff7a1a' : v > 0.97 ? '#2f7dff' : 'rgba(40,50,70,0.5)'; g.fillRect(x + 4, y + 4, 8, 8); }
      g.fillStyle = 'rgba(255,122,26,0.9)'; g.font = '900 120px Arial Black, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.globalAlpha = 0.18; g.fillText('TRACK A TRUCK', w / 2, h / 2); g.globalAlpha = 1;
    });
    this.wallMat = new THREE.MeshStandardMaterial({ map: wallTex, emissive: 0xffffff, emissiveMap: wallTex, emissiveIntensity: 0.9 });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(90, 34), this.wallMat); wall.position.set(0, 14, -34); S.add(wall);
    for (const x of [-30, -20, 20, 30]) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.4, 30, 0.4), new THREE.MeshBasicMaterial({ color: x < 0 ? 0xff7a1a : 0x2f7dff })); s.position.set(x, 15, -30); S.add(s); }

    // brume au sol
    const fogTex = canvasTex(128, 128, (g) => { const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(200,210,230,0.5)'); gr.addColorStop(1, 'rgba(200,210,230,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); });
    this.mist = [];
    for (let i = 0; i < 40; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: fogTex, transparent: true, opacity: 0.12 + Math.random() * 0.1, depthWrite: false, color: 0x8a96aa }));
      const a = Math.random() * Math.PI * 2, r = 8 + Math.random() * 22; sp.position.set(Math.cos(a) * r, 0.6 + Math.random() * 1.2, Math.sin(a) * r - 4); const sc = 8 + Math.random() * 10; sp.scale.set(sc, sc * 0.4, 1);
      S.add(sp); this.mist.push({ sp, a, r, s: (Math.random() - 0.5) * 0.04 });
    }
    // fines gouttes qui tombent dans la lumière
    const N = 1200, rp = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) { const x = (Math.random() - 0.5) * 50, y = Math.random() * 20, z = (Math.random() - 0.5) * 40; rp.set([x, y, z, x, y - 0.35, z], i * 6); }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x9fb4d0, transparent: true, opacity: 0.25 })); S.add(this.rain); this.rainPos = rp;
  }

  setTruck(id) {
    if (!VEHICLES[id] || this.truck.def.id === id) return;
    this.turn.remove(this.truck.group);
    this.truck = showcase(id, settings.paint[id]);
    this.truck.group.position.set(0, 0.22, VEHICLES[id].trailer ? 4.5 : 0);
    this.turn.add(this.truck.group);
  }

  update(dt) {
    this.t += dt; const t = this.t;
    this.turn.rotation.y = t * 0.12;
    // caméra : lent travelling bas + parallaxe souris
    const a = 0.6 + Math.sin(t * 0.07) * 0.5 + this.mx * 0.35, r = 25 + Math.sin(t * 0.05) * 3;
    this.camera.position.set(Math.sin(a) * r, 4.2 + Math.sin(t * 0.11) * 1.2 - this.my * 3, Math.cos(a) * r);
    this.camera.lookAt(0, 2.6, -2);
    const W = innerWidth, H = innerHeight;
    this.camera.aspect = W / H;
    if (W > 760) this.camera.setViewOffset(W, H, -W * 0.2, 0, W, H); else this.camera.clearViewOffset(); // sujet décalé à droite du menu
    this.camera.updateProjectionMatrix();
    // gyrophares
    const ph = (t * 2.6) % 1, A = ph < 0.12 || (ph > 0.22 && ph < 0.34), B = (ph > 0.5 && ph < 0.62) || (ph > 0.72 && ph < 0.84);
    for (const c of this.cops) if (c.lights) { c.lights.blue.emissiveIntensity = A ? 10 : 0.2; c.lights.red.emissiveIntensity = B ? 10 : 0.2; }
    this.flash[0].intensity = A ? 140 : 0; this.flash[1].intensity = B ? 140 : 0;
    this.beams.forEach((b, i) => { b.rotation.z = Math.sin(t * 0.4 + i * 1.7) * 0.45; b.rotation.x = 0.35 + Math.sin(t * 0.3 + i) * 0.2; });
    this.ringMat.color.setHSL(0.07, 1, 0.45 + Math.sin(t * 2) * 0.1);
    this.wallMat.emissiveIntensity = 0.7 + Math.sin(t * 1.3) * 0.2;
    for (const m of this.mist) { m.a += m.s * dt; m.sp.position.x = Math.cos(m.a) * m.r; m.sp.position.z = Math.sin(m.a) * m.r - 4; }
    const p = this.rainPos; for (let i = 0; i < p.length / 6; i++) { let y = p[i * 6 + 1] - 14 * dt; if (y < 0) y += 20; p[i * 6 + 1] = y; p[i * 6 + 4] = y - 0.35; }
    this.rain.geometry.attributes.position.needsUpdate = true;
  }
}
