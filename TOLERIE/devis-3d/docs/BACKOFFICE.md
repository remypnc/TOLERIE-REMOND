# Back-office : serveur, espace client et intégrations

Le serveur de l'atelier (`server/`) enregistre les demandes, envoie les e-mails et gère l'espace client.
Ce document décrit son fonctionnement et comment brancher plus tard l'ERP (Altior), Excel et le Drive.
La page parle au serveur dès que `VITE_API_URL` est défini (`/api`, voir `.env.development`) ;
sans lui, elle garde les demandes dans le navigateur (`src/lib/api.ts`, mode secours pour la démo).

## Lancer

```bash
npm run dev            # page devis (5173) + serveur atelier (8787), l'API est servie sous /api
npm run server         # serveur seul
```

Réglages : copier `server/.env.example` en `server/.env` (SMTP, e-mail de l'atelier, jeton back-office).
Sans SMTP, aucun e-mail ne part : ils sont rangés dans une boîte d'envoi locale, lisible sur
`http://localhost:5173/api/dev/outbox` (désactivée en production). Données : `server/data/atelier.sqlite`.

## Ce que fait le serveur (`server/`)

| Fichier | Rôle |
|---|---|
| `index.ts` | Routes HTTP, contrôles d'accès, limites anti-abus |
| `db.ts` | Base SQLite : clients, pièces, demandes complètes, journal interne, liens et sessions |
| `mail.ts` | E-mails (confirmation, lien de connexion, changement d'étape, alerte atelier) |
| `config.ts` | Variables d'environnement |

À chaque demande : enregistrement de la pièce **et** de la demande complète (conversation, message, prix
estimé) pour garder la trace, fiche client créée ou complétée, e-mail de confirmation avec un lien
« Suivre ma pièce » (connexion directe, 7 jours), alerte à l'atelier si `WORKSHOP_EMAIL` est défini.

## Compte atelier (back-office de test)

Les e-mails listés dans `ADMIN_EMAILS` (`server/.env`) sont des comptes atelier. Une fois connectés (même lien
de connexion que les clients), ils ont :

- les outils d'édition complets dans la preview (cotes, plis, perçages, inserts, découpes, arrondis…) ; les
  clients, eux, décrivent leur pièce uniquement par la discussion. Le bouton crayon de l'en-tête bascule en « vue client » ;
- le bouton **Atelier** : toutes les demandes (filtres, recherche, indicateurs), les clients, et pour chaque pièce
  la mise à jour du statut, du prix définitif, des dates et du suivi colis, avec un e-mail au client si besoin ;
- le menu **Télécharger** : fiche devis et fiche de fabrication (PDF via l'impression), patron **DXF** (calques
  DECOUPE / PLIAGE / TEXTE, inserts repérés), modèle **STEP** plié (solide à facettes), **CSV** des perçages et
  inserts, **STL**, **SVG** à l'échelle, JSON complet.

Sans SMTP (développement), aucun e-mail réel ne part : la page propose directement le lien de connexion
(« mode test ») et les e-mails sont lisibles sur `/api/dev/outbox`.

## Routes

| Méthode | Route | Rôle |
|---|---|---|
| `POST` | `/api/quotes` | Nouvelle demande. Avec `replaces` : nouvelle version d'une pièce existante (client connecté, pièce à lui, commande pas encore validée). Répond `{ order, emailSent, stored }`. |
| `POST` | `/api/auth/link` | `{ email }` → envoie un lien de connexion (30 min, usage unique). Même réponse que l'e-mail soit connu ou non. |
| `GET` | `/api/auth/callback?token=…` | Valide le lien, pose le cookie de session (30 jours, `HttpOnly`), renvoie vers « Mes pièces ». |
| `POST` | `/api/auth/logout` | Ferme la session. |
| `GET` / `PUT` | `/api/me` | Coordonnées du client connecté. |
| `GET` | `/api/me/orders` | Pièces du client connecté. |
| `POST` | `/api/admin/orders/:ref/status` | **Back-office / ERP** : compte atelier connecté, ou en-tête `Authorization: Bearer <ADMIN_TOKEN>`. Voir ci-dessous. |
| `GET` | `/api/admin/orders` · `/api/admin/orders/:ref` · `/api/admin/clients` | Back-office : toutes les pièces, le détail (demandes complètes, journal interne), les clients. |

Seules les empreintes SHA-256 des liens et des sessions sont stockées.

### Mettre à jour une pièce depuis le back-office ou l'ERP

```bash
curl -X POST https://…/api/admin/orders/DEV-20261106-AB12/status \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"internalStatus":"devis_envoye","clientNote":"Devis définitif envoyé par e-mail",
       "finalPrice":{"unitPrice":17.5,"subtotal":175},"source":"altior"}'
```

Champs : `internalStatus` (obligatoire), `note` (interne, jamais montrée au client), `clientNote`
(visible dans le suivi), `shipDate`, `deliveryDate`, `tracking { carrier, number, url }`, `finalPrice`,
`source`, `notify` (e-mail au client ; par défaut à chaque changement d'étape, avec `clientNote` dans l'e-mail).

## Statuts : interne ≠ client

L'atelier travaille avec des statuts détaillés ; le client ne voit que 7 étapes simples. La
correspondance est dans `INTERNAL_TO_CLIENT` (`src/lib/orders.ts`) :

| Étape client | Exemples de statuts internes |
|---|---|
| Demande reçue | `a_verifier` |
| Vérification | `en_etude`, `chiffrage` |
| Devis envoyé | `devis_envoye` |
| Commande validée | `commande`, `planifie` |
| En fabrication | `approvisionnement`, `decoupe_laser`, `pliage`, `soudure`, `finition`, `controle`, `pret_expedition` |
| Expédiée | `expedie` (+ transporteur et n° de suivi) |
| Livrée | `livre` |

Règles :

- le client ne voit jamais le poste, l'opérateur, les aléas, le stock, les coûts ou les marges ;
- un statut interne inconnu ne fait jamais reculer l'étape affichée ;
- chaque changement d'étape client ajoute un `OrderEvent` (date + note courte facultative, rédigée pour le client) ;
- les dates prévues (`shipDate`, `deliveryDate`) sont recalculées par l'atelier ; le front ne fait qu'une première estimation.

## Intégrations à prévoir

Le serveur est le seul point central : le front ne parle jamais directement à l'ERP, à Excel ou au Drive.

```
Devis en ligne ──► Serveur atelier (API + base) ──► ERP Altior   (devis, commandes, stock, avancement)
                         │                     ├──► Excel        (exports / tableaux de suivi)
                         │                     ├──► Drive        (plans DXF/STEP, PDF de devis, photos)
                         └──► E-mails (confirmation, devis définitif, expédition)
```

Chaque intégration est un connecteur derrière une même interface côté serveur : `pushQuote`, `pushOrder`,
`pullStatus`, `pullStock`, `attachFile`. On peut ainsi commencer par Excel et passer à Altior sans toucher au front.

- **ERP Altior** : création du devis et de la commande, puis lecture régulière (ou webhook si disponible) des
  statuts, dates prévues et numéros de suivi. **À fournir** : la documentation d'API ou les formats
  d'import/export d'Altior, et la liste exacte de leurs statuts, pour finaliser `INTERNAL_TO_CLIENT`.
- **Excel** : en attendant l'ERP, export automatique de chaque demande vers le classeur de suivi (une ligne par
  référence/version), et relecture d'une colonne « statut » pour mettre à jour l'espace client.
  **À fournir** : le classeur actuel (colonnes utilisées).
- **Drive** : un dossier par référence (`DEV-…`) avec les pièces jointes du client, le patron DXF, le STEP
  et le PDF du devis définitif. **À fournir** : le Drive utilisé (Google, OneDrive…) et l'arborescence souhaitée.

## Données personnelles (RGPD)

- Seul l'e-mail est obligatoire ; le reste est facultatif.
- Mention d'information affichée sous le formulaire ; prévoir la page « politique de confidentialité ».
- Conservation des demandes non transformées : durée à fixer (ex. 3 ans) ; suppression sur demande du client.
