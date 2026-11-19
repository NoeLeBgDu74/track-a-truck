// Point d'entrée : chargement, rendu, menus, WebXR
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { settings, saveSettings, VEHICLES, TEAM_VEHICLES, PAINTS } from './config.js';
import { QUICK_CHAT } from './net.js';

const $ = id => document.getElementById(id);
const setLoad = (t, p) => { $('load-msg').textContent = t; $('load-bar').style.width = p + '%'; };

async function boot() {
  setLoad('Chargement du moteur physique…', 15);
  await RAPIER.init();
  setLoad('Construction de l’autoroute…', 45);
  const { Game } = await import('./game.js');
  const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.xr.enabled = true;
  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 4000);
  const rig = new THREE.Group();
  const game = window.game = new Game(RAPIER, renderer, camera, rig);
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
  setLoad('Mise en circulation du trafic…', 85);

  // WebXR : la caméra du casque est placée dans la cabine du véhicule
  const xrCam = new THREE.PerspectiveCamera();
  if (navigator.xr) navigator.xr.isSessionSupported('immersive-vr').then(ok => { if (ok) { const b = VRButton.createButton(renderer); b.id = 'vrbtn'; document.body.appendChild(b); } }).catch(() => { });

  let last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now(), dt = (now - last) / 1000; last = now;
    game.frame(dt);
    if (renderer.xr.isPresenting && game.player) {
      rig.position.copy(game.player.cabPos).applyQuaternion(game.player.quat).add(game.player.pos);
      rig.quaternion.copy(game.player.quat).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
      rig.position.y -= 1.2;
      if (camera.parent !== rig) rig.add(camera);
    } else if (camera.parent === rig) { rig.remove(camera); }
    renderer.render(game.scene, camera);
    fps(dt);
  });
  setLoad('Prêt', 100);
  setTimeout(() => $('loading').classList.add('gone'), 300);
  ui(game);
}

let fAcc = 0, fN = 0;
function fps(dt) { fAcc += dt; fN++; if (fAcc > 0.5) { $('fps').textContent = Math.round(fN / fAcc) + ' FPS'; fAcc = 0; fN = 0; } }

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id));
}

function ui(game) {
  const clickSnd = () => game.audio.ctx && game.audio.beep(1000, 0.04, 0.05);
  document.addEventListener('click', e => { if (e.target.closest('button')) { game.audio.init(); clickSnd(); } });
  show('home');
  // accueil
  $('b-play').onclick = () => { show('setup'); renderSetup(); };
  $('b-free').onclick = () => { show('setup-free'); renderFree(); };
  $('b-coop').onclick = () => { show('setup-coop'); renderCoop(); };
  $('b-garage').onclick = () => { show('garage'); game.openGarage(settings.team); renderGarage(); };
  $('b-settings').onclick = () => { show('settings'); renderSettings('home'); };
  $('b-multi').onclick = () => { show('multi'); renderMulti(); };
  $('b-help').onclick = () => show('help');
  document.querySelectorAll('[data-back]').forEach(b => b.onclick = () => { const t = b.dataset.back; if (game.state === 'garage') game.toMenu(); show(t); });

  // préparation de partie
  let team = settings.team;
  function renderSetup() {
    document.querySelectorAll('#setup .team').forEach(c => { c.classList.toggle('sel', c.dataset.team === team); c.onclick = () => { team = c.dataset.team; settings.team = team; saveSettings(); renderSetup(); }; });
    $('s-veh').innerHTML = TEAM_VEHICLES[team].map(id => `<button class="chip ${settings.vehicle[team] === id ? 'sel' : ''}" data-id="${id}">${VEHICLES[id].name}</button>`).join('');
    $('s-veh').querySelectorAll('.chip').forEach(b => b.onclick = () => { settings.vehicle[team] = b.dataset.id; saveSettings(); renderSetup(); });
    seg('s-diff', 'difficulty', [['easy', 'Facile'], ['normal', 'Normal'], ['hard', 'Difficile']], renderSetup);
    seg('s-weather', 'weather', [['clear', '☀ Clair'], ['rain', '🌧 Pluie'], ['storm', '⛈ Orage'], ['fog', '🌫 Brouillard']], renderSetup);
    seg('s-time', 'time', [['day', 'Jour'], ['dusk', 'Crépuscule'], ['night', 'Nuit'], ['cycle', 'Cycle']], renderSetup);
    $('s-brief').innerHTML = team === 'truck'
      ? '<b>Objectif :</b> livrer la cargaison à la <b>Plateforme Logistique</b> (sortie 18, 7,6 km) avant la fin du chrono. Vous avez <b>15 s d’avance</b>. Si la police vous immobilise (vitesse &lt; 14 km/h à son contact) ou détruit votre camion, c’est perdu. Méfiez-vous des barrages et des herses.'
      : '<b>Objectif :</b> intercepter le camion suspect avant qu’il n’atteigne la <b>Plateforme Logistique</b>. Il part avec <b>10 s d’avance</b>. Passez devant, freinez, coincez-le contre le trafic : maintenez-le sous 14 km/h à votre contact pour l’interpeller. <b>E</b> = sirène.';
  }
  function seg(id, key, opts, re) {
    $(id).innerHTML = opts.map(([v, l]) => `<button class="chip ${settings[key] === v ? 'sel' : ''}" data-v="${v}">${l}</button>`).join('');
    $(id).querySelectorAll('.chip').forEach(b => b.onclick = () => { settings[key] = b.dataset.v; saveSettings(); re(); });
  }
  $('s-go').onclick = () => { show('none'); game.start({ mode: 'chase', team }); };

  // coop
  let coopKind = 'solo';
  function renderCoop() {
    document.querySelectorAll('#setup-coop .team').forEach(c => { c.classList.toggle('sel', c.dataset.coop === coopKind); c.onclick = () => { coopKind = c.dataset.coop; renderCoop(); }; });
    $('c-veh').innerHTML = TEAM_VEHICLES.truck.map(id => `<button class="chip ${settings.vehicle.truck === id ? 'sel' : ''}" data-id="${id}">${VEHICLES[id].name}</button>`).join('');
    $('c-veh').querySelectorAll('.chip').forEach(b => b.onclick = () => { settings.vehicle.truck = b.dataset.id; saveSettings(); renderCoop(); });
    seg('c-diff', 'difficulty', [['easy', 'Facile'], ['normal', 'Normal'], ['hard', 'Difficile']], renderCoop);
    seg('c-weather', 'weather', [['clear', '☀ Clair'], ['rain', '🌧 Pluie'], ['storm', '⛈ Orage'], ['fog', '🌫 Brouillard']], renderCoop);
    seg('c-time', 'time', [['day', 'Jour'], ['dusk', 'Crépuscule'], ['night', 'Nuit'], ['cycle', 'Cycle']], renderCoop);
  }
  $('c-go').onclick = () => { show('none'); game.start({ mode: 'coop', coop: coopKind }); };
  $('coop-acts').addEventListener('click', e => { const b = e.target.closest('.ca'); if (b) game.coopAct(b.dataset.a); });

  // mode libre
  let freeVeh = settings.vehicle[settings.team];
  function renderFree() {
    $('f-veh').innerHTML = Object.values(VEHICLES).map(d => `<button class="vcard ${freeVeh === d.id ? 'sel' : ''}" data-id="${d.id}"><small>${d.team === 'truck' ? 'CAMION' : 'POLICE'}</small><b>${d.name}</b><span>${d.desc}</span></button>`).join('');
    $('f-veh').querySelectorAll('.vcard').forEach(b => b.onclick = () => { freeVeh = b.dataset.id; renderFree(); });
    seg('f-weather', 'weather', [['clear', '☀ Clair'], ['rain', '🌧 Pluie'], ['storm', '⛈ Orage'], ['fog', '🌫 Brouillard']], renderFree);
    seg('f-time', 'time', [['day', 'Jour'], ['dusk', 'Crépuscule'], ['night', 'Nuit'], ['cycle', 'Cycle']], renderFree);
  }
  $('f-go').onclick = () => { show('none'); game.start({ mode: 'free', team: VEHICLES[freeVeh].team, vehicle: freeVeh }); };

  // garage
  function stat(label, v) { return `<div class="stat"><span>${label}</span><i><b style="width:${Math.round(v * 100)}%"></b></i></div>`; }
  function renderGarage() {
    const t = game.garageTeam;
    document.querySelectorAll('#garage .tab').forEach(b => { b.classList.toggle('sel', b.dataset.team === t); b.onclick = () => { game.garageTeam = b.dataset.team; game.showPreview(settings.vehicle[b.dataset.team]); renderGarage(); }; });
    const cur = settings.vehicle[t];
    $('g-list').innerHTML = TEAM_VEHICLES[t].map(id => { const d = VEHICLES[id]; return `<button class="vcard ${cur === id ? 'sel' : ''}" data-id="${id}"><b>${d.name}</b><span>${d.desc}</span></button>`; }).join('');
    $('g-list').querySelectorAll('.vcard').forEach(b => b.onclick = () => { settings.vehicle[t] = b.dataset.id; saveSettings(); game.showPreview(b.dataset.id); renderGarage(); });
    const d = VEHICLES[cur], tm = d.trailer ? d.trailer.mass : 0;
    $('g-stats').innerHTML = stat('Vitesse max', d.vmax / 230) + stat('Accélération', Math.min(1, d.power / (d.mass + tm) / 160)) + stat('Masse', Math.min(1, (d.mass + tm) / 22000)) + stat('Maniabilité', d.steer * (d.team === 'truck' ? 1.2 : 1.45) - (d.trailer ? 0.25 : 0)) +
      `<p class="specs">${d.vmax} km/h · ${Math.round(d.power / 1000 * 1.36)} ch · ${((d.mass + tm) / 1000).toFixed(1)} t</p>`;
    $('g-paint').innerHTML = PAINTS.map(c => `<button class="sw ${((settings.paint[cur] ?? d.color) === c) ? 'sel' : ''}" style="background:#${c.toString(16).padStart(6, '0')}" data-c="${c}"></button>`).join('');
    $('g-paint').querySelectorAll('.sw').forEach(b => b.onclick = () => { settings.paint[cur] = +b.dataset.c; saveSettings(); game.showPreview(cur); renderGarage(); });
  }

  // paramètres
  let settingsBack = 'home';
  function renderSettings(back) {
    if (back) settingsBack = back;
    seg('o-quality', 'quality', [['low', 'Basse'], ['medium', 'Moyenne'], ['high', 'Haute']], () => { game.applyQuality(); renderSettings(); });
    $('o-shadows').checked = settings.shadows; $('o-shadows').onchange = e => { settings.shadows = e.target.checked; saveSettings(); game.applyQuality(); };
    seg('o-density', 'density', [['low', 'Faible'], ['normal', 'Normale'], ['high', 'Dense']], renderSettings);
    seg('o-weather', 'weather', [['clear', '☀ Clair'], ['rain', '🌧 Pluie'], ['storm', '⛈ Orage'], ['fog', '🌫 Brouillard']], () => { game.env.setWeather(settings.weather); renderSettings(); });
    seg('o-time', 'time', [['day', 'Jour'], ['dusk', 'Crépuscule'], ['night', 'Nuit'], ['cycle', 'Cycle']], () => { game.env.setTime(settings.time); renderSettings(); });
    $('o-vol').value = settings.volume; $('o-vol').oninput = e => { settings.volume = +e.target.value; saveSettings(); game.audio.setVolume(settings.volume); };
    $('o-sens').value = settings.sens; $('o-sens').oninput = e => { settings.sens = +e.target.value; saveSettings(); };
    $('o-inv').checked = settings.invertY; $('o-inv').onchange = e => { settings.invertY = e.target.checked; saveSettings(); };
    $('o-back').onclick = () => { show(settingsBack); };
  }

  // pause / fin
  $('p-resume').onclick = () => game.setState(game.prevState || 'play');
  $('p-restart').onclick = () => { game.setState('play'); game.start(game.lastCfg); };
  $('p-settings').onclick = () => { show('settings'); renderSettings('none'); $('o-back').onclick = () => { show('none'); }; };
  $('p-quit').onclick = () => { game.toMenu(); show('home'); };
  $('e-again').onclick = () => { show('none'); game.start(game.lastCfg); };
  $('e-menu').onclick = () => { game.toMenu(); show('home'); };

  // multijoueur (PeerJS : code de partie, comme 2X2)
  const net = game.net;
  let netMode = 'online';
  function renderMulti() {
    $('m-name').value = settings.playerName;
    const inRoom = !!net.peer && (net.host || net.connected);
    $('m-lobby').style.display = inRoom ? '' : 'none';
    $('m-out').style.display = inRoom ? 'none' : '';
    if (!net.available) $('m-status').textContent = 'Le mode en ligne est indisponible (bibliothèque réseau non chargée).';
    if (inRoom) {
      $('m-code').textContent = net.code;
      $('m-players').innerHTML = net.roster().map(p => `<li class="${p.team}">${p.host ? '★ ' : ''}${p.name}${p.id === net.id ? ' (toi)' : ''} — ${p.team === 'truck' ? '🚛 Camion' : '🚔 Police'}</li>`).join('');
      $('m-host-opts').style.display = net.host ? '' : 'none';
      $('m-start').style.display = net.host ? '' : 'none';
      document.querySelectorAll('#m-mode .chip').forEach(c => { c.classList.toggle('sel', c.dataset.mm === netMode); c.onclick = () => { netMode = c.dataset.mm; net.send({ t: 'mode', m: netMode }); renderMulti(); }; });
      document.querySelectorAll('#multi [data-mteam]').forEach(b => b.classList.toggle('sel', b.dataset.mteam === net.me.team));
      $('m-voice').textContent = net.stream ? '📻 Radio CB allumée (V pour parler)' : '📻 Allumer la radio CB (micro)';
      if (!net.host) $('m-status').textContent = netMode === 'coop' ? 'Mode Coop : tu seras copilote dans le camion du créateur.' : 'Mode Poursuite : choisis ton équipe, le créateur lance la partie.';
    }
  }
  const myName = () => { settings.playerName = ($('m-name').value.trim() || 'Joueur').slice(0, 20); saveSettings(); return settings.playerName; };
  $('m-create').onclick = async () => {
    $('m-status').textContent = 'Création de la partie…';
    try { const code = await net.hostGame(myName()); net.setTeam(settings.team, settings.vehicle[settings.team]); $('m-status').textContent = `Partie créée ! Donne le code ${code} à tes potes.`; }
    catch (e) { $('m-status').textContent = 'Impossible de créer la partie : ' + e.message; }
    renderMulti();
  };
  const join = async code => {
    if (!code) return;
    $('m-status').textContent = 'Connexion à la partie ' + code.toUpperCase() + '…';
    try { await net.joinGame(code, myName()); net.setTeam(settings.team, settings.vehicle[settings.team]); $('m-status').textContent = 'Connecté !'; }
    catch (e) { $('m-status').textContent = '❌ ' + e.message; }
    renderMulti();
  };
  $('m-join').onclick = () => join($('m-joincode').value.trim());
  $('m-joincode').addEventListener('keydown', e => { if (e.key === 'Enter') join($('m-joincode').value.trim()); });
  $('m-copy').onclick = () => { const u = location.href.split('?')[0] + '?room=' + net.code; try { navigator.clipboard.writeText(u); $('m-status').textContent = '🔗 Lien copié : ' + u; } catch (e) { $('m-status').textContent = u; } };
  $('m-leave').onclick = () => { net.leave(); renderMulti(); };
  $('m-voice').onclick = async () => { await net.enableVoice(); renderMulti(); };
  document.querySelectorAll('#multi [data-mteam]').forEach(b => b.onclick = () => { const t = b.dataset.mteam; settings.team = t; saveSettings(); net.setTeam(t, settings.vehicle[t]); renderMulti(); });
  $('m-start').onclick = () => {
    if (netMode === 'coop' && net.players.size < 1) { $('m-status').textContent = 'Attends que ton pote rejoigne la partie.'; return; }
    net.start({ mode: netMode, weather: settings.weather, time: settings.time, difficulty: settings.difficulty });
  };
  net.on('room', renderMulti); net.on('close', renderMulti);
  net.on('mode', m => { netMode = m.m; renderMulti(); });
  net.on('joined', () => { if (net.host) net.send({ t: 'mode', m: netMode }); });
  net.on('error', m => { $('m-status').textContent = m.msg; game.hud.toast(m.msg); });
  net.on('start', m => {
    show('none');
    if (m.difficulty) settings.difficulty = m.difficulty;
    const go = () => {
      if (m.mode === 'coop') game.start({ mode: 'coop', coop: 'online', mirror: !net.host, seed: m.seed, weather: m.weather, time: m.time, cineFirst: true });
      else game.start({ mode: 'online', team: net.me.team, seed: m.seed, weather: m.weather, time: m.time });
    };
    setTimeout(go, Math.max(0, Math.min(3000, m.at - Date.now())));
  });
  $('chatkeys').innerHTML = QUICK_CHAT.map((q, i) => `<span><kbd>${i + 1}</kbd> ${q}</span>`).join('');
  // lien d'invitation : ?room=CODE
  const room = new URLSearchParams(location.search).get('room');
  if (room) { show('multi'); renderMulti(); $('m-joincode').value = room.toUpperCase(); if (settings.playerName && settings.playerName !== 'Joueur') join(room); else $('m-status').textContent = 'Choisis ton pseudo puis clique sur Rejoindre.'; }

  // retour à l'accueil quand le jeu revient au menu par le clavier
  setInterval(() => {
    if (game.state === 'menu' && !document.querySelector('.screen.on')) show('home');
    document.body.classList.toggle('online', !!net.connected && game.mode === 'online');
  }, 300);
}

boot().catch(e => { console.error(e); setLoad('Erreur : ' + e.message, 100); });
