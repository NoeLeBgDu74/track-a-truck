// Service worker : rend le jeu installable et jouable hors ligne après une première visite.
// Réseau d'abord pour les fichiers du jeu (mises à jour immédiates), cache en secours ; cache d'abord pour les bibliothèques CDN.
const CACHE = 'tat-v1';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './index.html', './manifest.webmanifest', './icons/icon-192.png']).catch(() => { }))); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (/api\.groq\.com|llm7|netlify\.app\/api|peerjs|0\.peerjs/.test(u.href)) return; // IA et réseau temps réel : jamais en cache
  const cdn = /cdn\.jsdelivr|unpkg|cdnjs|fonts\.(googleapis|gstatic)/.test(u.host);
  if (cdn) { e.respondWith(caches.match(r).then(hit => hit || fetch(r).then(res => { if (res.ok) { const cl = res.clone(); caches.open(CACHE).then(c => c.put(r, cl)); } return res; }))); return; }
  if (u.origin !== location.origin) return;
  e.respondWith(fetch(r).then(res => { if (res.ok) { const cl = res.clone(); caches.open(CACHE).then(c => c.put(r, cl)); } return res; }).catch(() => caches.match(r).then(h => h || caches.match('./index.html'))));
});
