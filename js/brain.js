// « Cerveau » IA (modèle de langage) des PNJ et de la police.
// Toutes les ~9 s, un « directeur » IA reçoit un résumé de la situation (conducteurs proches, poursuite,
// météo, unités de police…) et renvoie en JSON : la pensée et l'action de chaque conducteur civil,
// les ordres du chef d'opération de la police et un message radio. Les réflexes (freiner, éviter)
// restent gérés localement en temps réel ; l'IA décide des comportements et des dialogues.
// Service : Groq (si une clé est fournie dans les paramètres) sinon Pollinations (gratuit, sans clé).
import { settings, roadYaw, DEST_S, EXIT_GAP, worldToRoad } from './config.js';

const FREE = 'https://api.llm7.io/v1/chat/completions'; // gratuit sans clé (quota limité)
const RELAY = 'https://track-a-truck-ia.netlify.app/api/groq'; // relais Groq dédié au jeu (clé gardée côté serveur Netlify)
const GROQ = 'https://api.groq.com/openai/v1/chat/completions';

export const Brain = {
  busy: false, fails: 0, relayFails: 0, last: 0, ok: 0, pauseUntil: 0, status: 'en attente',
  enabled() { return settings.aiNpc !== false && performance.now() > this.pauseUntil; },
  async ask(messages, maxTokens = 500, prio) {
    if (this.busy || (!this.enabled() && !(prio && settings.aiNpc !== false))) return null;
    this.busy = true;
    const key = (settings.groqKey || '').trim();
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 20000);
    try {
      const useRelay = !key && !this.relayDown;
      const body = key ? { model: 'openai/gpt-oss-20b', messages, temperature: 0.9, max_tokens: maxTokens, response_format: { type: 'json_object' } }
        : useRelay ? { model: 'openai/gpt-oss-20b', messages, temperature: 0.9, max_tokens: Math.max(maxTokens, 450), response_format: { type: 'json_object' } }
        : { model: 'default', messages, temperature: 0.9, max_tokens: maxTokens };
      let r;
      try { r = await fetch(key ? GROQ : useRelay ? RELAY : FREE, { method: 'POST', signal: ctrl.signal, headers: key ? { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key } : useRelay ? { 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json', Authorization: 'Bearer unused' }, body: JSON.stringify(body) }); } catch (e) { if (useRelay && ++this.relayFails >= 3) { this.relayDown = true; this.status = 'relais Groq indisponible, essai du service gratuit'; setTimeout(() => { this.relayDown = false; this.relayFails = 0; }, 60000); } throw e; }
      if (r.status === 429) { this.pauseUntil = performance.now() + (useRelay ? 20000 : 120000); this.status = key ? 'quota Groq atteint, pause 2 min' : useRelay ? 'IA très sollicitée : pause 20 s' : 'service gratuit saturé'; throw new Error('429'); }
      if (r.status === 401 || r.status === 403) { this.pauseUntil = performance.now() + 600000; this.status = key ? 'clé Groq refusée' : 'service gratuit indisponible : ajoute une clé Groq'; throw new Error('auth'); }
      if (!r.ok) { if (useRelay && r.status >= 500 && ++this.relayFails >= 3) { this.relayDown = true; setTimeout(() => { this.relayDown = false; this.relayFails = 0; }, 60000); } throw new Error('HTTP ' + r.status); }
      const j = await r.json();
      const txt = j.choices?.[0]?.message?.content || '';
      const m = txt.match(/\{[\s\S]*\}/);
      const out = m ? JSON.parse(m[0]) : null;
      this.fails = 0; this.relayFails = 0; this.ok++; this.status = (key ? 'Groq (ta clé)' : useRelay ? 'Groq (relais)' : 'service gratuit') + ' : ' + this.ok + ' réponses';
      return out;
    } catch (e) { this.fails++; if (this.fails >= 4 && this.pauseUntil < performance.now()) { this.pauseUntil = performance.now() + 90000; this.status = this.status || 'injoignable'; } return null; }
    finally { clearTimeout(to); this.busy = false; }
  },
};

const CIV_ACTIONS = ['continuer', 'ralentir', 'se_rabattre', 'paniquer', 's_enerver', 'klaxonner', 'filmer', 'appeler_police', 'suivre_le_camion', 'laisser_passer'];
const TACTICS = ['devant_freiner', 'flanc', 'derriere', 'garder_sortie', 'rester_a_distance'];

function where(car, truck) {
  const ds = (car.s - truck.road.s), side = car.dir === 1 ? 'même sens' : 'sens opposé';
  const lane = car.d77 ? 'départementale' : car.lane === 3 ? 'bande d’arrêt d’urgence' : ['voie de gauche', 'voie du milieu', 'voie de droite'][car.lane] || 'voie';
  return `${Math.abs(ds) < 8 ? 'à côté du camion' : ds > 0 ? `${Math.round(ds)} m devant le camion` : `${Math.round(-ds)} m derrière le camion`}, ${lane}, ${side}`;
}

// demande au « directeur » IA : conducteurs + police ; applique les décisions
export async function directorTick(g) {
  const truck = g.targetTruck?.(), pl = g.player;
  if (!truck || !pl || g.state !== 'play' || g.mirror || g.netTraffic) return;
  const near = g.traffic.cars.filter(c => !c.wreck && !c.broken && c.cur.distanceTo(truck.curPos) < 160).sort((a, b) => a.cur.distanceTo(truck.curPos) - b.cur.distanceTo(truck.curPos)).slice(0, 5);
  const chase = g.mode !== 'free' && g.released;
  const units = g.police.filter(p => p.ai && !p.v.disabled);
  const env = g.env;
  const sit = {
    camion: { vitesse_kmh: Math.round(truck.kmh), sur: truck.road.d < -18 ? 'hors autoroute (D77 / champs)' : truck.road.d < -12.3 ? 'bande d’arrêt d’urgence' : 'autoroute', km_restants: Math.max(0, Math.round((DEST_S - truck.road.s) / 100) / 10), degats: Math.round(truck.damage), conduite: truck.kmh > 120 ? 'très rapide et dangereuse' : truck.kmh > 90 ? 'rapide' : 'normale', joueur: g.team === 'truck' ? 'oui' : 'non' },
    poursuite: chase ? { niveau_recherche: g.wanted || 0, helico: !!g.heliOn, interpellation_pct: Math.round((g.bust || 0) * 100), sortie_18_dans_m: Math.round(EXIT_GAP[0] - truck.road.s) } : 'aucune',
    meteo: env.weather + (env.night > 0.5 ? ', nuit' : ', jour') + (env.tunnel > 0.5 ? ', dans un tunnel' : ''),
    conducteurs: near.map(c => ({ id: c.id, vehicule: c.type.kind, personnalite: c.persona, humeur: c.feel || 'normal', position: where(c, truck), vitesse_kmh: Math.round(c.v * 3.6) })),
    police: chase ? units.map(p => ({ unite: p.v.unit, nom: p.v.name, distance_m: Math.round(p.v.curPos.distanceTo(truck.curPos)), devant: p.v.road.s > truck.road.s, tactique: p.ai.tactic, degats: Math.round(p.v.damage), moto: !!p.v.def.moto })) : [],
  };
  if (!near.length && !(chase && units.length)) return;
  const sys = `Tu es le « directeur » d'un jeu de poursuite sur une autoroute française. Tu donnes vie aux conducteurs civils et à la police avec du bon sens ET de l'humour.
Réponds UNIQUEMENT en JSON : {"conducteurs":[{"id":nombre,"action":"${CIV_ACTIONS.join('|')}","pensee":"≤ 9 mots, français familier, drôle et crédible"}],"police":{"radio":"message radio réaliste de la gendarmerie, ≤ 22 mots (ou vide)","ordres":[{"unite":nombre,"tactique":"${TACTICS.join('|')}"}],"demande":"rien|renfort|barrage|herse|helico"}}
Règles : comme dans la vraie vie, un camion qui roule normalement n'intéresse personne : si la conduite du camion est « normale » et qu'il n'y a pas de poursuite, la plupart des conducteurs font « continuer » sans pensée (pensee vide), au plus un pense à sa vie (boulot, radio, enfants…) sans parler du camion. Les conducteurs ne réagissent qu'à ce qu'ils voient vraiment (un camion fou les double : panique ou colère ; la police arrive : se rabattre ; un témoin peut appeler la police ; un distrait filme). La police coordonne : une unité devant pour freiner, une sur le flanc, une derrière ; garder la sortie 18 quand le camion approche ; demander un barrage ou une herse si le camion s'échappe, un hélico si on le perd. Ne mets que les ids et unités fournis.`;
  const res = await Brain.ask([{ role: 'system', content: sys }, { role: 'user', content: JSON.stringify(sit) }]);
  if (!res || g.state !== 'play') return;
  applyDecisions(g, res, near, units, truck);
}

function applyDecisions(g, res, near, units, truck) {
  const byId = new Map(near.map(c => [c.id, c]));
  let bubbles = 0;
  for (const d of res.conducteurs || []) {
    const c = byId.get(d.id); if (!c || c.dead || c.wreck) continue;
    const a = String(d.action || '').toLowerCase();
    c.brain = { a, t: 10 };
    if (a === 'paniquer') { c.feel = 'panic'; c.feelT = 6; c.hazard = 5; }
    if (a === 's_enerver') { c.feel = 'angry'; c.feelT = 7; c.flash = 1.5; g.audio?.honkAt(c.cur, c.type.trucks); }
    if (a === 'klaxonner') g.audio?.honkAt(c.cur, c.type.trucks);
    if (a === 'appeler_police' && g.mode !== 'free' && g.team === 'truck') { g.heat = Math.min(100, (g.heat || 0) + 3); g.say?.('ia-witness', `Un automobiliste signale le camion au PK ${(truck.road.s / 1000).toFixed(1)}.`, 18); }
    if ((a === 'se_rabattre' || a === 'laisser_passer') && !c.lc && !c.d77 && c.lane < 2) c.lc = { from: c.lane, to: c.lane + 1, t: 0, dur: 3 };
    const calm = !(g.released && g.mode !== 'free') && truck.kmh < 120 && truck.damage < 40;
    if (d.pensee && bubbles < (calm ? 1 : 3) && Math.random() < (calm ? 0.6 : 0.9)) { g.bubble?.(c, (a === 'filmer' ? '📱 ' : '') + String(d.pensee).slice(0, 110)); bubbles++; }
  }
  const P = res.police; if (!P || !g.released || g.mode === 'free') return;
  const map = { devant_freiner: 'lead', flanc: 'flank', derriere: 'tail', rester_a_distance: 'tail', garder_sortie: 'guard' };
  for (const o of P.ordres || []) {
    const u = units.find(p => p.v.unit === o.unite); if (!u) continue;
    const t = map[o.tactique]; if (!t) continue;
    if (t === 'guard') { if (!g.guardSent && truck.road.s < EXIT_GAP[0] - 200) { g.guardSent = true; u.ai.role = 'guard'; } }
    else { u.ai.tactic = t; u.ai.brainT = 10; }
  }
  if (P.radio) g.radio?.('🤖 ' + String(P.radio).slice(0, 160), 'pol');
  const dm = String(P.demande || 'rien');
  if (dm === 'renfort' && units.length < (g.diff?.police || 3) + 2) { const ai = g.addPolice(truck.road.s - 400, -3, 'chase'); ai.v.setVelocityForward(40); }
  if (dm === 'barrage' && g.blockDone && !g.roadblock && truck.road.s < EXIT_GAP[0] - 1500) { g.blockDone = false; g.nextBlock = g.time; }
  if (dm === 'herse' && !g.iaSpike && truck.road.d > -16) { g.iaSpike = true; g.addSpike(truck.road.s + 350, truck.road.d, 7); }
  if (dm === 'helico' && !g.heliOn && (g.wanted || 0) >= 2) { g.heliOn = true; g.heliT = 0; g.heli.position.set(truck.curPos.x - 100, 60, truck.curPos.z - 150); g.heli.visible = true; }
}

// Gégé (copilote IA) répond vraiment à ce que dit le joueur
export async function copilotReply(g, text, speaker, other) {
  const c = g.coop; if (!c) return null;
  const pl = g.player;
  const sit = { vitesse_kmh: Math.round(pl?.kmh || 0), km_restants: pl ? Math.max(0, Math.round((DEST_S - pl.road.s) / 100) / 10) : 0, police_proche_m: pl ? Math.round(g.nearestPolice(pl.curPos).d) : null, fatigue_conducteur: Math.round(c.drv.fatigue), faim_conducteur: Math.round(c.drv.faim), carburant: Math.round(c.fuel), gag_en_cours: c.gag?.id || 'aucun', radio: ['éteinte', 'techno', 'berceuse', 'musette'][c.station], conducteur: c.drv.name };
  const sys = `Tu es ${other}, routier français bourru mais attachant, copilote dans un camion en fuite (on livre 22 tonnes de fromage, la police nous poursuit). Ton collègue ${speaker} te parle. Réponds comme un vrai pote, drôle, en français familier, 1 ou 2 phrases courtes (≤ 25 mots). Tu peux aussi agir.
Réponds UNIQUEMENT en JSON : {"reponse":"…","action":"aucune|sandwich|coffee|slap|radio|banana|cb|oil|nails|smoke|paint|cones|crackers|detour|swap","geste":"aucun|wave|thumbs|laugh|scared|dance|shrug|offended|pointL|pointR"}`;
  return Brain.ask([{ role: 'system', content: sys }, { role: 'user', content: `Situation : ${JSON.stringify(sit)}\n${speaker} dit : « ${text} »` }], 200);
}

// petite remarque spontanée du copilote IA
export async function copilotBanter(g) {
  const c = g.coop, pl = g.player; if (!c || !pl) return null;
  const sit = { vitesse_kmh: Math.round(pl.kmh), police_m: Math.round(g.nearestPolice(pl.curPos).d), meteo: g.env.weather, nuit: g.env.night > 0.5, gag: c.gag?.id || 'aucun', faim: Math.round(c.drv.faim), fatigue: Math.round(c.drv.fatigue) };
  return Brain.ask([{ role: 'system', content: `Tu es ${c.cop.name}, routier copilote drôle. Fais UNE remarque spontanée (≤ 16 mots) sur la situation, en français familier. JSON : {"remarque":"…"}` }, { role: 'user', content: JSON.stringify(sit) }], 120);
}

// ----- répliques générées par l'IA : réserve renouvelée en continu, piochée par toutes les réactions -----
// (les phrases écrites à la main ne servent plus que si l'IA ne répond pas)
const LINE_CATS = {
  panique: 'automobiliste qui voit un camion fou (poursuivi par la police) foncer derrière lui',
  colere: 'automobiliste furieux, le camion lui a collé au pare-choc / coupé la route',
  peur: 'automobiliste calme qui vient d’avoir une grosse frayeur',
  appel_phares: 'conducteur pressé qui fait des appels de phares à un lent sur la voie de gauche',
  rabattu: 'conducteur lent qui se rabat en râlant après un appel de phares',
  helico: 'automobiliste qui voit un hélicoptère de gendarmerie au-dessus de l’autoroute',
  accroche: 'conducteur poli qui vient de se faire accrocher par un camion',
  accroche_colere: 'conducteur énervé qui vient de se faire emboutir par un camion',
  choc_grave: 'conducteur sonné après un gros accident (airbag)',
  moto_blesse: 'motard qui vient de chuter, blessé mais conscient',
  telephone: 'conducteur accidenté au téléphone (famille, assurance, patron…), commence par 📱',
  appel_17: 'témoin qui appelle la police à propos du camion, commence par 📱',
  temoin: 'témoin qui vient de voir le camion provoquer un accident',
  ouvrier: 'ouvrier de chantier d’autoroute en pause café qui discute avec un collègue',
  ouvrier_peur: 'ouvrier de chantier qui voit un camion foncer dans la zone de travaux',
  secouriste: 'secouriste du SAMU qui arrive sur un accident',
  soins: 'secouriste qui parle au blessé allongé pour le rassurer',
};
const POOL = {}; let used = new Set(JSON.parse(sessionStorage.getItem('tat_used') || '[]'));
export function pickLine(cat, fallback) {
  const p = POOL[cat];
  while (p?.length) { const l = p.shift(); if (!used.has(l)) { used.add(l); try { sessionStorage.setItem('tat_used', JSON.stringify([...used].slice(-300))); } catch (e) { } return l; } }
  Brain.wantLines = true;
  return fallback[Math.floor(Math.random() * fallback.length)];
}
export async function refillLines(g) {
  const need = Object.keys(LINE_CATS).filter(c => (POOL[c]?.length || 0) < 2);
  if (!need.length) return;
  const cats = need.slice(0, 7);
  const ctx = { meteo: g.env?.weather, nuit: (g.env?.night || 0) > 0.5, poursuite: !!(g.released && g.mode !== 'free'), mode: g.mode, coop: !!g.coop };
  const sys = `Tu écris les répliques courtes des automobilistes d'un jeu de poursuite sur une autoroute française. Varié, crédible, souvent drôle, français parlé (pas d'anglais), jamais vulgaire au-delà de « bon sang », « punaise ». Chaque réplique ≤ 12 mots, toutes différentes, personnalités variées (mamie, jeune, routier, cadre pressé, touriste belge, famille…). Réponds UNIQUEMENT en JSON : {"categorie":["réplique",…]} avec 5 répliques par catégorie demandée.`;
  const res = await Brain.ask([{ role: 'system', content: sys }, { role: 'user', content: JSON.stringify({ contexte: ctx, categories: Object.fromEntries(cats.map(c => [c, LINE_CATS[c]])) }) }], 650);
  if (!res) return;
  for (const c of cats) if (Array.isArray(res[c])) (POOL[c] ||= []).push(...res[c].map(x => String(x).trim()).filter(x => x && x.length < 120 && !used.has(x)).sort(() => Math.random() - 0.5));
  Brain.linesOk = (Brain.linesOk || 0) + 1;
}
