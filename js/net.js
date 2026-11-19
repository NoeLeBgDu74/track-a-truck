// Multijoueur pair-à-pair (PeerJS, comme 2X2) : pas de serveur à lancer.
// Le créateur de la partie est l'hôte : il reçoit et relaie tous les messages. Code à 4 caractères + lien d'invitation.
// Radio CB vocale (micro) entre joueurs : V pour parler (ou micro ouvert).
export const QUICK_CHAT = ['Je suis en position !', 'Besoin de renfort !', 'Barrage devant !', 'Il prend la sortie !', 'Bien joué !', 'On y va !'];
const ID_PREFIX = 'trackatruck-v1-';
const ICE = { iceServers: [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:global.stun.twilio.com:3478' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
] };
const genCode = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.random() * 32 | 0]).join('');

export class Net {
  constructor() {
    this.peer = null; this.host = false; this.code = null; this.id = null; this.connected = false;
    this.conns = new Map(); this.conn = null; this.players = new Map(); this.handlers = {}; this.sendT = 0;
    this.me = { name: 'Joueur', team: 'truck', vehicle: 'semi' };
    this.calls = new Map(); this.stream = null; this.open = false; this.ptt = false;
  }
  get room() { return this.connected || (this.host && this.peer) ? { code: this.code } : null; }
  get available() { return !!window.Peer; }
  on(ev, fn) { (this.handlers[ev] ||= []).push(fn); }
  emit(ev, d) { (this.handlers[ev] || []).forEach(f => { try { f(d); } catch (e) { console.error(e); } }); }
  roster() { return [{ id: this.id, ...this.me, host: this.host }, ...[...this.players.values()].map(p => ({ id: p.id, name: p.name, team: p.team, vehicle: p.vehicle, host: p.host }))]; }

  hostGame(name) {
    if (!this.available) return Promise.reject(new Error('PeerJS indisponible'));
    this.leave(); this.me.name = name; this.host = true; this.code = genCode(); this.id = ID_PREFIX + this.code;
    return new Promise((res, rej) => {
      this.peer = new Peer(this.id, { debug: 0, config: ICE });
      this.peer.on('open', () => { this.emit('room'); res(this.code); });
      this.peer.on('connection', c => {
        c.on('open', () => {
          if (this.conns.size >= 7) { try { c.send({ t: 'full' }); } catch (e) { } setTimeout(() => c.close(), 300); return; }
          this.conns.set(c.peer, c); this.connected = true;
        });
        c.on('data', m => { if (!m || !m.t) return; m.from = c.peer; if (m.t === 'ping') { this.sendTo(c.peer, { t: 'pong', ts: m.ts }); return; } this.onMsg(m); if (m.t !== 'input' && m.t !== 'act') this.relay(m, c.peer); });
        c.on('close', () => this.drop(c.peer)); c.on('error', () => this.drop(c.peer));
      });
      this.peer.on('call', c => this.onCall(c));
      this.peer.on('error', e => { if (e.type === 'unavailable-id') { this.peer.destroy(); this.hostGame(name).then(res, rej); } else this.emit('error', { msg: 'Réseau : ' + (e.type || 'erreur') }); });
    });
  }
  joinGame(code, name) {
    if (!this.available) return Promise.reject(new Error('PeerJS indisponible'));
    this.leave(); this.me.name = name; this.host = false; this.code = code.toUpperCase().trim();
    return new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('partie introuvable')), 12000);
      this.peer = new Peer({ debug: 0, config: ICE });
      this.peer.on('open', id => {
        this.id = id;
        const c = this.peer.connect(ID_PREFIX + this.code, { reliable: true }); this.conn = c;
        c.on('open', () => { clearTimeout(to); this.connected = true; this.send({ t: 'hello', ...this.me }); res(); this.emit('room'); clearInterval(this.pingIv); this.pingIv = setInterval(() => this.send({ t: 'ping', ts: performance.now() }), 2000); });
        c.on('data', m => { if (m && m.t) this.onMsg(m); });
        c.on('close', () => { this.emit('error', { msg: '📴 La partie est terminée (le créateur est parti)' }); this.reset(); this.emit('close'); });
      });
      this.peer.on('call', c => this.onCall(c));
      this.peer.on('error', e => { clearTimeout(to); rej(new Error(e.type === 'peer-unavailable' ? 'partie introuvable, vérifie le code' : (e.type || 'erreur'))); });
    });
  }
  onMsg(m) {
    switch (m.t) {
      case 'hello': {
        const id = m.from || m.id; if (!id || id === this.id) break;
        const isNew = !this.players.has(id);
        this.players.set(id, Object.assign(this.players.get(id) || { id }, { name: m.name, team: m.team, vehicle: m.vehicle, host: !!m.host }));
        if (this.host && isNew) { this.sendTo(id, { t: 'roster', list: this.roster() }); this.send({ t: 'roster', list: this.roster() }); }
        if (isNew) this.voiceSync();
        this.emit('room'); if (isNew) this.emit('joined', this.players.get(id));
        break;
      }
      case 'roster':
        for (const p of m.list) if (p.id !== this.id) this.players.set(p.id, Object.assign(this.players.get(p.id) || {}, p));
        this.voiceSync(); this.emit('room'); break;
      case 'leave': this.drop(m.id, true); break;
      case 'pong': this.ping = Math.round(performance.now() - m.ts); break;
      case 'talk': { const p = this.players.get(m.from); (this.talkers ||= new Set()); if (p) { if (m.on) this.talkers.add(p.name); else this.talkers.delete(p.name); } break; }
      case 'full': this.emit('error', { msg: '🚫 Partie pleine' }); break;
      case 'state': { const p = this.players.get(m.from); if (p) { p.state = m.s; p.at = performance.now(); } break; }
      case 'S': for (const [id, s] of Object.entries(m.a || {})) { if (id === this.id) continue; const p = this.players.get(id); if (p) { p.state = s; p.at = performance.now(); } } break;
    }
    this.emit(m.t, m);
  }
  send(o) {
    if (!this.peer) return;
    if (this.host) { o.from = this.id; for (const c of this.conns.values()) if (c.open) try { c.send(o); } catch (e) { } }
    else if (this.conn?.open) try { this.conn.send(o); } catch (e) { }
  }
  sendTo(id, o) { const c = this.conns.get(id); if (c?.open) try { o.from = this.id; c.send(o); } catch (e) { } }
  relay(m, except) { for (const [id, c] of this.conns) if (id !== except && c.open) try { c.send(m); } catch (e) { } }
  drop(id, silent) {
    const p = this.players.get(id); if (this.host) this.conns.delete(id);
    this.endCall(id);
    if (p) { this.players.delete(id); this.emit('left', { id, name: p.name }); }
    if (this.host && !silent) this.send({ t: 'leave', id });
    if (this.host) this.connected = this.conns.size > 0;
    this.emit('room');
  }
  setTeam(team, vehicle) { Object.assign(this.me, { team, vehicle }); this.send({ t: 'hello', ...this.me, host: this.host }); this.emit('room'); }
  chat(i) { this.send({ t: 'chat', i, name: this.me.name }); this.emit('chat', { i, name: this.me.name }); }
  start(cfg) { if (this.host) { const m = { t: 'start', ...cfg, seed: Math.random() * 1e6 | 0, at: Date.now() + 2500 }; this.send(m); this.emit('start', m); } }
  tick(dt, v, extra) {
    if (!this.connected || !v) return;
    this.sendT -= dt; if (this.sendT > 0) return; this.sendT = 1 / 15;
    const p = v.curPos, q = v.curQuat, l = v.lastV;
    const s = { p: [p.x, p.y, p.z].map(x => +x.toFixed(2)), q: [q.x, q.y, q.z, q.w].map(x => +x.toFixed(4)), v: [l.x, l.y, l.z].map(x => +x.toFixed(2)), id: v.id, sir: v.siren ? 1 : 0, hl: v.headlights ? 1 : 0, dmg: Math.round(v.damage), st: +v.steer.toFixed(2), name: this.me.name, team: this.me.team };
    if (v.trailer) { const tp = v.trailer.curPos, tq = v.trailer.curQuat; s.tp = [tp.x, tp.y, tp.z].map(x => +x.toFixed(2)); s.tq = [tq.x, tq.y, tq.z, tq.w].map(x => +x.toFixed(4)); }
    if (extra) Object.assign(s, extra);
    if (this.host) this.send({ t: 'S', a: { [this.id]: s } }); else this.send({ t: 'state', s });
  }

  // ----- radio CB vocale -----
  async enableVoice() {
    if (this.stream) return true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      this.applyMic(); this.voiceSync(); return true;
    } catch (e) { this.emit('error', { msg: '🎙️ Micro refusé : autorise le micro dans la barre d’adresse' }); return false; }
  }
  analyser(stream) {
    try { this.ac ||= new (window.AudioContext || window.webkitAudioContext)(); const a = this.ac.createAnalyser(); a.fftSize = 512; this.ac.createMediaStreamSource(stream).connect(a); return a; } catch (e) { return null; }
  }
  level(a) {
    if (!a) return 0; const d = this._buf ||= new Uint8Array(512); a.getByteTimeDomainData(d);
    let s = 0; for (let i = 0; i < d.length; i++) { const v = (d[i] - 128) / 128; s += v * v; } return Math.min(1, Math.sqrt(s / d.length) * 6);
  }
  myLevel() { return this.stream && (this.open || this.ptt) ? this.level(this.meA ||= this.analyser(this.stream)) : 0; }
  peerLevel(id) { const c = this.calls.get(id); return c?.an ? this.level(c.an) : 0; }
  applyMic() { const on = !!(this.stream && (this.open || this.ptt)); if (this.stream) this.stream.getAudioTracks().forEach(t => t.enabled = on); if (this.talking !== on) { this.talking = on; this.send({ t: 'talk', on }); this.emit('talking', on); } }
  setPTT(on) { if (this.ptt === on) return; this.ptt = on; this.applyMic(); }
  voiceSync() {
    if (!this.peer || !this.stream) return;
    for (const id of this.players.keys()) if (!this.calls.has(id) && this.id < id) { try { const c = this.peer.call(id, this.stream); if (c) this.attachCall(id, c); } catch (e) { } }
  }
  onCall(call) { call.answer(this.stream || undefined); this.attachCall(call.peer, call); }
  attachCall(id, call) {
    const old = this.calls.get(id); if (old && old.call !== call) try { old.call.close(); } catch (e) { }
    const v = { call, audio: null }; this.calls.set(id, v);
    call.on('stream', s => { v.an = this.analyser(s); this.ac?.resume?.(); v.audio = document.createElement('audio'); v.audio.autoplay = true; v.audio.setAttribute('playsinline', ''); v.audio.style.display = 'none'; document.body.appendChild(v.audio); v.audio.srcObject = s; v.audio.play().catch(() => { }); });
    const gone = () => { if (this.calls.get(id) === v) { v.audio?.remove(); this.calls.delete(id); } };
    call.on('close', gone); call.on('error', gone);
  }
  endCall(id) { const v = this.calls.get(id); if (!v) return; this.calls.delete(id); try { v.call.close(); } catch (e) { } v.audio?.remove(); }

  reset() { clearInterval(this.pingIv); this.ping = null; this.talkers = new Set(); this.connected = false; this.conn = null; this.conns.clear(); for (const id of [...this.calls.keys()]) this.endCall(id); this.players.clear(); this.host = false; this.code = null; }
  leave() { if (this.peer) { try { this.peer.destroy(); } catch (e) { } } this.peer = null; this.reset(); this.emit('room'); }
}
