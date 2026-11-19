// Cinématique d'introduction : pourquoi on vole ce camion (ou pourquoi on le poursuit)
import * as THREE from 'three';

const $ = id => document.getElementById(id);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _l = new THREE.Vector3();
const ease = t => t * t * (3 - 2 * t);

// point dans le repère d'un véhicule (x gauche, y haut, z avant)
function rel(v, x, y, z, out) { return out.set(x, y, z).applyQuaternion(v.curQuat).add(v.curPos); }

export function storyShots(game, kind, names) {
  const T = () => game.player, P = () => game.police.find(p => p.v !== game.player)?.v || game.player, F = () => game.fugitives[0]?.v || game.player;
  const [A, B] = names || ['Marcel', 'Gégé'];
  const truckStory = [
    { d: 4.5, t: 'Lundi, 5 h 47. Dépôt de la <b>MégaCorp Fromagère</b>.', cam: (k, c, l) => { rel(T(), 40 - k * 25, 28 - k * 10, 30 - k * 40, c); rel(T(), 0, 1, -4, l); } },
    { d: 4.5, t: 'Dans la remorque : 22 tonnes de <b>Tomme Dorée</b>, le dernier fromage artisanal d’Europe.', cam: (k, c, l) => { rel(T(), 6, 2.5, -6 - k * 8, c); rel(T(), 0, 2.2, -10 - k * 4, l); } },
    { d: 4.5, t: 'La MégaCorp a décidé de le transformer en… <b>fromage en tube</b>.', cam: (k, c, l) => { rel(T(), -3, 1.2, 9 + k * 3, c); rel(T(), 0, 2.4, 0, l); } },
    { d: 5, t: kind === 'coop' ? `<b>${A}</b> et <b>${B}</b>, routiers depuis 30 ans, ont « emprunté » le camion. Ils n’ont pas dormi depuis deux jours. Et ils ont faim.` : '<b>Marcel</b>, routier depuis 30 ans, a pris le volant. Sans demander la permission.', cam: (k, c, l) => { rel(T(), 0.6 + k * 0.4, T().cabPos.y + T().bodyY + 0.6, T().def.len / 2 + 3.5, c); rel(T(), 0.4, T().cabPos.y + T().bodyY, 0, l); } },
    { d: 4.5, t: 'Mais la MégaCorp a des amis dans la police. Les sirènes ne vont pas tarder.', cam: (k, c, l) => { rel(P(), 4 + k * 3, 1.6, 8 + k * 4, c); rel(P(), 0, 1.2, 0, l); }, siren: true },
    { d: 5, t: 'Objectif : livrer la Tomme Dorée à la coopérative des fromagers — <b>Plateforme Logistique, sortie 18</b>.', cam: (k, c, l) => { rel(T(), 0, 60 + k * 30, -20 - k * 60, c); rel(T(), 0, 0, 120 + k * 60, l); } },
    { d: 3, t: kind === 'coop' ? 'Vous avez 15 secondes d’avance. Ne vous endormez pas.' : 'Vous avez 15 secondes d’avance.', cam: (k, c, l) => { rel(T(), -6 + k * 6, 3.5, -T().def.cam.dist * 0.9, c); rel(T(), 0, 2, 8, l); } },
  ];
  const policeStory = [
    { d: 4, t: 'Autoroute A77, 5 h 52. Patrouille de la <b>gendarmerie autoroutière</b>.', cam: (k, c, l) => { rel(T(), 30 - k * 22, 18 - k * 10, -30 + k * 20, c); rel(T(), 0, 1, 0, l); } },
    { d: 5, t: '« À toutes les unités : un poids lourd a été volé au dépôt de la MégaCorp. »', cam: (k, c, l) => { rel(T(), 0.4, T().cabPos.y + T().bodyY + 0.1, -0.4 - k * 0.3, c); rel(T(), 0.4, T().cabPos.y + T().bodyY - 0.2, 6, l); }, siren: true },
    { d: 5, t: '« La cargaison ? 22 tonnes de fromage. Oui. <b>Du fromage.</b> »', cam: (k, c, l) => { rel(F(), 8 - k * 4, 3, 10 + k * 6, c); rel(F(), 0, 2, -3, l); } },
    { d: 4.5, t: '« Il fonce vers la sortie 18. Interceptez-le avant qu’il ne livre. Sans abîmer les civils, merci. »', cam: (k, c, l) => { rel(T(), 0, 50 + k * 20, -30 - k * 30, c); rel(T(), 0, 0, 150, l); } },
    { d: 3, t: 'Le suspect a 10 secondes d’avance.', cam: (k, c, l) => { rel(T(), -4 + k * 4, 2.4, -T().def.cam.dist, c); rel(T(), 0, 1.2, 10, l); }, siren: true },
  ];
  return kind === 'police' ? policeStory : truckStory;
}

export class Cinematic {
  constructor(game) { this.game = game; this.on = false; }
  play(shots, done) {
    this.shots = shots; this.i = 0; this.t = 0; this.done = done; this.on = true;
    $('cine').classList.add('on'); this.show();
    $('cine-skip').onclick = () => this.finish();
  }
  show() { const s = this.shots[this.i]; $('cine-text').innerHTML = s.t; $('cine-text').classList.remove('in'); void $('cine-text').offsetWidth; $('cine-text').classList.add('in'); }
  update(dt, input) {
    if (!this.on) return false;
    if (input.hit('Space') || input.hit('Enter') || input.hit('Escape')) { this.finish(); return true; }
    const s = this.shots[this.i];
    this.t += dt;
    const k = ease(Math.min(1, this.t / s.d));
    const cam = this.game.camera;
    try { s.cam(k, _a, _l); cam.position.copy(_a); cam.lookAt(_l); } catch (e) { }
    cam.fov = 50; cam.updateProjectionMatrix();
    for (const p of this.game.police) if (p.v !== this.game.player) p.v.siren = !!s.siren || this.i >= 4;
    if (this.t >= s.d) { this.i++; this.t = 0; if (this.i >= this.shots.length) this.finish(); else this.show(); }
    return true;
  }
  finish() {
    if (!this.on) return;
    this.on = false; $('cine').classList.remove('on');
    for (const p of this.game.police) if (p.v !== this.game.player && p.ai?.role === 'idle') p.v.siren = false;
    const d = this.done; this.done = null; d?.();
  }
}
