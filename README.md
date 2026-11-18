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

## Multijoueur
Architecture prête : `js/net.js` (client) + `server/server.js` (relais Node).
```
cd server
npm install ws
node server.js
```
Puis dans le jeu : Multijoueur → `ws://adresse:8787`. Salons, équipes, synchronisation des véhicules (15 Hz), chat rapide (1–6), interpellations et livraisons. Aucun joueur n'est simulé.

## Commandes
ZQSD / flèches · Espace frein à main · C caméra · X regarder derrière · H klaxon · L phares · E sirène · V essuie-glaces · F sortir/remonter · R replacer · M zoom carte · Échap pause. Manette compatible.

Lancer en local : servir le dossier (ex. `npx http-server .`) puis ouvrir `http://localhost:8080`.
