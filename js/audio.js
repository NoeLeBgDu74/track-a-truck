// Audio procédural (Web Audio) : moteurs, sirènes 3D, klaxons, chocs, pluie, vent, trafic, réverbération tunnel
import { clamp, settings } from './config.js';

export class Audio {
  constructor() { this.ctx = null; this.sirens = new Map(); }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const C = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = C.createGain(); this.master.gain.value = settings.volume; this.master.connect(C.destination);
    this.dry = C.createGain(); this.dry.connect(this.master);
    // réverbération (tunnel)
    this.conv = C.createConvolver(); this.conv.buffer = this.impulse(2.6, 2.2);
    this.wet = C.createGain(); this.wet.gain.value = 0; this.conv.connect(this.wet); this.wet.connect(this.master);
    this.bus = C.createGain(); this.bus.connect(this.dry); this.bus.connect(this.conv);
    this.noiseBuf = this.makeNoise(2, 'white'); this.brownBuf = this.makeNoise(3, 'brown');
    // moteur joueur
    this.eng = this.makeEngine();
    // ambiances
    this.rainN = this.loopNoise(this.noiseBuf, 'highpass', 1200, 0);
    this.windN = this.loopNoise(this.noiseBuf, 'bandpass', 700, 0);
    this.trafN = this.loopNoise(this.brownBuf, 'lowpass', 500, 0);
    this.roadN = this.loopNoise(this.brownBuf, 'lowpass', 300, 0);
    this.squeal = this.loopNoise(this.noiseBuf, 'bandpass', 2200, 0, 9);
    // klaxon joueur
    this.hornG = C.createGain(); this.hornG.gain.value = 0; this.hornG.connect(this.bus);
    this.hornOsc = [370, 466].map(f => { const o = C.createOscillator(); o.type = 'square'; o.frequency.value = f; const lp = C.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800; o.connect(lp); lp.connect(this.hornG); o.start(); return o; });
  }

  setVolume(v) { if (this.master) this.master.gain.value = v; }

  impulse(sec, decay) {
    const C = this.ctx, len = C.sampleRate * sec, b = C.createBuffer(2, len, C.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
    return b;
  }
  makeNoise(sec, kind) {
    const C = this.ctx, len = C.sampleRate * sec, b = C.createBuffer(1, len, C.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
    return b;
  }
  loopNoise(buf, type, freq, gain, q = 0.8) {
    const C = this.ctx, src = C.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = C.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = C.createGain(); g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(this.bus); src.start();
    return { g, f };
  }
  makeEngine() {
    const C = this.ctx;
    const out = C.createGain(); out.gain.value = 0; out.connect(this.bus);
    const lp = C.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 2; lp.connect(out);
    const o1 = C.createOscillator(); o1.type = 'sawtooth';
    const o2 = C.createOscillator(); o2.type = 'square';
    const o3 = C.createOscillator(); o3.type = 'triangle';
    const g1 = C.createGain(); g1.gain.value = 0.5; const g2 = C.createGain(); g2.gain.value = 0.25; const g3 = C.createGain(); g3.gain.value = 0.4;
    o1.connect(g1); o2.connect(g2); o3.connect(g3); g1.connect(lp); g2.connect(lp); g3.connect(lp);
    const ns = C.createBufferSource(); ns.buffer = this.noiseBuf; ns.loop = true;
    const nf = C.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 400; nf.Q.value = 1.5;
    const ng = C.createGain(); ng.gain.value = 0.15; ns.connect(nf); nf.connect(ng); ng.connect(lp);
    for (const o of [o1, o2, o3, ns]) o.start();
    return { out, lp, o1, o2, o3, nf, ng };
  }

  updatePlayer(v, dt, ctx) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, e = this.eng;
    if (!v) { e.out.gain.setTargetAtTime(0, t, 0.1); this.roadN.g.gain.setTargetAtTime(0, t, 0.2); this.windN.g.gain.setTargetAtTime(0, t, 0.2); this.squeal.g.gain.setTargetAtTime(0, t, 0.05); }
    else {
      const diesel = v.def.engine === 'diesel', cyl = diesel ? 6 : (v.def.engine === 'v8' ? 8 : 6);
      const f = Math.max(10, v.rpm / 60 * cyl / 2) * (diesel ? 0.55 : 1);
      e.o1.frequency.setTargetAtTime(f, t, 0.03); e.o2.frequency.setTargetAtTime(f * 0.5, t, 0.03); e.o3.frequency.setTargetAtTime(f * 2.01, t, 0.03);
      e.nf.frequency.setTargetAtTime(diesel ? 260 + v.rpm * 0.15 : 500 + v.rpm * 0.25, t, 0.05);
      e.lp.frequency.setTargetAtTime((diesel ? 300 : 500) + v.thr * (diesel ? 900 : 2600) + v.rpm * 0.1, t, 0.05);
      const cockpit = ctx.cockpit ? 0.75 : 1;
      e.out.gain.setTargetAtTime(v.disabled ? 0 : (0.09 + v.thr * 0.14) * cockpit * (diesel ? 1.3 : 1), t, 0.05);
      const sp = Math.abs(v.speed);
      this.roadN.g.gain.setTargetAtTime(clamp(sp / 40) * 0.35 * (1 + ctx.wet), t, 0.2);
      this.roadN.f.frequency.setTargetAtTime(200 + sp * 8 + ctx.wet * 600, t, 0.2);
      this.windN.g.gain.setTargetAtTime(clamp(sp / 55) ** 2 * (ctx.cockpit ? 0.12 : 0.3), t, 0.2);
      this.windN.f.frequency.setTargetAtTime(400 + sp * 15, t, 0.2);
      this.squeal.g.gain.setTargetAtTime(ctx.wet > 0.5 ? 0 : clamp(v.slip) * 0.22, t, 0.05);
      if (this.hornOsc && this.hornKind !== v.def.team) { this.hornKind = v.def.team; const fr = v.def.team === 'truck' ? [185, 233] : [370, 466]; this.hornOsc.forEach((o, i) => o.frequency.setValueAtTime(fr[i], t)); } // klaxon à air grave pour les poids lourds
      this.hornG.gain.setTargetAtTime(v.horn ? 0.16 : 0, t, 0.02);
    }
    this.rainN.g.gain.setTargetAtTime(ctx.rain * (ctx.cockpit ? 0.35 : 0.22) * (1 - ctx.tunnel), t, 0.4);
    this.trafN.g.gain.setTargetAtTime(clamp(ctx.trafficNear / 12) * 0.25 + 0.02, t, 0.5);
    this.wet.gain.setTargetAtTime(ctx.tunnel * 0.9, t, 0.3);
    this.dry.gain.setTargetAtTime(1 - ctx.tunnel * 0.3, t, 0.3);
  }

  // listener + sirènes positionnelles
  setListener(pos, fwd) {
    if (!this.ctx) return;
    const L = this.ctx.listener, t = this.ctx.currentTime;
    if (L.positionX) { L.positionX.setValueAtTime(pos.x, t); L.positionY.setValueAtTime(pos.y, t); L.positionZ.setValueAtTime(pos.z, t); L.forwardX.setValueAtTime(fwd.x, t); L.forwardY.setValueAtTime(fwd.y, t); L.forwardZ.setValueAtTime(fwd.z, t); L.upX.setValueAtTime(0, t); L.upY.setValueAtTime(1, t); L.upZ.setValueAtTime(0, t); }
    else { L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0); }
  }
  updateSiren(veh, on, local) {
    if (!this.ctx) return;
    let s = this.sirens.get(veh);
    if (!on) { if (s) { s.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1); } return; }
    const C = this.ctx;
    if (!s) {
      // sirène « deux-tons » à la française : pin-pon (SAMU/pompiers 435/488 Hz, gendarmerie/police 440/585 Hz)
      const pin = !!veh.pinpon, o = C.createOscillator(); o.type = 'square';
      const lfo = C.createOscillator(); lfo.type = 'square'; lfo.frequency.value = pin ? 0.78 : 0.95; const lg = C.createGain(); lg.gain.value = pin ? 26.5 : 72; lfo.connect(lg); lg.connect(o.frequency);
      o.frequency.value = pin ? 461.5 : 512;
      const f = C.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = pin ? 950 : 1050; f.Q.value = 0.45;
      const g = C.createGain(); g.gain.value = 0;
      const p = C.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 12; p.rolloffFactor = 1.1;
      o.connect(f); f.connect(g); g.connect(p); p.connect(this.bus); o.start(); lfo.start();
      s = { o, lfo, g, p, lg }; this.sirens.set(veh, s);
    }
    const t = C.currentTime, pos = veh.pos;
    if (s.p.positionX) { s.p.positionX.setValueAtTime(pos.x, t); s.p.positionY.setValueAtTime(pos.y + 1.5, t); s.p.positionZ.setValueAtTime(pos.z, t); } else s.p.setPosition(pos.x, pos.y, pos.z);
    s.g.gain.setTargetAtTime(local ? 0.09 : 0.22, t, 0.1);
    // « yelp » rapide quand la voiture est au contact du suspect, « wail » lent sinon
    const yelp = !!veh.yelp && !veh.pinpon; if (s.yelp !== yelp) { s.yelp = yelp; s.lfo.frequency.setTargetAtTime(yelp ? 2.4 : 0.95, t, 0.2); }
  }
  stopAllSirens() { for (const [k, s] of this.sirens) { s.g.gain.value = 0; try { s.o.stop(); s.lfo.stop(); } catch (e) { } } this.sirens.clear(); }

  oneShot(pos, build, dur) {
    const C = this.ctx; if (!C) return;
    const p = C.createPanner(); p.panningModel = 'HRTF'; p.refDistance = 8; p.rolloffFactor = 1.2;
    const t = C.currentTime;
    if (pos) { if (p.positionX) { p.positionX.setValueAtTime(pos.x, t); p.positionY.setValueAtTime(pos.y || 1, t); p.positionZ.setValueAtTime(pos.z, t); } else p.setPosition(pos.x, pos.y || 1, pos.z); p.connect(this.bus); }
    const dest = pos ? p : this.bus;
    build(C, dest, t);
  }
  crash(pos, strength) {
    this.oneShot(pos, (C, dest, t) => {
      const s = C.createBufferSource(); s.buffer = this.noiseBuf;
      const f = C.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900 + strength * 200;
      const g = C.createGain(); g.gain.setValueAtTime(clamp(strength / 8) * 0.9 + 0.1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      s.connect(f); f.connect(g); g.connect(dest); s.start(t, Math.random()); s.stop(t + 0.7);
      const o = C.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(180 + Math.random() * 300, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.4);
      const og = C.createGain(); og.gain.setValueAtTime(0.25 * clamp(strength / 6), t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      o.connect(og); og.connect(dest); o.start(t); o.stop(t + 0.5);
      // tintement métallique
      const m = C.createOscillator(); m.type = 'square'; m.frequency.value = 1200 + Math.random() * 1500;
      const mf = C.createBiquadFilter(); mf.type = 'bandpass'; mf.frequency.value = 2400; mf.Q.value = 6;
      const mg = C.createGain(); mg.gain.setValueAtTime(0.05, t + 0.05); mg.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      m.connect(mf); mf.connect(mg); mg.connect(dest); m.start(t + 0.05); m.stop(t + 0.45);
    });
  }
  honkAt(pos, truck) {
    this.oneShot(pos, (C, dest, t) => {
      const g = C.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.25, t + 0.02); g.gain.setValueAtTime(0.25, t + 0.45); g.gain.linearRampToValueAtTime(0, t + 0.5);
      g.connect(dest);
      for (const f of truck ? [220, 277] : [400, 500]) { const o = C.createOscillator(); o.type = 'square'; o.frequency.value = f; const lp = C.createBiquadFilter(); lp.frequency.value = 1500; o.connect(lp); lp.connect(g); o.start(t); o.stop(t + 0.55); }
    });
  }
  thunder(delay) {
    this.oneShot(null, (C, dest, t) => {
      const s = C.createBufferSource(); s.buffer = this.brownBuf;
      const g = C.createGain(); g.gain.setValueAtTime(0, t + delay); g.gain.linearRampToValueAtTime(0.9, t + delay + 0.1); g.gain.exponentialRampToValueAtTime(0.001, t + delay + 3.5);
      s.connect(g); g.connect(dest); s.start(t + delay); s.stop(t + delay + 3.6);
    });
  }
  beep(f = 880, d = 0.12, vol = 0.15) {
    this.oneShot(null, (C, dest, t) => {
      const o = C.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = C.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
      o.connect(g); g.connect(dest); o.start(t); o.stop(t + d + 0.02);
    });
  }
  radio() { this.oneShot(null, (C, dest, t) => { const s = C.createBufferSource(); s.buffer = this.noiseBuf; const f = C.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2000; const g = C.createGain(); g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25); s.connect(f); f.connect(g); g.connect(dest); s.start(t, Math.random()); s.stop(t + 0.3); }); this.beep(1400, 0.08, 0.06); }

  // ----- sons du mode coop -----
  voiceBlip(freqs, dur, type = 'sawtooth', vol = 0.12, q = 3) {
    this.oneShot(null, (C, dest, t) => {
      const o = C.createOscillator(); o.type = type;
      freqs.forEach((f, i) => o.frequency.setValueAtTime(f, t + i * dur / freqs.length));
      const bp = C.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = q;
      const g = C.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(bp); bp.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
    });
  }
  snore() {
    this.oneShot(null, (C, dest, t) => {
      const s = C.createBufferSource(); s.buffer = this.brownBuf; const f = C.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
      const lfo = C.createOscillator(); lfo.frequency.value = 28; const lg = C.createGain(); lg.gain.value = 0.15; lfo.connect(lg);
      const g = C.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 0.7); g.gain.linearRampToValueAtTime(0, t + 1.3);
      lg.connect(g.gain); s.connect(f); f.connect(g); g.connect(dest); s.start(t); s.stop(t + 1.4); lfo.start(t); lfo.stop(t + 1.4);
    });
  }
  hic() { this.voiceBlip([420, 900], 0.18, 'square', 0.16, 2); }
  sneeze() { this.voiceBlip([300, 380, 460, 520], 0.6, 'sawtooth', 0.1, 2); setTimeout(() => this.oneShot(null, (C, dest, t) => { const s = C.createBufferSource(); s.buffer = this.noiseBuf; const f = C.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1500; const g = C.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35); s.connect(f); f.connect(g); g.connect(dest); s.start(t); s.stop(t + 0.4); }), 600); }
  slap() { this.oneShot(null, (C, dest, t) => { const s = C.createBufferSource(); s.buffer = this.noiseBuf; const f = C.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2500; f.Q.value = 0.8; const g = C.createGain(); g.gain.setValueAtTime(0.7, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12); s.connect(f); f.connect(g); g.connect(dest); s.start(t, Math.random()); s.stop(t + 0.15); }); }
  sing() { const notes = [262, 330, 392, 349, 311, 262, 233, 262]; notes.forEach((n, i) => setTimeout(() => this.voiceBlip([n * (1 + (Math.random() - 0.5) * 0.08)], 0.38, 'sawtooth', 0.09, 4), i * 380)); }
  buzz(on) {
    if (!this.ctx) return;
    if (on && !this._buzz) { const C = this.ctx, o = C.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 210; const l = C.createOscillator(); l.frequency.value = 9; const lg = C.createGain(); lg.gain.value = 40; l.connect(lg); lg.connect(o.frequency); const f = C.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 600; const g = C.createGain(); g.gain.value = 0.06; o.connect(f); f.connect(g); g.connect(this.bus); o.start(); l.start(); this._buzz = { o, l, g }; }
    if (!on && this._buzz) { try { this._buzz.o.stop(); this._buzz.l.stop(); } catch (e) { } this._buzz = null; }
  }
  // radio de la cabine : petites boucles synthétisées
  music(id) {
    if (!this.ctx) return;
    clearInterval(this._mus); this._mus = null; this.musStep = 0;
    if (!id || id === 'off') return;
    const C = this.ctx, bpm = id === 'techno' ? 132 : id === 'musette' ? 150 : 76, step = 60 / bpm / (id === 'musette' ? 1 : 2);
    const mel = { berceuse: [523, 0, 440, 0, 392, 0, 440, 0, 523, 523, 587, 0, 523, 0, 0, 0], musette: [392, 494, 587, 392, 494, 587, 440, 523, 659, 440, 523, 659, 392, 494, 587, 587] }[id];
    const tone = (f, d, type, vol, at) => { const o = C.createOscillator(); o.type = type; o.frequency.value = f; const g = C.createGain(); g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.0001, at + d); o.connect(g); g.connect(this.bus); o.start(at); o.stop(at + d + 0.02); };
    this._mus = setInterval(() => {
      const t = C.currentTime + 0.05, i = this.musStep++ % 16;
      if (id === 'techno') {
        if (i % 4 === 0) { const o = C.createOscillator(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15); const g = C.createGain(); g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2); o.connect(g); g.connect(this.bus); o.start(t); o.stop(t + 0.22); }
        if (i % 4 === 2) { const s = C.createBufferSource(); s.buffer = this.noiseBuf; const f = C.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000; const g = C.createGain(); g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05); s.connect(f); f.connect(g); g.connect(this.bus); s.start(t, Math.random()); s.stop(t + 0.06); }
        tone([55, 55, 65, 49][Math.floor(i / 4)] * (i % 2 ? 2 : 1), 0.12, 'sawtooth', 0.06, t);
      } else { const f = mel[i]; if (f) tone(f, step * (id === 'berceuse' ? 1.8 : 0.9), id === 'berceuse' ? 'sine' : 'square', id === 'berceuse' ? 0.07 : 0.035, t); if (id === 'musette' && i % 3 === 0) tone(98, 0.2, 'triangle', 0.08, t); }
    }, step * 1000);
  }

  // rotor d'hélicoptère (battement grave) — gain selon la distance
  rotor(g) {
    if (!this.ctx) return;
    if (!this._rot) {
      const C = this.ctx, s = C.createBufferSource(); s.buffer = this.brownBuf; s.loop = true;
      const f = C.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260;
      const am = C.createGain(); am.gain.value = 0.5; const lfo = C.createOscillator(); lfo.frequency.value = 17; const lg = C.createGain(); lg.gain.value = 0.5; lfo.connect(lg); lg.connect(am.gain);
      const out = C.createGain(); out.gain.value = 0; s.connect(f); f.connect(am); am.connect(out); out.connect(this.bus); s.start(); lfo.start();
      this._rot = out;
    }
    this._rot.gain.setTargetAtTime(g, this.ctx.currentTime, 0.2);
  }
  // frein à air du poids lourd (pschhh) et bip de recul
  airBrake(pos) { this.oneShot(pos, (C, dest, t) => { const s = C.createBufferSource(); s.buffer = this.noiseBuf; const f = C.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(1400, t + 0.8); f.Q.value = 0.6; const g = C.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32, t + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9); s.connect(f); f.connect(g); g.connect(dest); s.start(t, Math.random()); s.stop(t + 1); }); }
  backup(pos) { this.oneShot(pos, (C, dest, t) => { const o = C.createOscillator(); o.type = 'sine'; o.frequency.value = 1180; const g = C.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.02); g.gain.setValueAtTime(0.12, t + 0.36); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42); o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.45); }); }
  hiss() { this.oneShot(null, (C, dest, t) => { const s = C.createBufferSource(); s.buffer = this.noiseBuf; const f = C.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2500; const g = C.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9); s.connect(f); f.connect(g); g.connect(dest); s.start(t, Math.random()); s.stop(t + 1); }); }
  tick() { this.oneShot(null, (C, dest, t) => { const o = C.createOscillator(); o.type = 'square'; o.frequency.value = 1800; const g = C.createGain(); g.gain.setValueAtTime(0.03, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03); o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.04); }); }
  thud(pos) { this.oneShot(pos, (C, dest, t) => { const o = C.createOscillator(); o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.2); const g = C.createGain(); g.gain.setValueAtTime(0.4, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25); o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.3); }); }
}
