// Clavier (codes physiques : ZQSD sur AZERTY = WASD sur QWERTY) + manette
export class Input {
  constructor() {
    this.keys = new Set(); this.pressed = new Set();
    this.mouse = { dx: 0, dy: 0, down: false, wheel: 0 };
    addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    const cv = document.getElementById('c');
    cv.addEventListener('mousedown', e => { this.mouse.down = true; this.mouse.btn = e.button; this.mouse.clicked = true; });
    addEventListener('mouseup', () => this.mouse.down = false);
    addEventListener('mousemove', e => { if (this.mouse.down || document.pointerLockElement) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; } });
    cv.addEventListener('wheel', e => { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    cv.addEventListener('contextmenu', e => e.preventDefault());
    this.gpPrev = [];
    this.touch = {};
  }
  down(...codes) { return codes.some(c => this.keys.has(c)); }
  hit(code) { return this.pressed.has(code); }
  endFrame() { this.pressed.clear(); this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0; this.mouse.clicked = false; }

  drive() {
    let throttle = this.down('KeyW', 'ArrowUp') ? 1 : 0, brake = this.down('KeyS', 'ArrowDown') ? 1 : 0;
    let steer = (this.down('KeyA', 'ArrowLeft') ? 1 : 0) - (this.down('KeyD', 'ArrowRight') ? 1 : 0);
    let handbrake = this.down('Space');
    const T = this.touch; if (T.gas) throttle = 1; if (T.brake) brake = 1; if (T.l) steer = 1; if (T.r) steer = -1; if (T.l && T.r) steer = 0; if (T.hand) handbrake = true;
    const gp = navigator.getGamepads ? [...navigator.getGamepads()].find(g => g) : null;
    if (gp) {
      const ax = gp.axes[0] || 0; if (Math.abs(ax) > 0.12) steer = -ax;
      const rt = gp.buttons[7]?.value || 0, lt = gp.buttons[6]?.value || 0;
      if (rt > 0.05) throttle = rt; if (lt > 0.05) brake = lt;
      if (gp.buttons[0]?.pressed) handbrake = true;
      const map = { 3: 'KeyC', 2: 'KeyH', 1: 'KeyE', 9: 'Escape', 4: 'KeyL', 5: 'KeyR', 12: 'KeyF' };
      gp.buttons.forEach((b, i) => { if (b.pressed && !this.gpPrev[i] && map[i]) this.pressed.add(map[i]); if (i === 2) { if (b.pressed) this.keys.add('KeyH'); else if (this.gpPrev[i]) this.keys.delete('KeyH'); } });
      this.gpPrev = gp.buttons.map(b => b.pressed);
      const rx = gp.axes[2] || 0, ry = gp.axes[3] || 0;
      if (Math.abs(rx) > 0.15) this.mouse.dx += rx * 12; if (Math.abs(ry) > 0.15) this.mouse.dy += ry * 12;
    }
    return { throttle, brake, steer, handbrake };
  }
}
