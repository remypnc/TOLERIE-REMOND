# CLAUDE.md — règles pour les agents qui travaillent sur ce dépôt

Ce fichier est lu automatiquement par Claude Code. Lis-le en entier avant toute modification, puis
`TOLERIE/devis-3d/README.md` (contexte complet du devis 3D) et `CONTRIBUTING.md` (branches et pull requests).
**Agent chargé de l'IA et des données** : ta mission est dans `TOLERIE/devis-3d/docs/MISSION-AGENT-IA.md`.

Qui fait quoi : Rémy décide et fusionne ; l'agent 3D (devis, 3D, prix, refonte du site) relit et fusionne
les PR ; l'agent IA fournit les données métier et connecte Claude aux fichiers des clients.

## Le projet en bref

**Tôlerie Rémond** est une tôlerie fine près de Dijon (Crépand / Montbard, Côte-d'Or) : découpe laser,
poinçonnage, pliage, soudure TIG/MIG, thermolaquage, goujonnage / sertissage ; acier, inox, galva, alu de
0,5 à 6 mm ; mobilier métal, banques d'accueil, armoires électriques, bornes, carters, petites et moyennes séries.

Ce dépôt contient :

| Dossier | Contenu |
|---|---|
| `TOLERIE/devis-3d/` | **Devis en ligne 3D** (React + Vite + three.js), déployé sur **Vercel**. Le client décrit sa pièce en discutant avec « Camille » (assistant), voit la 3D, le prix, et envoie sa demande. |
| `TOLERIE/site-refonte/` | Plan de refonte du site vitrine tolerie-remond.com (WordPress → nouveau site) : inventaire des URL, design system, urgences légales. Le nom de domaine actuel basculera plus tard sur le nouveau site Vercel. |

## Règles absolues (ne jamais enfreindre)

1. **Aucun secret dans le dépôt ni dans le chat.** Clés API (`sk-ant-…`), mots de passe SMTP, jetons :
   uniquement dans `server/.env` (local, ignoré par git) ou dans les variables d'environnement Vercel.
   Ne jamais afficher, recopier, journaliser ni committer une clé. Si tu en vois une, signale-le et
   recommande de la révoquer.
2. **Jamais de push direct sur `main`.** Une branche par sujet, une pull request, les vérifications au vert
   (voir `CONTRIBUTING.md`). `main` = ce qui est en ligne.
3. **Avant chaque PR**, dans `TOLERIE/devis-3d/` : `npm test && npm run lint && npm run build` doivent passer.
   `npm test` contrôle la géométrie de tous les produits (rien qui flotte, se croise ou traverse une tôle)
   et des conversations types. N'affaiblis jamais un test pour le faire passer : corrige le code.
4. **Ne modifie pas `api/*.js` à la main** : ce sont des fichiers générés. Modifie `server/vercel/*.ts`
   ou `server/ai.ts`, puis `npm run build:api` et committe le résultat.
5. **Ne fais jamais confiance à la sortie de l'IA** : tout ce que renvoie Claude passe par la validation
   de `src/lib/ai.ts` (valeurs bornées, clés connues seulement, nombre de panneaux limité). Garde ce contrôle
   pour toute nouvelle donnée venant du modèle ou d'un fichier client.
6. **Données clients** : jamais de données réelles de clients (noms, e-mails, adresses, devis nominatifs)
   dans le dépôt. Les exemples doivent être anonymisés (voir `TOLERIE/devis-3d/docs/IA.md`).
7. **Actions irréversibles ou visibles** (merge sur `main`, suppression de branche, changement de réglages
   GitHub ou Vercel, e-mail réel envoyé) : demander l'accord de Rémy avant.

## Conventions de code

- **Langue** : interface, messages, commentaires et noms métier **en français** (« plis », « contre-plis »,
  « tôle », « devis »). Identifiants de code en français ou anglais comme le code voisin. Vouvoiement
  côté client. L'assistant s'appelle **Camille** (`ASSISTANT_NAME` dans `src/lib/assistant.ts`).
- **Style** : suivre le code voisin (TypeScript strict, composants React fonctionnels, CSS modules,
  commentaires courts qui expliquent le *pourquoi*). Pas de dépendance nouvelle sans raison claire.
- **Unités** : millimètres, degrés, euros HT. Prix indicatifs : toujours présentés comme « estimation
  vérifiée par un technicien ».
- **Couleurs** : RAL (table `RAL` dans `src/lib/partGeometry.ts`, noms dans `products.ts`).

## Règles métier de la 3D (produits assemblés)

Un produit = des panneaux (`Panel`) positionnés en 3D, des mouvements (portes, trappes, tiroirs) et un état
« en marche ». Pour ajouter ou modifier un produit dans `src/lib/products.ts` :

- Les tôles se **touchent bord à bord** ; rien ne flotte, rien ne traverse une tôle pleine. Un élément posé
  contre une paroi utilise `onWall()` (1 mm de jeu). Un vitrage est pris dans l'épaisseur du cadre (`glazed()`).
- Une pièce qui traverse vraiment la tôle (écran, lecteur, voyant, presse-étoupe) y découpe son passage
  (automatique dans `machine()`, ou `openingFor()`). Une pièce en applique porte `mounted: true`.
- Usinage réel : trous (`holes`), ouvertures (`cutouts`), passages de câbles (`cablePass`), supports moteur
  percés (`motorMount`), tiroirs creux (`drawer`). Le câblage n'est pas dessiné, seulement ses passages.
- Plis et **contre-plis** : `sheet: { bends, returns, hems }` ; les développés sont calculés avec la
  déduction de pli (facteur K de la matière) dans `sheetParts()`.
- Tout réglage doit être **promptable** : paramètre `bool`, `number` ou `choice` (avec `words` pour la
  reconnaissance dans le chat). Une nouvelle famille doit avoir sa regex dans `KIND_RE`, ses dimensions types
  dans `PRODUCT_SIZES` (assistant) et ses heures de CAO dans `cad.ts`.
- Après toute modification : `npm test`. Le contrôleur (`src/lib/productCheck.ts`) doit rester vide.

## Où trouver quoi

Voir la carte détaillée des fichiers dans `TOLERIE/devis-3d/README.md`. Points d'entrée :
`src/App.tsx` (écran et état), `src/lib/assistant.ts` (moteur de règles du chat), `src/lib/ai.ts` +
`server/ai.ts` (IA Claude), `src/lib/products.ts` (produits), `src/lib/pricing.ts` + `cad.ts` (prix).
