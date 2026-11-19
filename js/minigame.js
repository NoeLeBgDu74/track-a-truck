// Mini-jeux du copilote (souris, tactile ou manette) : réveiller, écraser l'abeille, plier la carte,
// préparer le sandwich, fermer les portes de la remorque, débloquer le klaxon.
const $ = id => document.getElementById(id);

export const Mini = {
  on: false,
  play(type, ok, fail) {
    if (this.on) return;
    this.on = true; this.type = type; this.ok = ok; this.fail = fail; this.n = 0; this.t0 = performance.now();
    const box = $('mini'), body = $('mini-body');
    box.className = 'on ' + type;
    const T = { mash: ['RÉVEILLE-LE !', 'Clique (ou appuie) le plus vite possible !'], swat: ['ÉCRASE L’ABEILLE !', 'Clique sur l’abeille 3 fois'], fold: ['REPLIE LA CARTE', 'Clique les coins dans l’ordre 1 → 4'], sandwich: ['PRÉPARE LE SANDWICH', 'Clique les ingrédients dans l’ordre'], hold: ['FERME LES PORTES !', 'Maintiens le bouton enfoncé'] }[type];
    $('mini-title').textContent = T[0]; $('mini-hint').textContent = T[1];
    const limit = { mash: 3500, swat: 6000, fold: 6000, sandwich: 7000, hold: 6000 }[type];
    this.limit = limit;
    if (type === 'mash') { body.innerHTML = '<button class="mg-big" id="mg-b">👋 PAF !</button><div class="mg-bar"><b id="mg-p"></b></div>'; $('mg-b').onpointerdown = () => this.hit(); }
    if (type === 'swat') { body.innerHTML = '<div class="mg-area" id="mg-a"><span id="mg-bee">🐝</span></div>'; this.moveBee(); $('mg-bee').onpointerdown = e => { e.stopPropagation(); this.hit(); this.moveBee(); }; }
    if (type === 'fold') { body.innerHTML = '<div class="mg-map">' + [1, 2, 3, 4].sort(() => Math.random() - 0.5).map(i => `<button data-i="${i}">${i}</button>`).join('') + '</div>'; body.querySelectorAll('button').forEach(b => b.onpointerdown = () => { if (+b.dataset.i === this.n + 1) { b.classList.add('done'); this.hit(); } else this.shake(); }); }
    if (type === 'sandwich') {
      const ing = [['🍞', 'Pain'], ['🧈', 'Beurre'], ['🥓', 'Jambon'], ['🥒', 'Cornichon']]; this.order = ing.map((_, i) => i);
      body.innerHTML = '<div class="mg-order">' + ing.map(x => x[0]).join(' → ') + '</div><div class="mg-ing">' + ing.map((x, i) => [x, i]).sort(() => Math.random() - 0.5).map(([x, i]) => `<button data-i="${i}">${x[0]}<small>${x[1]}</small></button>`).join('') + '</div>';
      body.querySelectorAll('button').forEach(b => b.onpointerdown = () => { if (+b.dataset.i === this.n) { b.classList.add('done'); this.hit(); } else this.shake(); });
    }
    if (type === 'hold') { body.innerHTML = '<button class="mg-big" id="mg-b">🚪 TENIR</button><div class="mg-bar"><b id="mg-p"></b></div>'; const b = $('mg-b'); b.onpointerdown = () => this.holding = true; b.onpointerup = b.onpointerleave = () => this.holding = false; this.held = 0; }
    clearInterval(this.iv);
    let last = performance.now();
    this.iv = setInterval(() => {
      const now = performance.now(), dt = (now - last) / 1000; last = now;
      if (type === 'hold' && this.holding) { this.held += dt; $('mg-p').style.width = Math.min(100, this.held / 2 * 100) + '%'; if (this.held >= 2) this.end(true); }
      if (type === 'swat' && Math.random() < 0.06) this.moveBee();
      $('mini-time').style.width = Math.max(0, 100 - (now - this.t0) / limit * 100) + '%';
      if (now - this.t0 > limit) this.end(false);
    }, 50);
  },
  need() { return { mash: 8, swat: 3, fold: 4, sandwich: 4, hold: 1 }[this.type]; },
  hit() {
    if (!this.on) return;
    this.n++;
    const p = $('mg-p'); if (p && this.type === 'mash') p.style.width = (this.n / this.need() * 100) + '%';
    if (this.n >= this.need()) this.end(true);
  },
  // manette / clavier : un appui = une action réussie
  pad() { if (!this.on) return; if (this.type === 'hold') { this.held = (this.held || 0) + 0.5; if (this.held >= 2) this.end(true); } else this.hit(); },
  moveBee() { const b = $('mg-bee'); if (b) { b.style.left = (8 + Math.random() * 78) + '%'; b.style.top = (8 + Math.random() * 70) + '%'; } },
  shake() { const b = $('mini'); b.classList.remove('err'); void b.offsetWidth; b.classList.add('err'); },
  end(win) {
    clearInterval(this.iv); this.on = false;
    $('mini').className = win ? 'win' : 'lose';
    setTimeout(() => { if (!this.on) $('mini').className = ''; }, 500);
    (win ? this.ok : this.fail)?.();
  },
};
