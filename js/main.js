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

  // multijoueur
  const net = game.net;
  function renderMulti() {
    $('m-url').value = settings.server; $('m-name').value = settings.playerName;
    $('m-status').textContent = net.connected ? 'Connecté au serveur.' : 'Non connecté.';
    $('m-lobby').style.display = net.room ? '' : 'none';
    $('m-rooms-wrap').style.display = net.connected && !net.room ? '' : 'none';
    if (net.room) {
      $('m-code').textContent = net.room.code;
      $('m-players').innerHTML = net.room.players.map(p => `<li class="${p.team}">${p.host ? '★ ' : ''}${p.name} — ${p.team === 'truck' ? '🚛 Camion' : '🚔 Police'}</li>`).join('');
      const me = net.room.players.find(p => p.id === net.id);
      $('m-start').style.display = me?.host ? '' : 'none';
    }
  }
  $('m-connect').onclick = async () => {
    settings.server = $('m-url').value.trim(); settings.playerName = $('m-name').value.trim() || 'Joueur'; saveSettings();
    $('m-status').textContent = 'Connexion…';
    try { await net.connect(settings.server, settings.playerName); net.listRooms(); }
    catch (e) { $('m-status').textContent = 'Serveur injoignable (' + e.message + '). Lancez server/server.js — voir README.'; return; }
    renderMulti();
  };
  net.on('rooms', m => { $('m-rooms').innerHTML = m.rooms.length ? m.rooms.map(r => `<li><b>${r.name}</b> (${r.players.length} joueurs) <button class="chip" data-c="${r.code}">Rejoindre</button></li>`).join('') : '<li>Aucune partie ouverte.</li>'; $('m-rooms').querySelectorAll('button').forEach(b => b.onclick = () => net.joinRoom(b.dataset.c)); });
  net.on('room', renderMulti); net.on('close', renderMulti);
  net.on('error', m => $('m-status').textContent = m.msg);
  $('m-create').onclick = () => net.createRoom(settings.playerName + ' — partie');
  $('m-join').onclick = () => net.joinRoom($('m-joincode').value.trim());
  $('m-refresh').onclick = () => net.listRooms();
  document.querySelectorAll('#multi [data-mteam]').forEach(b => b.onclick = () => { const t = b.dataset.mteam; settings.team = t; saveSettings(); net.setTeam(t, settings.vehicle[t]); });
  $('m-start').onclick = () => net.start();
  net.on('start', m => {
    const me = net.room?.players.find(p => p.id === net.id);
    const t = me?.team || 'truck';
    show('none');
    setTimeout(() => game.start({ mode: 'online', team: t, seed: m.seed }), Math.max(0, m.at - Date.now()));
  });
  $('chatkeys').innerHTML = QUICK_CHAT.map((q, i) => `<span><kbd>${i + 1}</kbd> ${q}</span>`).join('');

  // retour à l'accueil quand le jeu revient au menu par le clavier
  setInterval(() => {
    if (game.state === 'menu' && !document.querySelector('.screen.on')) show('home');
    document.body.classList.toggle('online', !!net.room);
  }, 300);
}

boot().catch(e => { console.error(e); setLoad('Erreur : ' + e.message, 100); });
