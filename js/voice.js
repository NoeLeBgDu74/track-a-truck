// Voix synthétiques (Web Speech) : radio police, répliques des routiers, GPS ridicule
import { settings } from './config.js';

let fr = null, last = 0;
function pick() {
  if (fr || !window.speechSynthesis) return fr;
  const vs = speechSynthesis.getVoices();
  fr = vs.filter(v => /^fr/i.test(v.lang));
  return fr;
}
if (window.speechSynthesis) speechSynthesis.onvoiceschanged = () => { fr = null; pick(); };

export const Voice = {
  say(text, { pitch = 1, rate = 1.1, voice = 0, prio = false, vol = 1 } = {}) {
    if (!settings.voices || !window.speechSynthesis) return;
    const clean = String(text).replace(/<[^>]+>/g, '').replace(/[\u{1F000}-\u{1FFFF}☀-➿←→↑↓⬈▶◀«»]/gu, '').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    const now = performance.now();
    if (!prio && (speechSynthesis.pending || now - last < 1200)) return; // pas de cacophonie
    if (prio) speechSynthesis.cancel();
    last = now;
    const u = new SpeechSynthesisUtterance(clean.slice(0, 220));
    const vs = pick() || [];
    if (vs.length) u.voice = vs[voice % vs.length];
    u.lang = 'fr-FR'; u.pitch = pitch; u.rate = rate; u.volume = vol;
    speechSynthesis.speak(u);
  },
  stop() { try { speechSynthesis.cancel(); } catch (e) { } },
};
