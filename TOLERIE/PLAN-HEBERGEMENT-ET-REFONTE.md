# Hébergement, migration et refonte — plan

État au 12 novembre 2026. Les décisions marquées **À décider** reviennent à Rémy.

## 1. Cible

| Adresse | Contenu | Hébergement |
|---|---|---|
| `tolerie-remond.fr` (ou `.com`, le domaine principal actuel) | Site vitrine refait (fin de WordPress) | **OVH** (hébergement web actuel), fichiers statiques |
| `devis.tolerie-remond.fr` | Devis en ligne 3D (ce dépôt, `TOLERIE/devis-3d`) | **Vercel**, fonctions en région **Paris (`cdg1`)** |
| plus tard : serveur de l'atelier | Comptes clients, demandes, e-mails, back-office, fichiers joints | Hébergeur **français** (voir § 4) |

Le nom de domaine reste chez OVH : seul un enregistrement DNS `devis` pointe vers Vercel. Le site principal
n'est pas touché par la mise en ligne du devis.

## 2. Brancher `devis.` sur Vercel (15 minutes, sans coupure)

1. Vercel → projet → **Settings → Domains** → ajouter `devis.tolerie-remond.fr`.
2. OVH → **Web Cloud → Noms de domaine → tolerie-remond.fr → Zone DNS** → ajouter un enregistrement
   **CNAME** : sous-domaine `devis`, cible = la valeur affichée par Vercel (en général `cname.vercel-dns.com.`).
3. Attendre la propagation (quelques minutes à quelques heures) : Vercel crée le certificat HTTPS tout seul.
4. Sur le site actuel, mettre le bouton « Devis en ligne » vers `https://devis.tolerie-remond.fr`.
5. Captcha (§ 5) : ajouter `devis.tolerie-remond.fr` aux domaines autorisés du widget.

## 3. Passer sur le GitHub et le Vercel de l'entreprise

**GitHub** (gratuit) :
1. Créer une **organisation** (ex. `tolerie-remond`) depuis le compte de Rémy : github.com → *Your organizations* → *New organization* → offre Free.
2. Dépôt `remypnc/TOLERIE-REMOND` → **Settings → General → Danger zone → Transfer ownership** → l'organisation.
   GitHub redirige les anciennes adresses ; les PR, l'historique et la protection de `main` suivent.
3. Inviter les membres (Rémy propriétaire, `tb447` membre avec droit d'écriture).
4. Chaque copie locale : `git remote set-url origin https://github.com/tolerie-remond/TOLERIE-REMOND.git`.

**Vercel** :
- Le compte actuel est en offre **Hobby**, réservée à un usage **non commercial**. Un devis d'entreprise doit
  passer en **Pro** (environ 20 $ par membre et par mois) : c'est le bon moment pour créer l'équipe de l'entreprise.
1. Vercel → *Create Team* (ex. « Tôlerie Rémond ») → offre Pro.
2. Projet → **Settings → General → Transfer project** → l'équipe. Vérifier ensuite que les variables
   d'environnement (§ 6) sont bien présentes, sinon les ressaisir.
3. Reconnecter le dépôt GitHub transféré (Settings → Git) si Vercel le demande.

Ordre conseillé : GitHub d'abord, puis Vercel, puis le domaine `devis.`. Prévenir `tb447` avant le transfert.

## 4. Héberger en France

Ce qui est déjà fait : les fonctions du devis (`/api/assistant`, `/api/health`) tournent à **Paris (`cdg1`)**
(`vercel.json › regions`). Les pages statiques sont servies par le réseau mondial de Vercel (Paris pour les
visiteurs français). Vercel reste une société américaine.

Pour le **serveur de l'atelier** (données clients, comptes, fichiers, e-mails), qui contiendra des données
personnelles, un hébergeur français est le plus simple à justifier côté RGPD :

| Hébergeur | Pour quoi | Remarque |
|---|---|---|
| **Clever Cloud** (Nantes) | Serveur Node + PostgreSQL + stockage de fichiers, déploiement depuis GitHub | Le plus simple : pas de serveur à administrer. **Conseillé.** |
| **Scaleway** (Paris) | Mêmes briques (conteneurs serverless, Postgres managé, stockage objet) | Un peu plus technique, très bon rapport prix. |
| **OVHcloud** (Roubaix, Gravelines) | VPS ou Public Cloud | Déjà client ; un VPS demande de l'administration (mises à jour, sécurité). |

**À décider** : tout regrouper en France (devis compris) ou garder le devis sur Vercel Paris et seulement le
serveur en France. Les deux fonctionnent : le devis appelle le serveur par `VITE_API_URL`.

À savoir : les messages envoyés à l'IA partent chez Anthropic (Claude), hors de France. La politique de
confidentialité du site doit le mentionner (traitement par un sous-traitant, pas de donnée sensible demandée).

## 5. Captcha anti-robots (déjà dans le code)

Cloudflare **Turnstile** : gratuit, sans cookie publicitaire, invisible pour la plupart des visiteurs. Il protège
l'assistant IA, la seule partie qui coûte de l'argent à chaque appel. Pas besoin de déplacer le DNS chez Cloudflare.

1. Créer un compte gratuit sur dash.cloudflare.com → **Turnstile → Add widget**.
2. Domaines : `tolerie-remond-devis-3d.vercel.app`, `devis.tolerie-remond.fr` (et `localhost` pour les tests).
   Mode : **Managed**.
3. Copier les deux clés dans Vercel (§ 6), puis **Redeploy**.

Fonctionnement : au premier message à l'IA, la page passe le défi (invisible le plus souvent), le serveur le
vérifie et remet un laissez-passer signé valable 2 h. Sans clés configurées, le captcha est simplement désactivé.
S'ajoutent la limite par adresse IP (40 messages / 10 min) et, côté Anthropic, une **limite de dépense mensuelle**
à régler dans la Console (Paramètres → Limites).

## 6. Variables d'environnement (Vercel → Settings → Environment Variables)

| Variable | Rôle |
|---|---|
| `ANTHROPIC_API_KEY` | Clé de l'API Claude |
| `ASSISTANT_MODEL` | Facultatif. `claude-opus-5-5` par défaut ; `claude-sonnet-5-5` (2× moins cher) ; `claude-haiku-5-5` (environ 40× moins cher, à évaluer sur la lecture des plans) |
| `TURNSTILE_SITE_KEY` | Clé publique du captcha (« Site Key ») |
| `TURNSTILE_SECRET_KEY` | Clé secrète du captcha (« Secret Key ») |

## 7. Refonte du site principal : React ou WordPress ?

**Recommandation : Astro**, un générateur de site qui produit des pages HTML statiques et accepte des composants
React. Ni WordPress, ni une application React « pure ».

| | Astro (conseillé) | React seul (comme le devis) | WordPress |
|---|---|---|---|
| Référencement Google | Excellent (HTML prêt dès le chargement) | Faible sans rendu serveur | Bon |
| Vitesse | Très rapide | Lente au premier affichage | Moyenne (thème, extensions) |
| Hébergement sur OVH | Oui : de simples fichiers à déposer | Oui | Oui (PHP + MySQL) |
| Sécurité, maintenance | Quasi nulle (pas de base, pas de PHP) | Faible | Mises à jour constantes, cible fréquente d'attaques |
| Même design que le devis | Oui : mêmes couleurs, polices, composants React réutilisables | Oui | Thème à reproduire à part |
| Modifier les textes sans développeur | Avec un petit éditeur en ligne (Keystatic ou Decap CMS) | Non | Oui, c'est son point fort |

WordPress ne reste préférable que si plusieurs personnes non techniques publient très souvent (actualités
chaque semaine, extensions spécifiques). Pour un site vitrine de tôlerie (savoir-faire, machines,
réalisations, contact, devis), Astro avec un éditeur léger donne un site plus rapide, mieux référencé,
sans maintenance, et cohérent avec le devis 3D.

Déroulé proposé (branches `site/…`, dossier `TOLERIE/site/`, une PR par étape) :
1. Socle Astro + design system commun au devis (`TOLERIE/site-refonte/design-system`).
2. Pages principales reprises de l'inventaire (`site-refonte/inventaire-urls-et-redirections.csv`), avec
   les **redirections 301** des anciennes adresses WordPress pour ne pas perdre le référencement.
3. Mentions légales, confidentialité, cookies (`site-refonte/urgences/`).
4. Publication sur OVH (dépôt automatique des fichiers par GitHub Actions), bascule du domaine, contrôle Search Console.
