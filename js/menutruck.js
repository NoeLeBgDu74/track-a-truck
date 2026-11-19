// Accueil : un petit camion (vu du dessus) suit la souris et dessine sa route derrière lui
export class MenuTruck {
  constructor(parent) {
    const c = this.c = document.createElement('canvas'); c.id = 'menutruck';
    parent.prepend(c); this.g = c.getContext('2d');
    this.x = innerWidth * 0.7; this.y = innerHeight * 0.75; this.a = -Math.PI / 2; this.v = 0; this.tx = this.x; this.ty = this.y - 100;
    this.trail = []; this.dist = 0; this.idleT = 0;
    addEventListener('pointermove', e => { this.tx = e.clientX; this.ty = e.clientY; this.idleT = 0; });
    this.resize(); addEventListener('resize', () => this.resize());
  }
  resize() { const d = Math.min(devicePixelRatio, 2); this.c.width = innerWidth * d; this.c.height = innerHeight * d; this.d = d; }
  step(dt) {
    dt = Math.min(dt, 0.05);
    this.idleT += dt;
    if (this.idleT > 4) { const t = performance.now() / 1000; this.tx = innerWidth * (0.66 + Math.sin(t * 0.4) * 0.22); this.ty = innerHeight * (0.5 + Math.sin(t * 0.7) * 0.3); }
    const dx = this.tx - this.x, dy = this.ty - this.y, dist = Math.hypot(dx, dy);
    const want = Math.atan2(dy, dx); let da = want - this.a; da = Math.atan2(Math.sin(da), Math.cos(da));
    const vT = dist > 30 ? Math.min(260, dist * 1.6) : 0;
    this.v += (vT - this.v) * Math.min(1, dt * 2.5);
    this.a += Math.max(-1, Math.min(1, da)) * dt * 3.2 * Math.min(1, this.v / 60);
    this.x += Math.cos(this.a) * this.v * dt; this.y += Math.sin(this.a) * this.v * dt;
    this.dist += this.v * dt;
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(last.x - this.x, last.y - this.y) > 6) { this.trail.push({ x: this.x, y: this.y, d: this.dist }); if (this.trail.length > 420) this.trail.shift(); }
    // remorque : suit l'attelage
    const kx = this.x - Math.cos(this.a) * 9, ky = this.y - Math.sin(this.a) * 9;
    this.ta ??= this.a; const tx = kx - Math.cos(this.ta) * 30, ty = ky - Math.sin(this.ta) * 30;
    this.ta = Math.atan2(ky - ty, kx - tx);
    this.draw(kx, ky);
  }
  draw(kx, ky) {
    const g = this.g, d = this.d, T = this.trail;
    g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, innerWidth, innerHeight);
    if (T.length > 2) {
      const n = T.length;
      for (const [w, col, dash] of [[30, 'rgba(40,44,52,', null], [26, 'rgba(70,74,82,', null], [2, 'rgba(255,255,255,', [10, 12]]]) {
        g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round'; g.setLineDash(dash || []);
        for (let i = 1; i < n; i++) { const k = i / n; g.strokeStyle = col + (k * (dash ? 0.7 : 0.75)).toFixed(3) + ')'; g.lineDashOffset = -T[i - 1].d; g.beginPath(); g.moveTo(T[i - 1].x, T[i - 1].y); g.lineTo(T[i].x, T[i].y); g.stroke(); }
      }
      g.setLineDash([]);
      for (const side of [-1, 1]) { // lignes de rive
        g.lineWidth = 1.5;
        for (let i = 2; i < n; i++) {
          const a = T[i - 1], b = T[i], ang = Math.atan2(b.y - a.y, b.x - a.x), ox = -Math.sin(ang) * 11 * side, oy = Math.cos(ang) * 11 * side;
          g.strokeStyle = `rgba(255,200,120,${(i / n * 0.6).toFixed(3)})`; g.beginPath(); g.moveTo(a.x + ox, a.y + oy); g.lineTo(b.x + ox, b.y + oy); g.stroke();
        }
      }
    }
    // remorque
    g.save(); g.translate(kx, ky); g.rotate(this.ta);
    g.fillStyle = '#e8e8e2'; g.fillRect(-32, -7, 34, 14); g.fillStyle = '#ff7a1a'; g.fillRect(-32, -7, 34, 2.5); g.fillRect(-32, 4.5, 34, 2.5);
    g.fillStyle = '#ff3030'; g.fillRect(-33, -6, 1.5, 3); g.fillRect(-33, 3, 1.5, 3);
    g.restore();
    // tracteur
    g.save(); g.translate(this.x, this.y); g.rotate(this.a);
    g.fillStyle = '#111'; g.fillRect(-11, -6, 12, 12);
    g.fillStyle = '#c21d24'; g.fillRect(-2, -7, 11, 14); g.fillStyle = '#18233a'; g.fillRect(5, -6, 3, 12);
    g.fillStyle = '#fff6d0'; g.fillRect(8.5, -6, 1.5, 3); g.fillRect(8.5, 3, 1.5, 3);
    if (this.v > 20) { g.fillStyle = 'rgba(255,240,200,0.12)'; g.beginPath(); g.moveTo(10, -6); g.lineTo(60, -22); g.lineTo(60, 22); g.lineTo(10, 6); g.fill(); }
    g.restore();
  }
}
