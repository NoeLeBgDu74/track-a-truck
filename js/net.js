// Client multijoueur WebSocket (architecture prête : salons, équipes, synchro des véhicules, chat rapide).
// Fonctionne avec server/server.js (Node + ws). Aucun faux joueur : sans serveur, rien n'est affiché.
export const QUICK_CHAT = ['Je suis en position !', 'Besoin de renfort !', 'Barrage devant !', 'Il prend la sortie !', 'Bien joué !', 'On y va !'];

export class Net {
  constructor() { this.ws = null; this.connected = false; this.id = null; this.room = null; this.players = new Map(); this.handlers = {}; this.sendT = 0; }
  on(ev, fn) { (this.handlers[ev] ||= []).push(fn); }
  emit(ev, data) { (this.handlers[ev] || []).forEach(f => f(data)); }

  connect(url, name) {
    return new Promise((res, rej) => {
      try { this.ws = new WebSocket(url); } catch (e) { rej(e); return; }
      const to = setTimeout(() => { rej(new Error('délai dépassé')); try { this.ws.close(); } catch (e) { } }, 4000);
      this.ws.onopen = () => { clearTimeout(to); this.connected = true; this.send({ t: 'hello', name }); res(); };
      this.ws.onerror = () => { clearTimeout(to); rej(new Error('connexion impossible')); };
      this.ws.onclose = () => { this.connected = false; this.room = null; this.players.clear(); this.emit('close'); };
      this.ws.onmessage = e => {
        let m; try { m = JSON.parse(e.data); } catch (x) { return; }
        if (m.t === 'welcome') this.id = m.id;
        if (m.t === 'room') { this.room = m.room; this.players = new Map(m.room.players.map(p => [p.id, p])); }
        if (m.t === 'state' && this.players.has(m.id)) Object.assign(this.players.get(m.id), { state: m.s, at: performance.now() });
        if (m.t === 'left') this.players.delete(m.id);
        this.emit(m.t, m);
      };
    });
  }
  send(o) { if (this.connected) this.ws.send(JSON.stringify(o)); }
  createRoom(name) { this.send({ t: 'create', name }); }
  joinRoom(code) { this.send({ t: 'join', code }); }
  listRooms() { this.send({ t: 'list' }); }
  setTeam(team, vehicle) { this.send({ t: 'team', team, vehicle }); }
  chat(i) { this.send({ t: 'chat', i }); }
  start() { this.send({ t: 'start' }); }
  // synchro 15 Hz de la position/rotation/vitesse du véhicule local
  tick(dt, v) {
    if (!this.connected || !this.room || !v) return;
    this.sendT -= dt; if (this.sendT > 0) return; this.sendT = 1 / 15;
    const p = v.curPos, q = v.curQuat, l = v.lastV;
    const s = { p: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)], q: [q.x, q.y, q.z, q.w].map(x => +x.toFixed(4)), v: [+l.x.toFixed(2), +l.y.toFixed(2), +l.z.toFixed(2)], id: v.id, sir: v.siren ? 1 : 0, hl: v.headlights ? 1 : 0, dmg: Math.round(v.damage) };
    if (v.trailer) { const tp = v.trailer.curPos, tq = v.trailer.curQuat; s.tp = [tp.x, tp.y, tp.z].map(x => +x.toFixed(2)); s.tq = [tq.x, tq.y, tq.z, tq.w].map(x => +x.toFixed(4)); }
    this.send({ t: 'state', s });
  }
  disconnect() { if (this.ws) this.ws.close(); }
}
