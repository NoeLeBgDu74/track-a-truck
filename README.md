# TRACK A TRUCK

Jeu de poursuite 3D sur autoroute, jouable dans le navigateur : **camions contre police**.

▶ **Jouer :** https://noelebgdu74.github.io/track-a-truck/

## Le jeu
- **Équipe Camion** : livrez la cargaison à la Plateforme Logistique (sortie 18, 7,6 km) avant la fin du chrono. 15 s d'avance, puis la police arrive : renforts, barrage et herse.
- **Équipe Police** : interceptez le poids lourd suspect (IA) avant sa destination. Passez devant, freinez, coincez-le : sous 14 km/h à moins de 15 m pendant ~3 s = interpellation.
- **Mode libre** : toute l'autoroute, le trafic et la météo, sans objectif.
- **Garage** : 6 véhicules (porteur, plateau, semi-remorque articulé / berline, SUV, break de police) + peintures.

## Technique
- Three.js (rendu, ombres, ciel physique, reflets PMREM), Rapier.js (physique : véhicules à suspension par raycast, remorque articulée par rotule, collisions), Web Audio (moteurs, sirènes 3D, réverbération en tunnel).
- Autoroute A77 générée progressivement par tronçons de 200 m : 2×3 voies, BAU, glissières, terre-plein béton, candélabres, portiques, ponts, 2 tunnels, 2 aires de repos, sortie et plateforme logistique, chantiers avec cônes, champs, hameaux, éoliennes.
- Trafic IA : modèle IDM (distances de sécurité, bouchons), changements de voie (MOBIL simplifié), rabattement devant les gyrophares, accidents physiques.
- Météo : jour / crépuscule / nuit / cycle, pluie, orage, brouillard, routes mouillées (adhérence réduite), essuie-glaces.
- Caméras : cabine (1re personne), poursuite (3e personne), libre. Sortie du véhicule à pied (F).
- WebXR : bouton « Enter VR » si un casque est détecté (vue cabine).

## Coop à 2 — Les Routiers de l'Extrême
Deux routiers dans le même camion : un conduit, l'autre est copilote en vue 1re personne dans la cabine (souris pour regarder, ZQSD pour se déplacer, se pencher par la fenêtre). Fatigue, faim, envie pressante, gazole ; le conducteur s'endort au volant, gags absurdes (abeille, éternuement, carte sur le pare-brise, belle-maman au téléphone, fromage qui pue, pigeon…). Actions copilote 1-7 : sandwich, café, secouer, radio (techno/berceuse/musette), banane sur la police, fausse info CB, relais (Tab). Jouable à deux sur un PC, avec Gégé (IA), ou en ligne.

## Multijoueur (comme 2X2, sans serveur)
PeerJS pair-à-pair : « Créer une partie » donne un code à 4 caractères (ou un lien `?room=CODE`). Modes : Poursuite par équipes ou Coop (l'invité rejoint la cabine de l'hôte). Radio CB vocale (V pour parler). Le dossier `server/` (relais WebSocket Node) reste disponible en option.

## Commandes
ZQSD / flèches · Espace frein à main · C caméra · X regarder derrière · H klaxon · L phares · E sirène · B essuie-glaces · V radio CB · Tab relais · 1-7 copilote · F sortir/remonter · R replacer · M zoom carte · Échap pause. Manette compatible.

Lancer en local : servir le dossier (ex. `npx http-server .`) puis ouvrir `http://localhost:8080`.
