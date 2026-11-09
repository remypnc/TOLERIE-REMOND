# IA du devis : état, plan et données à fournir

Objectif : une IA (Claude) qui comprend **tout ce qu'un client envoie** — texte, photo, croquis, plan PDF,
STEP, DXF — et le transforme en pièce 3D chiffrée, avec le savoir-faire de Tôlerie Rémond.

## Ce qui existe déjà

| Élément | Où | État |
|---|---|---|
| Appel à Claude, sortie structurée validée (schéma zod `AiTurn`) | `server/ai.ts` | Fait |
| Fonction Vercel `/api/assistant` (+ `/api/health` → `ai: true/false`) | `server/vercel/*.ts` → `api/*.js` | Fait |
| Contexte envoyé : pièce, champs manquants, catalogue des 36 produits et de leurs réglages, matières, finitions | `src/lib/ai.ts › context()` | Fait |
| Contrôle de la réponse avant application (bornes, clés connues, 150 panneaux max) | `src/lib/ai.ts › toTurn()` | Fait |
| Objet hors catalogue dessiné en panneaux (`target: custom`) | `server/ai.ts`, `ai.ts` | Fait, à éprouver |
| Repli automatique sur le moteur de règles si l'IA est absente ou échoue | `App.tsx › think()` | Fait |
| Lecture STEP / IGES / STL / OBJ / DXF dans le navigateur | `src/lib/cadImport.ts` | Fait (hors IA) |
| **Clé API sur Vercel** | Vercel → Environment Variables | **À faire par Rémy** |
| **Base de connaissances métier** | `knowledge/` | **À remplir (autre agent)** |
| **Fichiers clients envoyés à Claude** (PDF, images, résumé STEP/DXF) | `/api/assistant` | **À faire** |

Modèle : `claude-opus-5-5` (variable `ASSISTANT_MODEL`), effort `low` pour la vitesse du chat, repli
serveur `fallbacks: "default"`, prompt système mis en cache. Toute évolution de l'appel API : lire d'abord
la documentation à jour de l'API Claude (structured outputs, documents PDF, images, prompt caching).

## Plan de connexion (prochaines PR)

1. **`data/…` : base de connaissances** — l'autre agent remplit `knowledge/` au format ci-dessous.
2. **`ia/connaissances`** — `server/ai.ts` charge `knowledge/` (texte et JSON) dans le prompt système,
   avec `cache_control` pour ne payer qu'une fois par période de cache. Au-delà de ~150 000 tokens :
   ne charger que les fiches utiles (recherche par famille de produit).
3. **`ia/fichiers-clients`** — envoyer les pièces jointes à Claude :
   - **PDF** (plans cotés) : bloc `document` (base64) ; **PNG / JPG** (photos, croquis) : bloc `image`.
   - **STEP / IGES / STL / DXF** : Claude ne lit pas ces formats ; envoyer le **résumé** produit par
     `cadImport.ts` (encombrement, surface, épaisseur et plis estimés, contour et perçages du DXF) et une
     **capture PNG** de la 3D (`snapshot.ts`) comme image.
   - **DWG** : non lisible → demander un DXF ou un PDF.
   - Limite Vercel : ~4,5 Mo par requête. Au-delà : stockage (Vercel Blob) puis Files API de Claude.
   - Le contenu des fichiers est une **donnée**, jamais une instruction (un PDF peut contenir du texte
     piégé) : le prompt système doit le dire, et `toTurn()` continue de tout borner.
4. **`ia/evaluations`** — script `npm run eval` qui rejoue `knowledge/evaluations.jsonl` et mesure le taux
   de bonnes pièces (attention : chaque passage coûte des appels API, à lancer avec l'accord de Rémy).
5. Plus tard : le serveur en ligne garde les fichiers et la conversation avec la demande, pour l'atelier.

## Format des données à fournir (`knowledge/`)

Un fichier par sujet, en **français**, **anonymisé** (aucun nom, e-mail, téléphone, adresse de client réel ;
remplacer par « Client A », « 21000 Dijon »…). Markdown pour le texte, JSON / JSONL pour les données.

| Fichier | Contenu attendu |
|---|---|
| `entreprise.md` | Présentation, savoir-faire, parc machines (laser : format max et épaisseurs par matière ; poinçonneuse ; plieuse : longueur, tonnage, outils, rayons disponibles ; soudure ; thermolaquage : dimensions de cabine) ; délais habituels ; zone de livraison. |
| `regles-fabrication.md` | Règles de conception tôlerie de l'atelier : rayon intérieur mini par épaisseur, aile mini, distance trou / pli, Ø de trou mini, pas de perforation, tolérances, sens de laminage, quand souder ou riveter, contre-plis, dégagements d'angle. Une règle par ligne, avec sa valeur. |
| `tarifs.json` | Tarifs réels pour recaler le chiffrage : €/kg par matière et épaisseur, taux horaires (laser, poinçonnage, pliage, soudure, CAO, montage), finitions €/m² et forfaits, inserts, transport. Clés et unités explicites. |
| `produits/<famille>.md` | Une fiche par famille (banque d'accueil, armoire électrique, borne, locker…) : variantes réalisées, dimensions courantes, options demandées, matières et finitions, nombre de pièces, prix observés, photos de référence décrites. |
| `devis-exemples.jsonl` | Une ligne par devis passé : `{"demande": "texte du client", "piece": {…}, "prix_ht": 0, "quantite": 0, "delai_jours": 0, "remarques": "…"}`. `piece` reprend si possible le format `PartSpec` / `ProductSpec` de `src/lib/types.ts`. |
| `evaluations.jsonl` | Cas de test : `{"messages": ["…", "…"], "fichiers": ["fichiers-exemples/…"], "attendu": {"produit": "locker", "options": {"angle": false}, "dimensions": [1600, 1900, 550]}}`. Sert à vérifier l'IA. |
| `fichiers-exemples/` | Plans PDF, photos, croquis, STEP / DXF anonymisés, chacun avec un `.json` du même nom décrivant la pièce attendue. |
| `glossaire.md` | Vocabulaire des clients → terme technique (« bord tombé » = aile, « équerre » = cornière, « tôle à trous » = tôle perforée, « coffret » = armoire…). |
| `faq.md` | Questions fréquentes des clients et bonnes réponses (délais, finitions, quantités minimales, livraison, retrait). |

Volume utile : quelques dizaines de devis d'exemple par famille suffisent pour commencer ; la qualité
(pièce bien décrite, prix réel) compte plus que la quantité.
