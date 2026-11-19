// TRACK A TRUCK — constantes, géométrie de l'autoroute, définitions des véhicules, paramètres
// Repère route : s = abscisse le long de l'autoroute (≈ z monde), d = décalage latéral.
// Sens +s (vers la destination) : voies côté d < 0 (circulation à droite). Sens -s : d > 0.

export const LANE_W = 3.6;
export const LANES = 3;
export const INNER = 1.2;          // bord intérieur de la voie rapide (depuis le terre-plein)
export const EDGE = INNER + LANES * LANE_W; // 12.0 : ligne de rive / début BAU
export const SHOULDER = 15.0;      // fin de la bande d'arrêt d'urgence
export const RAIL = 15.6;          // glissière extérieure
export const HALF = 17;            // demi-largeur du ruban de route

export const laneD = (dir, lane) => -dir * (INNER + 1.8 + lane * LANE_W); // centre de voie
export const SHOULDER_D = dir => -dir * 13.5;

// Tracé : courbes douces (plat, pente nulle)
export function cx(s) { return 70 * Math.sin(s / 1100) + 28 * Math.sin(s / 430 + 1); }
export function cdx(s) { return 70 / 1100 * Math.cos(s / 1100) + 28 / 430 * Math.cos(s / 430 + 1); }
export function roadYaw(s) { return Math.atan2(cdx(s), 1); }
// normale horizontale (+d)
export function roadN(s, out = { x: 0, z: 0 }) { const k = cdx(s), l = Math.hypot(1, k); out.x = 1 / l; out.z = -k / l; return out; }
const _n = { x: 0, z: 0 };
export function roadToWorld(s, d, out = { x: 0, z: 0 }) { roadN(s, _n); out.x = cx(s) + d * _n.x; out.z = s + d * _n.z; return out; }
export function worldToRoad(x, z, out = { s: 0, d: 0 }) {
  let s = z, d = 0;
  for (let i = 0; i < 3; i++) { roadN(s, _n); d = (x - cx(s)) * _n.x + (z - s) * _n.z; s = z - d * _n.z; }
  out.s = s; out.d = d; return out;
}

// Points d'intérêt (s)
export const START_S = 0;
export const DEST_S = 7600;               // plateforme logistique (côté droit, sens +s)
export const DEST = { s0: 7560, s1: 7780, d0: -24, d1: -92 };
export const EXIT_GAP = [7380, 7800];     // glissière ouverte vers la plateforme
export const TUNNELS = [[3000, 3560], [5800, 6260]];
export const REST_AREAS = [{ s0: 1900, s1: 2250, name: 'Aire des Grands Champs' }, { s0: 4700, s1: 5050, name: 'Aire du Val Doré' }];
export const OVERPASSES = [820, 1480, 2620, 3950, 4420, 5320, 6900, 7250, -250, 8300, 9400];
export const EXIT_NUM = 18;
export const inTunnel = s => TUNNELS.some(([a, b]) => s > a && s < b);
export const railOpen = (s, side) => { // side -1 = côté droit du sens +s
  if (side > 0) return false;
  if (s > EXIT_GAP[0] && s < EXIT_GAP[1]) return true;
  return REST_AREAS.some(r => s > r.s0 - 40 && s < r.s1 + 40);
};

// ---------------- Véhicules ----------------
// Repère véhicule : avant = +Z, haut = +Y, gauche = +X
export const VEHICLES = {
  delivery: {
    id: 'delivery', team: 'truck', name: 'Porteur de livraison', desc: '7,5 t — vif et maniable, idéal pour se faufiler.',
    mass: 7200, power: 190e3, fmax: 2.6, vmax: 118, steer: 0.55, len: 7.4, w: 2.45, h: 3.5,
    wheelR: 0.48, wheels: [[1.02, 2.35], [-1.02, 2.35], [1.02, -1.75], [-1.02, -1.75]], driveRear: true,
    susp: { k: 30, travel: 0.28, rest: 0.42 }, grip: 1.6, cab: { y: 2.5, z: 2.12, x: 0.52, belt: 1.95, wz: 3.55 }, gears: 6, idle: 650, red: 2700, engine: 'diesel',
    color: 0xf2f2ee, accent: 0xd8462b, cam: { dist: 13, h: 4.2 },
  },
  flatbed: {
    id: 'flatbed', team: 'truck', name: 'Camion plateau', desc: '12 t — robuste, chargement de caisses sanglées.',
    mass: 10500, power: 260e3, fmax: 2.4, vmax: 110, steer: 0.5, len: 9.2, w: 2.5, h: 3.4,
    wheelR: 0.52, wheels: [[1.05, 3.2], [-1.05, 3.2], [1.05, -2.1], [-1.05, -2.1], [1.05, -3.45], [-1.05, -3.45]], driveRear: true,
    susp: { k: 34, travel: 0.26, rest: 0.42 }, grip: 1.6, cab: { y: 2.58, z: 3.0, x: 0.52, belt: 2.03, wz: 4.45 }, gears: 8, idle: 600, red: 2500, engine: 'diesel',
    color: 0x1f5fa8, accent: 0xe0b020, cam: { dist: 15, h: 4.6 },
  },
  semi: {
    id: 'semi', team: 'truck', name: 'Semi-remorque', desc: '30 t — lourd, inarrêtable une fois lancé. Remorque articulée.',
    mass: 8200, power: 470e3, fmax: 1.9, vmax: 100, steer: 0.52, len: 6.2, w: 2.5, h: 3.8,
    wheelR: 0.53, wheels: [[1.04, 1.95], [-1.04, 1.95], [1.04, -1.75], [-1.04, -1.75]], driveRear: true,
    susp: { k: 36, travel: 0.25, rest: 0.42 }, grip: 1.7, cab: { y: 2.66, z: 1.62, x: 0.55, belt: 2.1, wz: 2.95 }, gears: 12, idle: 600, red: 2300, engine: 'diesel',
    color: 0xb0161e, accent: 0xdedede, cam: { dist: 24, h: 6.5 },
    trailer: { mass: 14000, len: 13.4, w: 2.55, h: 4.0, kingpin: -1.15, axles: [-8.4, -9.7, -11.0] },
  },
  suv: {
    id: 'suv', team: 'police', name: 'SUV d’intervention', desc: 'Lourd et puissant : parfait pour bousculer.',
    mass: 2250, power: 270e3, fmax: 7.5, vmax: 205, steer: 0.6, len: 4.85, w: 1.98, h: 1.8,
    wheelR: 0.39, wheels: [[0.86, 1.45], [-0.86, 1.45], [0.86, -1.42], [-0.86, -1.42]], awd: true,
    susp: { k: 32, travel: 0.25, rest: 0.36 }, grip: 2.0, cab: { y: 1.62, z: -0.3, x: 0.38, belt: 1.18, wz: 0.85 }, gears: 8, idle: 800, red: 6200, engine: 'v8',
    color: 0x1b2433, accent: 0xf3f3f3, cam: { dist: 8.2, h: 2.6 },
  },
  sedan: {
    id: 'sedan', team: 'police', name: 'Berline de police', desc: 'La plus rapide. Légère, précise en courbe.',
    mass: 1650, power: 245e3, fmax: 8.5, vmax: 230, steer: 0.62, len: 4.75, w: 1.86, h: 1.45,
    wheelR: 0.34, wheels: [[0.8, 1.45], [-0.8, 1.45], [0.8, -1.38], [-0.8, -1.38]], driveRear: true,
    susp: { k: 38, travel: 0.2, rest: 0.32 }, grip: 2.1, cab: { y: 1.24, z: -0.45, x: 0.37, belt: 0.92, wz: 0.83 }, gears: 6, idle: 850, red: 6800, engine: 'v6',
    color: 0xf4f6f8, accent: 0x173c8c, cam: { dist: 7.4, h: 2.3 },
  },
  wagon: {
    id: 'wagon', team: 'police', name: 'Break de police', desc: 'Polyvalent : bon compromis vitesse / masse.',
    mass: 1800, power: 225e3, fmax: 8, vmax: 215, steer: 0.62, len: 4.9, w: 1.88, h: 1.52,
    wheelR: 0.35, wheels: [[0.81, 1.5], [-0.81, 1.5], [0.81, -1.42], [-0.81, -1.42]], awd: true,
    susp: { k: 36, travel: 0.22, rest: 0.33 }, grip: 2.05, cab: { y: 1.26, z: -0.4, x: 0.37, belt: 0.92, wz: 0.86 }, gears: 7, idle: 800, red: 6500, engine: 'v6',
    color: 0x2f62c8, accent: 0xf2f2f2, cam: { dist: 7.6, h: 2.35 },
  },
};
export const TEAM_VEHICLES = { truck: ['delivery', 'flatbed', 'semi'], police: ['sedan', 'suv', 'wagon'] };

export const PAINTS = [0xf2f2ee, 0xb0161e, 0x1f5fa8, 0x1b2433, 0x2b7a3d, 0xe0a020, 0x6b2a8c, 0x3a3d42, 0xd8462b, 0x2f62c8];

// Trafic civil
export const TRAFFIC_TYPES = [
  { kind: 'car', len: 4.3, w: 1.8, h: 1.45, mass: 1400, v0: [31, 38], weight: 46, trucks: false },
  { kind: 'hatch', len: 3.9, w: 1.75, h: 1.5, mass: 1150, v0: [29, 36], weight: 22, trucks: false },
  { kind: 'van', len: 5.4, w: 2.0, h: 2.4, mass: 2600, v0: [27, 33], weight: 14, trucks: false },
  { kind: 'truck', len: 6.2, w: 2.5, h: 3.6, mass: 9000, artic: true, tlen: 13.4, tmass: 20000, v0: [23, 25.5], weight: 12, trucks: true },
  { kind: 'bus', len: 12.5, w: 2.55, h: 3.6, mass: 15000, v0: [25, 27.5], weight: 6, trucks: true },
];

// ---------------- Paramètres persistants ----------------
const DEF = {
  quality: 'high', shadows: true, density: 'normal', weather: 'clear', time: 'day', volume: 0.8,
  difficulty: 'normal', team: 'truck', vehicle: { truck: 'semi', police: 'sedan' }, paint: {}, sens: 1, invertY: false,
  playerName: 'Joueur', server: 'ws://localhost:8787',
};
export const settings = (() => {
  let s = {};
  try { s = JSON.parse(localStorage.getItem('tat_settings') || '{}'); } catch (e) { }
  const o = Object.assign(structuredClone(DEF), s);
  o.vehicle = Object.assign({}, DEF.vehicle, s.vehicle || {});
  return o;
})();
export function saveSettings() { try { localStorage.setItem('tat_settings', JSON.stringify(settings)); } catch (e) { } }

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const fmtTime = t => { t = Math.max(0, t); const m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ':' + String(s).padStart(2, '0'); };
