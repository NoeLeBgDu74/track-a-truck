// Halos lumineux (1 seul appel de rendu) + particules (fumée, gerbes d'eau, étincelles)
import * as THREE from 'three';

const glowVS = `
attribute float size; attribute vec3 color; varying vec3 vC; varying float vA;
void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
  float dist = -mv.z; gl_PointSize = clamp(size * 900.0 / dist, 2.0, 220.0); vC = color; vA = clamp(1.5 - dist/900.0, 0.25, 1.0); }`;
const glowFS = `
varying vec3 vC; varying float vA;
void main(){ vec2 p = gl_PointCoord - 0.5; float r = length(p)*2.0; float a = exp(-r*r*5.0) + 0.6*exp(-r*r*40.0); if(a<0.01) discard; gl_FragColor = vec4(vC * a * vA, 1.0); }`;

export class Glows {
  constructor(scene, max = 2000) {
    this.max = max;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3); this.size = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: glowVS, fragmentShader: glowFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.points.frustumCulled = false; this.points.renderOrder = 10;
    scene.add(this.points);
    this.c = new THREE.Color();
  }
  set(list, intensity = 1) {
    const n = Math.min(list.length, this.max);
    for (let i = 0; i < n; i++) {
      const [p, col, sz] = list[i];
      this.pos[i * 3] = p[0]; this.pos[i * 3 + 1] = p[1]; this.pos[i * 3 + 2] = p[2];
      this.c.set(col); const k = intensity;
      this.col[i * 3] = this.c.r * k; this.col[i * 3 + 1] = this.c.g * k; this.col[i * 3 + 2] = this.c.b * k;
      this.size[i] = sz;
    }
    this.geo.setDrawRange(0, n);
    for (const a of ['position', 'color', 'size']) this.geo.attributes[a].needsUpdate = true;
  }
}

const partVS = `
attribute float size; attribute float alpha; attribute vec3 color; varying float vA; varying vec3 vC;
void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = size * 600.0 / -mv.z; vA = alpha; vC = color; }`;
const partFS = `
uniform float light; varying float vA; varying vec3 vC;
void main(){ vec2 p = gl_PointCoord - 0.5; float r = length(p)*2.0; float a = smoothstep(1.0, 0.2, r) * vA; if(a<0.01) discard; gl_FragColor = vec4(vC * (vC.r > 0.9 && vC.b < 0.4 ? 1.0 : light), a); }`;

export class Particles {
  constructor(scene, max = 900) {
    this.max = max; this.list = [];
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.size = new Float32Array(max); this.alpha = new Float32Array(max); this.col = new Float32Array(max * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1)); g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo = g;
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: { light: { value: 1 } }, vertexShader: partVS, fragmentShader: partFS, transparent: true, depthWrite: false }));
    this.points.frustumCulled = false; this.points.renderOrder = 5;
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, life, size, grow, color = 0xdddddd, alpha = 0.5) {
    if (this.list.length >= this.max) this.list.shift();
    const c = new THREE.Color(color);
    this.list.push({ x, y, z, vx, vy, vz, life, t: 0, size, grow, r: c.r, g: c.g, b: c.b, a: alpha });
  }
  update(dt) {
    let n = 0;
    for (const p of this.list) {
      p.t += dt; if (p.t > p.life) continue;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vx *= 0.97; p.vz *= 0.97; p.vy *= 0.98;
      const k = p.t / p.life;
      this.pos[n * 3] = p.x; this.pos[n * 3 + 1] = p.y; this.pos[n * 3 + 2] = p.z;
      this.size[n] = p.size + p.grow * p.t; this.alpha[n] = p.a * (1 - k) * Math.min(1, p.t * 8);
      this.col[n * 3] = p.r; this.col[n * 3 + 1] = p.g; this.col[n * 3 + 2] = p.b;
      n++;
    }
    this.list = this.list.filter(p => p.t <= p.life);
    this.geo.setDrawRange(0, n);
    for (const a of ['position', 'size', 'alpha', 'color']) this.geo.attributes[a].needsUpdate = true;
  }
}
