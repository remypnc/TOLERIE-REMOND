# Design system — Tôlerie Rémond

Référence unique pour le site principal, le devis instantané, les articles et les visuels réseaux.
Les valeurs sont dans [tokens.css](tokens.css) ; ce document dit **quand** et **comment** les utiliser.

## 1. Principes

1. **Continuité avant rupture** — on garde le navy `#112d63`, le turquoise `#00a2a3`, le logo, Quicksand + Roboto et les libellés de menu connus. Un client qui revient doit reconnaître la maison en 2 secondes.
2. **La preuve avant la promesse** — chaque section montre une pièce réelle, une machine, une cote, un délai. Pas de photo de banque d'images.
3. **Un seul objectif par écran** — un CTA principal (« Devis instantané »), un secondaire au maximum (« Déposer un plan » / « Parler à un technicien »).
4. **Lisible par un acheteur pressé et par une IA** — titres explicites, phrases factuelles, chiffres sourcés, FAQ en fin de page.
5. **Accessible par défaut** — cible WCAG 2.2 AA / RGAA 4.1 : contraste, focus visible, navigation clavier, alt utiles, mouvement réduit.

## 2. Couleurs — règles d'usage

| Token | Usage | Interdit |
|---|---|---|
| `--navy` | Titres, header, footer, fonds de sections fortes | Texte courant long |
| `--accent` | Icônes, focus, filets, survols, illustrations | Texte sur fond blanc, ou fond de bouton avec texte blanc (3.1:1, échoue AA) |
| `--accent-strong` | Fond des boutons primaires (texte blanc 5.5:1), liens et texte turquoise sur fond clair | — |
| `--accent-bright` | Accent sur fond navy/steel | Sur fond blanc |
| `--panel` / `--panel-strong` | Alternance des sections, cartes | — |
| `--steel` | Sections « atelier » (photos, vidéo, chiffres) | — |
| `--warn`, `--error`, `--ok` | États de formulaire, statuts de devis | Décoration |

Proportion visuelle d'une page : ~70 % blanc/panel, ~20 % navy/steel, ~10 % accent.

## 3. Typographie

- **H1** `--fs-2xl` Quicksand 700, un seul par page, contient le mot-clé principal.
- **H2** `--fs-xl` Quicksand 700 · **H3** `--fs-l` Quicksand 600.
- **Corps** Roboto 400, `--fs-m` dans les articles, `--fs-s` dans l'UI et le devis, interlignage `--lh-body`, largeur max `--measure`.
- **Sur-titre (eyebrow)** Roboto 500, `--fs-xs`, majuscules, espacement 0.08em, couleur `--accent-strong`.
- **Cotes / références** `--font-mono` (ex. `DEV-20261106-K3F2`, `ép. 2 mm`, `± 0,1 mm`).

## 4. Grille et responsive

- Conteneur `--container` (1240 px) + `--gutter` ; 12 colonnes desktop, 4 mobile.
- Points de rupture : 600 / **760** (identique au devis) / 1024 / 1280.
- Mobile d'abord : zones tactiles ≥ 44 × 44 px, CTA devis collant en bas d'écran sur mobile, aucune barre de défilement horizontale.

## 5. Composants (bibliothèque à coder une fois, réutiliser partout)

**Navigation** — Header (logo, 5 entrées max, bouton « Devis instantané » toujours visible), méga-menu Savoir-faire / Secteurs, fil d'Ariane, Footer (coordonnées, horaires, marques du groupe, légal).

**Actions** — Button (`primary` fond `--accent-strong`, survol `--navy` / `secondary` contour navy / `ghost` / `link`), tailles M et L, états hover/focus/disabled/loading. CTA-bar (bandeau devis). Sticky-CTA mobile.

**Contenu** — Hero (titre, sous-titre, 2 CTA, visuel atelier ou 3D), Section (eyebrow + H2 + intro), Card réalisation (photo 4:3, secteur, procédés, matière), Card procédé (icône, capacités clés), Stat (chiffre + libellé + source), Logo-wall clients, Témoignage / avis (note, nom, entreprise, date), Timeline « De l'étude à la livraison » (6 étapes), Tableau de capacités, FAQ (accordéon `<details>` + schéma FAQPage), Galerie (lightbox clavier), Video (sous-titres obligatoires).

**Formulaires** — Field (label toujours visible, aide, erreur sous le champ), Upload (STEP / DXF / DWG / PDF / images, 50 Mo, barre de progression), Select, Checkbox consentement RGPD, Message de succès avec référence de demande.

**Devis** — reprend les composants de `devis-3d` (Chat, QuoteCard, Viewer3D, ContactModal) : mêmes tokens, donc aucune rupture visuelle entre site et outil.

**Statuts back-office** — Badge `a_verifier` (warn), `en_cours` (blue), `envoye` (accent), `accepte` (ok), `refuse` (grey).

## 6. Iconographie et images

- Icônes : un seul jeu, trait 1,75 px, coins arrondis (Lucide ou équivalent), 20/24 px.
- Photos : vraies pièces et vrai atelier, lumière neutre, fond propre. Ratios : 16:9 (hero), 4:3 (cartes), 1:1 (réseaux), 4:5 (LinkedIn portrait).
- Export : AVIF + WebP, largeur max 2400 px, `loading="lazy"` sauf l'image du hero, dimensions toujours déclarées.
- Nommage : `secteur-objet-matiere-procede-01.avif` (ex. `ferroviaire-coffret-inox-pliage-01.avif`).
- **Alt** : décrit ce qu'on voit + l'info utile (« Coffret électrique en inox 304 plié, porte ouverte, pour la SNCF »). Image décorative → `alt=""`.

## 7. Ton et rédaction

- Vouvoiement, phrases courtes, verbes d'action. Technique mais compréhensible par un acheteur non-ingénieur.
- Toujours chiffrer quand c'est vrai : épaisseurs, formats, quantités, délais, matières. Ne jamais inventer un chiffre : si une donnée manque, l'IA la signale `[À CONFIRMER]`.
- Mots à privilégier : sur mesure, prêt à intégrer, de l'étude à la livraison, Bourgogne, fabriqué en France, prototype, petite et moyenne série.
- Promesse unique de délai partout (aujourd'hui « 48 h » et « 24/72 h » coexistent : à arbitrer).

## 8. Gabarits de contenu (pour l'IA et pour l'équipe)

### 8.1 Réalisation (étude de cas) — 600 à 1 000 mots
1. H1 : `[Objet] sur mesure en [matière] pour [secteur / client]` (≤ 65 caractères)
2. Chapeau 2–3 phrases : qui, quoi, résultat (réponse directe, citée par les IA)
3. Fiche technique (tableau) : secteur · matière · épaisseur · procédés · finition · quantité · délai
4. H2 Le besoin du client · H2 Notre solution · H2 Fabrication étape par étape (photos placées ici) · H2 Résultat
5. Encadré « Vous avez un projet similaire ? » → CTA devis pré-rempli (secteur + matière)
6. FAQ 3–5 questions · liens internes : 1 page procédé, 1 page secteur, 2 réalisations proches

### 8.2 Page procédé (savoir-faire)
Hero → ce que c'est en 2 phrases → tableau de capacités (machine, format, épaisseurs par matière, tolérances) → applications typiques → 3 réalisations → étapes → FAQ → CTA.

### 8.3 Page secteur
Hero orienté problème du secteur → produits fabriqués → exigences (normes, étanchéité, IP, finitions) → réalisations du secteur → témoignage → FAQ → CTA.

### 8.4 Guide / ressource (GEO)
Question en H1 (« Quelle épaisseur de tôle choisir pour un coffret extérieur ? ») → réponse en 40–60 mots → détails, tableau comparatif → erreurs fréquentes → FAQ → CTA.

## 9. Règles SEO / GEO intégrées aux gabarits

- `title` ≤ 60 caractères : `Mot-clé principal | Tôlerie Rémond` (le suffixe « Montbard, Dijon, Bourgogne » disparaît du title, la localisation va dans le contenu et le schéma).
- `meta description` 140–155 caractères, unique, avec bénéfice + appel à l'action.
- Slug court, sans mots vides : `/realisations/coffret-inox-traitement-eau`.
- Un H1, hiérarchie H2/H3 sans saut.
- Schémas JSON-LD : `LocalBusiness` + `Organization` (global), `Service` (procédés), `Article` + `BreadcrumbList` (réalisations), `FAQPage`, `Review`/`AggregateRating` (avis réels uniquement).
- Entité cohérente partout (site, Google Business Profile, LinkedIn, annuaires) : même nom, adresse, téléphone, description.
- `llms.txt` à la racine : présentation, capacités, pages clés.

## 10. Accessibilité — checklist par composant

Contraste AA · focus visible `--accent` 2 px · ordre de tabulation logique · `aria-expanded` sur menus et accordéons · formulaires avec `<label>` et erreurs annoncées (`aria-live`) · vidéos sous-titrées · `prefers-reduced-motion` respecté · langue `fr` · liens explicites (pas de « cliquez ici ») · zoom 200 % sans perte.
