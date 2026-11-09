# Devis en ligne 3D — Tôlerie Rémond

Page de devis en ligne de Tôlerie Rémond, déployée sur Vercel. Le client décrit sa pièce **en discutant**
avec Camille (l'assistant), la voit en **3D** au fil de la conversation, obtient une **estimation de prix**
détaillée et envoie sa demande à l'atelier. Un technicien vérifie ensuite et envoie le devis définitif.

Règles à respecter : `../../CLAUDE.md`. Travail en équipe : `../../CONTRIBUTING.md`. IA et données : `docs/IA.md`.

## Commandes

```bash
npm ci              # installer
npm run dev         # page (http://localhost:5173) + serveur atelier (8787), API sous /api
npm test            # contrôle de tous les produits 3D et des conversations types
npm run lint        # oxlint (3 avertissements connus, pas d'erreur)
npm run build       # vérification TypeScript + build Vite dans dist/
npm run build:api   # régénère les fonctions Vercel api/*.js depuis server/vercel/*.ts
```

## Parcours du client

1. **Décrire** : écran d'accueil (bulle de Camille, barre de saisie, micro), puis fenêtre de discussion.
   Réponses rapides (bulles), exemples par paquets (« Voir d'autres exemples… », « Voir plus… »),
   étapes cliquables (Forme, Dimensions, Matière, Épaisseur, Perçages, Finition, Quantité) pour revenir sur
   une information, crayon sur chaque message pour le modifier et repartir de là. Pièces jointes en bulles
   au-dessus de la saisie (photo, PDF, DXF, STEP…), zone de dépôt cliquable.
2. **Prévisualiser** : la 3D en grand, vues (3/4, face, dessus…), cotes, coupe, couleur (nuancier RAL),
   dépliage, boutons des mécanismes (ouvrir les portes, mettre en marche…), versions de la pièce, annuler.
3. **Devis** : carte de devis animée (prix détaillé, dégressif par quantité, délai), puis coordonnées
   (nom, téléphone, adresse de livraison obligatoires, ou retrait à l'atelier) et envoi.
4. **Mes pièces** : suivi des demandes (avec le serveur : lien de connexion par e-mail).

Compte **atelier** (e-mails de `ADMIN_EMAILS`) : outils d'édition directe dans la 3D (sélection de face
numérotée, cotes, plis, perçages, inserts, découpes, arrondis, réglages des produits), back-office
« Atelier » (demandes, clients, statuts, prix définitif), téléchargements (fiche devis, fiche de
fabrication, DXF, STEP, CSV, STL, SVG, nomenclature). Voir `docs/BACKOFFICE.md`.

## Ce que l'outil sait représenter

- **Pièces de tôlerie simples** : plaque, cornière, U, caisson ; ailes (hauteur, angle), rayon de pliage,
  perçages, inserts (écrou à sertir, goujon, taraudage, dessinés en 3D), découpes droites, angles arrondis.
  Mise à plat exacte (`sheetmetal.ts`), imbrication sur tôle (`nesting.ts`).
- **36 produits assemblés** (`src/lib/products.ts`) : armoire électrique, locker (en ligne ou en angle),
  photomaton, automate de pharmacie, cabine téléphonique, borne interactive, distributeur automatique,
  borne de recharge, boîtes aux lettres, baie serveur, horodateur, carter de machine, fauteuil origami /
  chaise longue, banque d'accueil, bar, étagère, meuble à tiroirs, vitrine, table basse, sièges d'attente,
  bac à fleurs, pergola, porte extérieure, borne sonore, distributeur de gel, meuble de tri, casier à
  bouteilles, lampe perforée, support de menu, chariot, grille / persiennes, trémie, marches, tôle perforée,
  cassettes de façade — et `libre` (objet sur mesure dessiné panneau par panneau par l'IA).
  Gamme tirée des réalisations de tolerie-remond.com, fabricant-meuble-metal.fr et fabricant-banque-accueil.fr.
- **Fichiers importés** (`src/lib/cadImport.ts`) : STEP / IGES / BREP (OpenCascade en WebAssembly), STL,
  OBJ, DXF (profil plat extrudé). Encombrement, épaisseur et plis estimés, prix depuis le modèle.

## Architecture

```
src/
  App.tsx                 écran, état de la pièce, étapes, outils, versions, envoi
  components/             Chat (Camille, saisie, micro, étapes), Viewer3D (three.js), QuoteCard,
                          SelectPanel (face / produit), ColorPicker, DownloadMenu, AdminPage, AccountPage…
  lib/
    types.ts              modèle de données (PartSpec, ProductSpec, Panel, Quote…)
    assistant.ts          moteur de règles du chat (français) : analyse du texte → modification de la pièce
    ai.ts                 pont vers l'IA Claude (contexte envoyé, validation stricte de la réponse)
    products.ts           36 produits : réglages, génération des panneaux, usinage, chiffrage, lecture du texte
    productGeometry.ts    rendu three.js des produits (mouvements, lumières, textes, pièces rondes)
    productCheck.ts       contrôleur d'assemblage (flotte / se croise / traverse)
    partGeometry.ts       rendu des pièces simples (plis animés, inserts)
    sheetmetal.ts faces.ts nesting.ts   mise à plat, faces, imbrication
    pricing.ts cad.ts catalog.ts hardware.ts   prix (matière, laser, pliage, CAO, livraison…), constantes
    cadImport.ts          import STEP / IGES / STL / OBJ / DXF
    exports.ts            DXF, STEP, STL, SVG, CSV, fiches imprimables
    api.ts orders.ts      serveur ou stockage local, commandes et statuts
server/                   serveur de l'atelier (Node, SQLite, e-mails) — local pour l'instant
  ai.ts                   appel à Claude (sortie structurée, schéma zod), partagé avec Vercel
  vercel/                 sources des fonctions Vercel → api/*.js (générés)
api/                      fonctions Vercel : /api/assistant, /api/health
tests/run.ts              npm test
```

### Le chat : règles, puis IA

`App.tsx › think()` traite chaque message :
1. Fichier 3D joint → import (`cadImport.ts`), la pièce devient le fichier.
2. Si l'IA est branchée (`/api/health` → `ai: true`) → `askAi()` envoie à `/api/assistant` le contexte
   (pièce actuelle, ce qui manque, catalogue complet des produits et de leurs réglages, matières, finitions)
   et l'historique. Claude répond une modification structurée (`server/ai.ts › AiTurn`) : pièce simple,
   produit du catalogue avec ses réglages et couleurs, ou objet `custom` dessiné en panneaux.
   `src/lib/ai.ts › toTurn()` la contrôle et la borne avant de l'appliquer.
3. Sinon, ou en cas d'échec → moteur de règles `assistant.ts › respond()` (négations, « finalement… »,
   « de face », couleurs, placements « collé à droite »…).

### Prix (`pricing.ts`, `products.ts › productQuote`, `cad.ts`)

Matière (masse × €/kg + chute), programmation FAO, découpe laser (longueur de coupe et amorçages, trous
compris), pliage (plis + 2 coups par contre-pli), finition (m² × 2 faces), inserts, assemblage et
quincaillerie (produits), contrôle, **conception CAO** (frais unique ; simple reprise si le client a joint
un fichier CAO), **livraison** selon le code postal depuis Crépand (zones local / France / Corse, ou
retrait gratuit). Tous les tarifs sont des **valeurs de départ à calibrer** sur les vrais devis
(constantes dans `catalog.ts`, `cad.ts`, `products.ts`).

## Déploiement

- **Vercel**, projet relié à GitHub, Root Directory `TOLERIE/devis-3d`, réglages dans `vercel.json`.
  Chaque PR a sa preview ; chaque merge sur `main` met en ligne.
- Variables : `ANTHROPIC_API_KEY` (+ `ANTHROPIC_WORKSPACE_ID` si besoin). Sans clé : moteur de règles.
- **Limite actuelle** : le serveur de l'atelier (`server/`, SQLite + e-mails) ne tourne qu'en local.
  En ligne, les demandes restent dans le navigateur du client, pas d'e-mail, pas de compte atelier.

## Feuille de route

1. **IA connectée et nourrie** (prioritaire) : clé API sur Vercel, base de connaissances métier
   (`knowledge/`), lecture des fichiers clients (PDF, images, STEP, DXF) par Claude. Détail : `docs/IA.md`.
2. **Serveur en ligne** : base hébergée (Postgres), envoi des e-mails, connexion client, back-office,
   stockage des fichiers joints.
3. **Calibrage des prix** sur les devis réels de l'atelier ; intégration ERP (Altior), Excel, Drive.
4. **Refonte du site vitrine** (`../site-refonte/`) et bascule du nom de domaine tolerie-remond.com.
