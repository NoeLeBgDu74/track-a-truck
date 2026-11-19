// Accueil : le petit camion EST le curseur de la souris. Il dessine une route derrière lui, qui s'efface vite.
// Remorque articulée réaliste : l'essieu de la remorque est tiré par la sellette.
const FADE = 1.1; // secondes avant que la route ne disparaisse

export class MenuTruck {
  constructor(parent) {
    const c = this.c = document.createElement('canvas'); c.id = 'menutruck';
    parent.prepend(c); this.g = c.getContext('2d'); this.parent = parent;
    this.x = innerWidth * 0.7; this.y = innerHeight * 0.6; this.a = -Math.PI / 2;
    this.mx = this.x; this.my = this.y; this.moved = false; this.idleT = 10;
    this.trail = [];
    this.ax = this.x; this.ay = this.y + 40; // essieu de la remorque
    addEventListener('pointermove', e => { this.mx = e.clientX; this.my = e.clientY; this.idleT = 0; this.moved = true; });
    this.resize(); addEventListener('resize', () => this.resize());
  }
  resize() { const d = Math.min(devicePixelRatio, 2); this.c.width = innerWidth * d; this.c.height = innerHeight * d; this.d = d; }
  step(dt) {
    dt = Math.min(dt, 0.05);
    const now = performance.now() / 1000;
    this.idleT += dt;
    let tx = this.mx, ty = this.my;
    if (this.idleT > 5 || !this.moved) { tx = innerWidth * (0.68 + Math.sin(now * 0.5) * 0.2); ty = innerHeight * (0.55 + Math.sin(now * 0.9) * 0.28); }
    // le camion colle au pointeur (léger lissage seulement pour la démo automatique)
    const k = this.idleT > 5 || !this.moved ? Math.min(1, dt * 3) : 0.65;
    const nx = this.x + (tx - this.x) * k, ny = this.y + (ty - this.y) * k;
    const dx = nx - this.x, dy = ny - this.y, mv = Math.hypot(dx, dy);
    if (mv > 0.4) { const want = Math.atan2(dy, dx); let da = want - this.a; da = Math.atan2(Math.sin(da), Math.cos(da)); this.a += da * Math.min(1, 0.25 + mv * 0.04); }
    this.x = nx; this.y = ny;
    // route : points horodatés, effacés après FADE secondes
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(last.x - this.x, last.y - this.y) > 4) this.trail.push({ x: this.x, y: this.y, t: now });
    while (this.trail.length && now - this.trail[0].t > FADE) this.trail.shift();
    // attelage : sellette derrière la cabine, l'essieu de remorque suit (tiré)
    const K = 7, L = 30;
    const kx = this.x - Math.cos(this.a) * K, ky = this.y - Math.sin(this.a) * K;
    let ex = kx - this.ax, ey = ky - this.ay, el = Math.hypot(ex, ey) || 1;
    if (el > L * 3) { this.ax = kx - Math.cos(this.a) * L; this.ay = ky - Math.sin(this.a) * L; ex = kx - this.ax; ey = ky - this.ay; el = L; }
    this.ax = kx - ex / el * L; this.ay = ky - ey / el * L;
    this.draw(kx, ky, Math.atan2(ky - this.ay, kx - this.ax), now);
  }
  draw(kx, ky, ta, now) {
    const g = this.g, d = this.d, T = this.trail;
    g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, innerWidth, innerHeight);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (let i = 1; i < T.length; i++) {
      const a = T[i - 1], b = T[i], f = Math.max(0, 1 - (now - b.t) / FADE);
      g.lineWidth = 24; g.strokeStyle = `rgba(52,56,64,${(f * 0.85).toFixed(3)})`; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      const ang = Math.atan2(b.y - a.y, b.x - a.x), ox = -Math.sin(ang) * 10, oy = Math.cos(ang) * 10;
      g.lineWidth = 1.5; g.strokeStyle = `rgba(255,190,110,${(f * 0.7).toFixed(3)})`;
      g.beginPath(); g.moveTo(a.x + ox, a.y + oy); g.lineTo(b.x + ox, b.y + oy); g.moveTo(a.x - ox, a.y - oy); g.lineTo(b.x - ox, b.y - oy); g.stroke();
      if (i % 4 < 2) { g.lineWidth = 2; g.strokeStyle = `rgba(255,255,255,${(f * 0.8).toFixed(3)})`; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
    }
    // remorque (de la sellette vers l'arrière)
    g.save(); g.translate(kx, ky); g.rotate(ta);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(-35, -7, 38, 15);
    g.fillStyle = '#ecebe6'; g.fillRect(-36, -8, 38, 15); g.fillStyle = '#ff7a1a'; g.fillRect(-36, -8, 38, 3); g.fillRect(-36, 4, 38, 3);
    g.fillStyle = '#ff3030'; g.fillRect(-37, -7, 1.5, 3); g.fillRect(-37, 3, 1.5, 3);
    g.restore();
    // tracteur (le « curseur »)
    g.save(); g.translate(this.x, this.y); g.rotate(this.a);
    g.fillStyle = '#111'; g.fillRect(-9, -6, 9, 12);
    g.fillStyle = '#c21d24'; g.fillRect(-1, -7.5, 10, 15); g.fillStyle = '#18233a'; g.fillRect(5, -6.5, 3, 13);
    g.fillStyle = '#fff6d0'; g.fillRect(8.5, -6.5, 1.5, 3); g.fillRect(8.5, 3.5, 1.5, 3);
    g.fillStyle = 'rgba(255,240,200,0.12)'; g.beginPath(); g.moveTo(10, -6); g.lineTo(55, -20); g.lineTo(55, 20); g.lineTo(10, 6); g.fill();
    g.restore();
  }
}
