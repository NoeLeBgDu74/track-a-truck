// Ciel, soleil/lune, ombres, brouillard, pluie, éclairs, nuages, carte d'environnement (reflets)
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { clamp, lerp } from './config.js';
import { canvasTex } from './models.js';

export class Env {
  constructor(renderer, scene) {
    this.renderer = renderer; this.scene = scene;
    this.sky = new Sky(); this.sky.scale.setScalar(20000); scene.add(this.sky);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 4; u.rayleigh.value = 1.6; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.8;
    this.sun = new THREE.DirectionalLight(0xfff1dc, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera; sc.left = -75; sc.right = 75; sc.top = 75; sc.bottom = -75; sc.near = 1; sc.far = 600;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x50603a, 0.9); scene.add(this.hemi);
    this.fog = new THREE.FogExp2(0xbfd0e0, 0.0005); scene.fog = this.fog;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene(); this.envSky = new Sky(); this.envSky.scale.setScalar(1000); this.envScene.add(this.envSky);
    this.sunDir = new THREE.Vector3();
    // étoiles
    const sp = []; for (let i = 0; i < 1500; i++) { const v = new THREE.Vector3().randomDirection(); if (v.y < 0.05) v.y = -v.y + 0.05; sp.push(v.x * 9000, v.y * 9000, v.z * 9000); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    scene.add(this.stars);
    // nuages
    const ct = canvasTex(1024, 1024, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      for (let i = 0; i < 260; i++) {
        const x = Math.random() * w, y = Math.random() * h, r = 30 + Math.random() * 110;
        const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.28)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
      }
    }, { repeat: true });
    ct.repeat.set(3, 3);
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000), new THREE.MeshBasicMaterial({ map: ct, transparent: true, opacity: 0.7, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    this.clouds.rotation.x = Math.PI / 2; this.clouds.position.y = 900; scene.add(this.clouds);
    // pluie
    const N = 5000, rp = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) { const x = (Math.random() - 0.5) * 80, y = Math.random() * 40, z = (Math.random() - 0.5) * 80; rp.set([x, y, z, x, y - 0.6, z], i * 6); }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0.35, depthWrite: false }));
    this.rain.frustumCulled = false; this.rain.visible = false; scene.add(this.rain);
    this.rainPos = rp; this.rainN = N;

    this.timeOfDay = 13; this.weather = 'clear'; this.cycle = false;
    this.wet = 0; this.rainAmt = 0; this.fogAmt = 0; this.night = 0; this.tunnel = 0; this.flash = 0; this.nextFlash = 10;
    this.envDirty = true; this.envT = 0;
  }

  setTime(preset) {
    this.cycle = preset === 'cycle';
    this.timeOfDay = { day: 13, dusk: 19.6, night: 23.5, dawn: 6.6, cycle: 17.5 }[preset] ?? 13;
    this.envDirty = true;
  }
  setWeather(w) { this.weather = w; this.envDirty = true; }

  update(dt, focus, camPos, inTunnel, audio) {
    if (this.cycle) { this.timeOfDay = (this.timeOfDay + dt * 24 / 900) % 24; this.envT += dt; if (this.envT > 4) { this.envT = 0; this.envDirty = true; } }
    const wantRain = this.weather === 'rain' || this.weather === 'storm' ? 1 : 0;
    const wantFog = this.weather === 'fog' ? 1 : (wantRain ? 0.35 : 0);
    this.rainAmt += (wantRain - this.rainAmt) * Math.min(1, dt * 0.5);
    this.fogAmt += (wantFog - this.fogAmt) * Math.min(1, dt * 0.5);
    this.wet += ((wantRain ? 1 : 0) - this.wet) * Math.min(1, dt * (wantRain ? 0.15 : 0.03));

    // soleil
    const h = this.timeOfDay;
    const elev = Math.sin((h - 6.5) / 12 * Math.PI) * 62; // degrés
    const az = (h / 24) * 360 + 140;
    const phi = THREE.MathUtils.degToRad(90 - elev), th = THREE.MathUtils.degToRad(az);
    this.sunDir.setFromSphericalCoords(1, phi, th);
    const day = clamp((elev + 4) / 14);
    this.night = 1 - day;
    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDir);
    u.turbidity.value = lerp(3.5, 12, Math.max(this.rainAmt, this.fogAmt));
    u.rayleigh.value = lerp(1.4, 0.6, this.rainAmt) * (0.3 + 0.7 * day) + (1 - day) * 0.2;
    // lumière : soleil le jour, lune la nuit
    const moon = this.night > 0.5;
    const ld = moon ? new THREE.Vector3(-this.sunDir.x, Math.abs(this.sunDir.y) + 0.4, -this.sunDir.z).normalize() : this.sunDir;
    this.sun.position.copy(focus).addScaledVector(ld, 300);
    this.sun.target.position.copy(focus);
    const overcast = 1 - 0.65 * Math.max(this.rainAmt, this.fogAmt * 0.8);
    const warm = clamp(1 - elev / 25);
    this.sun.color.setRGB(1, lerp(0.97, 0.72, warm), lerp(0.9, 0.5, warm));
    if (moon) this.sun.color.setRGB(0.6, 0.7, 1);
    this.sun.intensity = (moon ? 0.25 * this.night : 3.2 * day) * overcast * (1 - this.tunnel);
    this.hemi.intensity = (0.25 + 0.75 * day) * lerp(1, 0.75, this.rainAmt) * (1 - this.tunnel * 0.55);
    this.hemi.color.setRGB(lerp(0.32, 0.75, day), lerp(0.38, 0.85, day), lerp(0.55, 1, day));
    if (this.tunnel > 0) this.hemi.color.lerp(new THREE.Color(1, 0.75, 0.45), this.tunnel * 0.6);
    // éclairs
    if (this.weather === 'storm') {
      this.nextFlash -= dt;
      if (this.nextFlash <= 0) { this.flash = 1; this.nextFlash = 8 + Math.random() * 20; audio?.thunder(1.5 + Math.random() * 2); }
    }
    if (this.flash > 0) { this.flash -= dt * 3; this.hemi.intensity += Math.max(0, this.flash) * 3 * (Math.random() < 0.5 ? 1 : 0.3); }
    // brouillard
    const fogDay = new THREE.Color().setHSL(0.58, lerp(0.05, 0.35, day * (1 - this.rainAmt)), lerp(0.04, 0.72, day) * lerp(1, 0.75, this.rainAmt));
    if (warm > 0.5 && day > 0.2 && day < 0.95) fogDay.lerp(new THREE.Color(0xd8a080), (warm - 0.5) * 0.6);
    this.fog.color.copy(fogDay);
    this.fog.density = 0.00028 + this.fogAmt * 0.0075 + this.rainAmt * 0.0012 + this.tunnel * 0.002;
    this.scene.background = null;
    this.stars.material.opacity = clamp(this.night * 1.2 - 0.2) * (1 - this.rainAmt);
    this.stars.position.copy(camPos);
    this.clouds.position.x = camPos.x; this.clouds.position.z = camPos.z;
    this.clouds.material.map.offset.x += dt * 0.002;
    this.clouds.material.opacity = lerp(0.55, 1, this.rainAmt) * lerp(0.25, 1, day);
    this.clouds.material.color.setScalar(lerp(1, 0.45, this.rainAmt) * lerp(0.15, 1, day));
    this.sky.material.uniforms.mieCoefficient.value = 0.004 + this.rainAmt * 0.01;
    this.sky.visible = true;
    // pluie autour de la caméra
    this.rain.visible = this.rainAmt > 0.05;
    if (this.rain.visible) {
      this.rain.position.set(camPos.x, camPos.y - 15, camPos.z);
      this.rain.material.opacity = 0.32 * this.rainAmt * (1 - this.tunnel);
      const p = this.rainPos, fall = 24 * dt;
      for (let i = 0; i < this.rainN; i++) {
        let y = p[i * 6 + 1] - fall;
        if (y < 0) y += 40;
        p[i * 6 + 1] = y; p[i * 6 + 4] = y - 0.7;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
    if (this.envDirty) this.updateEnv();
  }

  updateEnv() {
    this.envDirty = false;
    const u = this.envSky.material.uniforms, s = this.sky.material.uniforms;
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) u[k].value = s[k].value;
    u.sunPosition.value.copy(this.sunDir);
    if (this.rt) this.rt.dispose();
    this.rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 2000);
    this.scene.environment = this.rt.texture;
    this.scene.environmentIntensity = Math.max(0.08, 1 - this.night * 0.92) * (1 - this.rainAmt * 0.3);
  }
}
