// Caméras : cabine (1re personne), poursuite (3e personne), libre (orbite), à pied
import * as THREE from 'three';
import { clamp, settings } from './config.js';

const _v = new THREE.Vector3(), _t = new THREE.Vector3(), _q = new THREE.Quaternion();
export const CAM_MODES = ['chase', 'cockpit', 'free'];
export const CAM_NAMES = { chase: 'Troisième personne', cockpit: 'Cabine', free: 'Caméra libre', foot: 'À pied' };

export class CameraRig {
  constructor(camera) {
    this.cam = camera; this.mode = 'chase';
    this.pos = new THREE.Vector3(0, 5, -10); this.look = new THREE.Vector3();
    this.yawOff = 0; this.pitch = 0.25; this.dist = 1; this.orbit = { yaw: 0.6, pitch: 0.35, dist: 18 };
    this.shake = 0; this.lookBack = false;
  }
  cycle() { this.mode = CAM_MODES[(CAM_MODES.indexOf(this.mode) + 1) % CAM_MODES.length]; this.yawOff = 0; return this.mode; }

  update(dt, v, input, person) {
    const cam = this.cam, m = input.mouse;
    if (person) {
      this.orbit.yaw -= m.dx * 0.004 * settings.sens; this.orbit.pitch = clamp(this.orbit.pitch + m.dy * 0.003 * (settings.invertY ? -1 : 1), -0.2, 1.2);
      const d = 5;
      _t.copy(person.pos).add(_v.set(0, 1.6, 0));
      cam.position.set(_t.x - Math.sin(this.orbit.yaw) * Math.cos(this.orbit.pitch) * d, _t.y + Math.sin(this.orbit.pitch) * d, _t.z - Math.cos(this.orbit.yaw) * Math.cos(this.orbit.pitch) * d);
      cam.lookAt(_t); cam.fov = 65; cam.updateProjectionMatrix();
      return;
    }
    if (!v) return;
    const def = v.def, spd = Math.abs(v.speed);
    let fov = 62;
    if (this.mode === 'cockpit') {
      if (m.down) { this.yawOff = clamp(this.yawOff - m.dx * 0.004 * settings.sens, -2.4, 2.4); this.pitch = clamp(this.pitch + m.dy * 0.003, -0.6, 0.8); }
      else { this.yawOff *= 1 - Math.min(1, dt * 2); this.pitch += (0.18 - this.pitch) * Math.min(1, dt * 2); }
      _v.copy(v.cabPos).applyQuaternion(v.quat).add(v.pos);
      cam.position.copy(_v);
      const yaw = this.yawOff + (this.lookBack ? Math.PI : 0);
      _q.setFromEuler(new THREE.Euler(-this.pitch * 0.5, yaw + Math.PI, 0, 'YXZ'));
      cam.quaternion.copy(v.quat).multiply(_q);
      fov = 70 + clamp(spd / 50) * 6;
    } else if (this.mode === 'chase') {
      if (m.down) this.yawOff -= m.dx * 0.005 * settings.sens; else this.yawOff *= 1 - Math.min(1, dt * 1.5);
      if (m.wheel) this.dist = clamp(this.dist + m.wheel * 0.1, 0.6, 2.2);
      const trailerExtra = v.trailer ? 0 : 0;
      const dist = (def.cam.dist + trailerExtra + spd * 0.04) * this.dist, h = def.cam.h * (0.7 + 0.3 * this.dist);
      let yaw = v.yaw + this.yawOff + (this.lookBack ? Math.PI : 0);
      // la caméra suit la direction de la vitesse quand on glisse
      const want = _t.set(v.pos.x - Math.sin(yaw) * dist, v.pos.y + h, v.pos.z - Math.cos(yaw) * dist);
      this.pos.lerp(want, 1 - Math.exp(-dt * (6 + spd * 0.08)));
      if (this.pos.distanceTo(want) > 60) this.pos.copy(want);
      cam.position.copy(this.pos);
      this.look.set(v.pos.x + Math.sin(yaw) * 6, v.pos.y + h * 0.35 + 0.8, v.pos.z + Math.cos(yaw) * 6);
      cam.lookAt(this.look);
      fov = 60 + clamp(spd / 45) * 14;
    } else { // libre
      if (m.down) { this.orbit.yaw -= m.dx * 0.005 * settings.sens; this.orbit.pitch = clamp(this.orbit.pitch + m.dy * 0.004, -0.05, 1.45); }
      if (m.wheel) this.orbit.dist = clamp(this.orbit.dist * (1 + m.wheel * 0.1), 5, 120);
      const o = this.orbit, c = v.trailer ? v.trailer.pos.clone().lerp(v.pos, 0.5) : v.pos;
      cam.position.set(c.x + Math.sin(o.yaw) * Math.cos(o.pitch) * o.dist, c.y + 1 + Math.sin(o.pitch) * o.dist, c.z + Math.cos(o.yaw) * Math.cos(o.pitch) * o.dist);
      cam.lookAt(c.x, c.y + 1, c.z);
    }
    if (this.shake > 0) { this.shake = Math.max(0, this.shake - dt * 2); cam.position.x += (Math.random() - 0.5) * this.shake * 0.3; cam.position.y += (Math.random() - 0.5) * this.shake * 0.3; }
    cam.fov += (fov - cam.fov) * Math.min(1, dt * 3); cam.updateProjectionMatrix();
  }
}
