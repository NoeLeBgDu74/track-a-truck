// Reconnaissance vocale (Web Speech, fr-FR) + compréhension des phrases → réactions des routiers.
// Analyse locale tolérante : minuscules, sans accents, nombreux synonymes et tournures.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const norm = t => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();

// intentions : [id, motifs (regex sur le texte normalisé)]
export const INTENTS = [
  ['nohands', /sans les mains|lache le volant|les mains en l'air|mains en l air|lache tout|haut les mains/],
  ['scared', /attention|fais gaffe|gaffe|au secours|on va mourir|aaa+h|ah+ ?non|freine|stop|arrete|pile|on va se crasher|la voiture|le camion devant|danger/],
  ['faster', /plus vite|accelere|fonce|appuie|a fond|pied au plancher|go go|vas[ -]y|allez allez|plein gaz/],
  ['slower', /ralenti|doucement|moins vite|calme toi|du calme|pas si vite/],
  ['left', /a gauche|gauche|tourne a gauche|va a gauche/],
  ['right', /a droite|droite|tourne a droite|va a droite/],
  ['horn', /klaxon|klaxonne|pouet|tut tut|corne/],
  ['radio', /radio|musique|change de (musique|station)|mets (du son|de la musique)|chanson/],
  ['sing', /chante|chanter|on chante/],
  ['dance', /danse|dancer|on danse/],
  ['eat', /j'ai faim|faim|sandwich|manger|bouffe|casse croute/],
  ['coffee', /cafe|caf|j'ai sommeil|je suis creve|fatigue/],
  ['wake', /reveille|debout|reveil|tu dors|dors pas|ouvre les yeux/],
  ['banana', /banane|balance|lance (un|des|le|la)|jette/],
  ['swap', /relais|a toi de conduire|change de conducteur|je conduis|tu conduis|on echange|laisse moi conduire/],
  ['lights', /phare|allume les feux|lumiere/],
  ['wipers', /essuie|essuie glace|pare brise/],
  ['hello', /salut|bonjour|coucou|hello|yo |wesh|bonsoir/],
  ['thanks', /merci|bravo|bien joue|trop fort|genial|super|parfait|t'es le meilleur/],
  ['insult', /idiot|nul|debile|abruti|cretin|imbecile|t'es nul|crotte|andouille/],
  ['police', /police|flic|gendarme|keuf|poulet|sirene|ils arrivent|derriere nous/],
  ['look', /regarde|t'as vu|la bas|wow|waouh|incroyable/],
  ['sleep', /bonne nuit|dodo|je dors|on dort/],
  ['laugh', /mdr|lol|ha ha|hahaha|trop drole|c'est drole/],
  ['cheese', /fromage|tomme|camembert/],
  ['where', /on est ou|c'est encore loin|combien de temps|on arrive quand|ou est la sortie/],
];

export function understand(text) {
  const t = ' ' + norm(text) + ' ';
  const found = [];
  for (const [id, re] of INTENTS) if (re.test(t)) found.push(id);
  // priorités : la peur l'emporte, puis les ordres de conduite
  const order = ['scared', 'nohands', 'swap', 'wake', 'horn', 'faster', 'slower', 'left', 'right', 'banana', 'eat', 'coffee', 'radio', 'lights', 'wipers', 'sing', 'dance', 'police', 'hello', 'thanks', 'insult', 'laugh', 'cheese', 'where', 'look', 'sleep'];
  found.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return found;
}

export class Listener {
  constructor(onText) {
    this.ok = !!SR; this.on = false; this.onText = onText;
  }
  start() {
    if (!this.ok || this.on) return this.ok;
    try {
      const r = this.r = new SR(); r.lang = 'fr-FR'; r.continuous = true; r.interimResults = false; r.maxAlternatives = 1;
      r.onresult = e => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) this.onText(e.results[i][0].transcript); };
      r.onend = () => { if (this.on) setTimeout(() => { try { r.start(); } catch (x) { } }, 300); };
      r.onerror = e => { if (e.error === 'not-allowed') this.on = false; };
      r.start(); this.on = true;
    } catch (e) { this.on = false; }
    return this.on;
  }
  stop() { this.on = false; try { this.r?.stop(); } catch (e) { } }
}
