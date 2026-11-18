// Serveur relais multijoueur TRACK A TRUCK (Node 18+).
// Installation :  cd server && npm install ws && node server.js   (port 8787)
// Rôle : salons (code à 4 lettres), équipes camion/police, relais des états véhicules (15 Hz), chat rapide.
// Le serveur ne simule aucun joueur.
const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 8787;
const wss = new WebSocketServer({ port: PORT });
const rooms = new Map();
let nextId = 1;
const code = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.random() * 24 | 0]).join('');
const pub = r => ({ code: r.code, name: r.name, started: r.started, players: [...r.players.values()].map(p => ({ id: p.id, name: p.name, team: p.team, vehicle: p.vehicle, host: p.id === r.host })) });
const send = (ws, o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
const bcast = (r, o, except) => { for (const p of r.players.values()) if (p.ws !== except) send(p.ws, o); };

wss.on('connection', ws => {
  const me = { id: nextId++, name: 'Joueur', team: 'truck', vehicle: 'semi', ws, room: null };
  send(ws, { t: 'welcome', id: me.id });
  const leave = () => {
    const r = me.room; if (!r) return;
    r.players.delete(me.id); me.room = null;
    if (!r.players.size) rooms.delete(r.code);
    else { if (r.host === me.id) r.host = r.players.keys().next().value; bcast(r, { t: 'left', id: me.id }); bcast(r, { t: 'room', room: pub(r) }); }
  };
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    const r = me.room;
    switch (m.t) {
      case 'hello': me.name = String(m.name || 'Joueur').slice(0, 20); break;
      case 'list': send(ws, { t: 'rooms', rooms: [...rooms.values()].filter(x => !x.started).map(pub) }); break;
      case 'create': { leave(); const c = code(); const nr = { code: c, name: String(m.name || 'Partie').slice(0, 30), host: me.id, players: new Map(), started: false, seed: Math.random() * 1e6 | 0 }; rooms.set(c, nr); nr.players.set(me.id, me); me.room = nr; send(ws, { t: 'room', room: pub(nr) }); break; }
      case 'join': { const nr = rooms.get(String(m.code || '').toUpperCase()); if (!nr) { send(ws, { t: 'error', msg: 'Salon introuvable' }); break; } leave(); nr.players.set(me.id, me); me.room = nr; bcast(nr, { t: 'room', room: pub(nr) }); break; }
      case 'team': if (r) { me.team = m.team === 'police' ? 'police' : 'truck'; me.vehicle = String(m.vehicle || ''); bcast(r, { t: 'room', room: pub(r) }); } break;
      case 'start': if (r && r.host === me.id) { r.started = true; bcast(r, { t: 'start', seed: r.seed, at: Date.now() + 3000 }); } break;
      case 'state': if (r) bcast(r, { t: 'state', id: me.id, s: m.s }, ws); break;
      case 'chat': if (r) bcast(r, { t: 'chat', id: me.id, name: me.name, i: m.i | 0 }); break;
      case 'event': if (r) bcast(r, { t: 'event', id: me.id, e: m.e }); break;
    }
  });
  ws.on('close', leave);
});
console.log('TRACK A TRUCK — serveur multijoueur sur ws://localhost:' + PORT);
