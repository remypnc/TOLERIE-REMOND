# Urgences du site WordPress actuel — guide pas à pas

Objectif : corriger les risques juridiques et de sécurité **avant** la refonte, en 3 à 5 jours.
À faire par la personne qui a l'accès administrateur WordPress et l'espace client OVH.
Ordre impératif : **sauvegarde d'abord**, le reste ensuite.

## Constats vérifiés de l'extérieur le 06/11/2026

| # | Constat | Gravité |
|---|---|---|
| 1 | Pas de page mentions légales (`/mentions-legales/` → 404) | P0 juridique |
| 2 | Google Analytics 4 (`G-RD35X2MPHR`), Google Ads (`AW-16912222189`) et LinkedIn Insight chargés sans outil de consentement | P0 RGPD |
| 3 | Fichiers des demandes de devis (WPForms) téléchargeables par qui connaît leur URL | P0 confidentialité |
| 4 | Contenu des dossiers affiché publiquement : `/wp-content/uploads/` et ses sous-dossiers | P0 sécurité |
| 5 | XML-RPC actif avec `system.multicall` (force brute des mots de passe) | P0 sécurité |
| 6 | PHP 7.4 (plus de correctifs depuis nov. 2022) ; thème The7 8.6.0, WPBakery 7.9, Ultimate Addons 3.19.4, Slider Revolution 6.2.2 : versions anciennes | P0 sécurité |
| 7 | Aucun en-tête de sécurité HTTP | P1 |
| 8 | 3 liens de l'accueil vers une page 404 | P1 |
| 9 | Ancien tag Universal Analytics `UA-12932700` encore présent (inactif depuis 2024) | P1 |
| 10 | Délai affiché incohérent : « 48 h » partout, « 24/72 h » sur la page devis | P1 |
| 11 | Pas d'outil de heatmap | P1 |
| 12 | Commentaires ouverts, page auteur indexée | P2 |

## Étape 1 — Sauvegarde (30 min)

1. Espace client OVH → Hébergements → votre hébergement → **Sauvegardes** : vérifier qu'une sauvegarde de moins de 24 h existe (fichiers + base de données).
2. En plus, une sauvegarde téléchargée : extension **UpdraftPlus** (gratuite) → « Sauvegarder maintenant » → télécharger les 5 archives sur un disque de l'entreprise.
3. Télécharger aussi par FTP le fichier `.htaccess` de la racine et le garder sous le nom `.htaccess-avant-urgences`.

## Étape 2 — Mises à jour et PHP (2–4 h, idéalement un vendredi après-midi calme)

1. Tableau de bord → Mises à jour : mettre à jour WordPress, puis les extensions **une par une**, en vérifiant l'accueil, une réalisation et le formulaire devis après chacune.
2. **The7, WPBakery, Ultimate Addons, Slider Revolution** sont des extensions payantes : la mise à jour demande la clé de licence (souvent dans le compte ThemeForest / Envato de la personne qui a créé le site). Sans licence valide : désactiver Slider Revolution si le slider n'est pas indispensable, c'est l'extension la plus exposée.
3. Supprimer les extensions désactivées et les thèmes inutilisés (garder un thème par défaut).
4. OVH → Hébergement → **Configuration** → changer la version de PHP en **8.2** (ou 8.3). Tester tout le site juste après. En cas de page blanche : revenir en 7.4, noter l'erreur, me la transmettre.
5. Vérifier qu'aucun compte administrateur inconnu n'existe (Utilisateurs) et activer la double authentification (extension **Two Factor** ou **Wordfence Login Security**).

## Étape 3 — Règles serveur (20 min)

1. Ouvrir `htaccess-securite.txt` (dans ce dossier).
2. Coller les blocs 1 à 6 **en haut** du `.htaccess` de la racine, au-dessus de `# BEGIN WordPress`, via FTP ou l'explorateur de fichiers OVH.
3. Créer `/wp-content/uploads/wpforms/.htaccess` avec le bloc 7 (s'il existe déjà, ajouter les lignes à la fin).
4. Tester : le site s'affiche, `https://www.tolerie-remond.com/wp-content/uploads/` affiche « Forbidden », l'ancien lien 404 redirige vers Savoir-faire, un fichier joint de devis s'ouvre en étant connecté et pas en navigation privée.

## Étape 4 — Pages légales (1 h)

1. Remplir les `[À COMPLÉTER]` de `mentions-legales.html` avec le Kbis (capital, greffe, directeur de publication) et vérifier le numéro de TVA sur une facture.
2. Pages → Ajouter → titre « Mentions légales », slug `mentions-legales`, bloc « HTML personnalisé », coller le contenu.
3. Même chose pour `politique-cookies.html` (slug `politique-cookies`).
4. Ajouter le contenu de `confidentialite-ajout-devis.html` à la page « Politique de confidentialité » existante.
5. Ajouter les trois liens dans le pied de page (Mega Footer) : Mentions légales · Politique de confidentialité · Politique cookies · Gérer mes cookies.

## Étape 5 — Consentement cookies + heatmap (2–3 h)

1. Repérer où sont insérés les tags : très probablement l'extension **WPCode** (un dossier `wpcode` existe dans les uploads), sinon les réglages du thème The7 → « Code personnalisé ».
2. Installer **Complianz – GDPR/CCPA Cookie Consent** (version gratuite suffisante) et suivre son assistant : région Europe, bannière avec boutons « Accepter » et « Refuser » de même taille, consentement conservé 6 mois.
3. Activer dans Complianz le **Google Consent Mode v2**, déclarer Google Analytics 4 et Google Ads.
4. Déplacer le code LinkedIn Insight de WPCode vers Complianz → Intégrations → Scripts → catégorie **Marketing**, pour qu'il ne se charge qu'après accord.
5. **Supprimer** le tag `UA-12932700`.
6. Créer un projet gratuit sur clarity.microsoft.com, coller son code dans Complianz en catégorie **Statistiques**, et activer « Masquer tous les champs de saisie » dans les réglages Clarity.
7. Tester en navigation privée : avant de cliquer sur « Accepter », aucune requête vers `google-analytics.com`, `googleadservices.com`, `px.ads.linkedin.com` ni `clarity.ms` (outils développeur → Réseau).

## Étape 6 — Nettoyage et cohérence (1 h)

1. Réglages → Discussion : décocher « Autoriser les commentaires » ; fermer les commentaires des articles existants (sélection groupée → Modifier → Commentaires : Non autorisés).
2. Yoast SEO → Réglages → Archives auteur : **désactiver** (la page `/author/timothee/` sortira du sitemap).
3. Choisir **un seul délai de réponse** (48 h ou 24–72 h) et le remplacer partout : rechercher « 48H », « 48h », « 24/72 » (extension **Better Search Replace**, faire un essai à blanc d'abord).
4. Retirer les 3 liens vers l'ancienne page « découpe numérique » sur l'accueil (WPBakery), même si la redirection les rattrape.
5. Marquer l'envoi du formulaire devis comme conversion dans GA4 (événement `generate_lead`).

## Quand c'est fait

Me le dire : je relance les mêmes vérifications de l'extérieur (listing, XML-RPC, en-têtes, 404, traceurs avant consentement, mentions légales) et je confirme point par point.
