# Travailler à plusieurs : branches et pull requests

Rémy et les agents Claude travaillent **en parallèle**, chacun sur sa branche. `main` est la version en
ligne : Vercel la redéploie à chaque merge. Personne ne pousse directement sur `main`.

## Une fois par copie du dépôt

```bash
git config core.hooksPath .githooks   # garde-fou : refuse les push directs sur main
```

(La protection de `main` côté GitHub demande l'offre GitHub Pro pour un dépôt privé : en attendant, ce
garde-fou local et la règle de `CLAUDE.md` font foi. Rémy seul peut passer outre : `ALLOW_MAIN_PUSH=1`.)

## Le cycle

```bash
git checkout main && git pull                   # partir de la dernière version en ligne
git checkout -b ia/lecture-pdf                  # une branche par sujet
# … modifications …
cd TOLERIE/devis-3d && npm test && npm run lint && npm run build
git add -A && git commit -m "IA : lecture des plans PDF joints"
git push -u origin ia/lecture-pdf
gh pr create --fill                             # ou sur github.com
```

1. **Une branche = un sujet**, assez petit pour être relu en quelques minutes.
2. **Ouvrir la PR tôt** (en brouillon si besoin) : Vercel crée une **preview** (une URL de test par PR)
   et GitHub lance les vérifications automatiques (`.github/workflows/ci.yml`).
3. **Relecture** : Rémy (ou un autre agent) relit, teste la preview, commente.
4. **Merge** quand les vérifications sont vertes et la preview validée → mise en ligne automatique.
5. Supprimer la branche après le merge.

## Nommer les branches

| Préfixe | Pour | Exemple |
|---|---|---|
| `ia/` | Assistant, connexion Claude, lecture des fichiers clients | `ia/lecture-step` |
| `data/` | Données métier pour l'IA (catalogue, tarifs, exemples de devis) | `data/devis-2025` |
| `produit/` | Nouveau produit 3D ou amélioration d'un produit | `produit/vestiaire` |
| `ui/` | Interface, textes, design | `ui/etapes-mobile` |
| `fix/` | Correction de bug | `fix/tremie-cone` |
| `site/` | Refonte du site vitrine | `site/page-banques-accueil` |
| `docs/` | Documentation | `docs/contexte-agents` |

Pour savoir qui fait quoi, ajouter son prénom ou l'agent : `ia/lecture-pdf-remy`, `data/catalogue-agent2`.

## Éviter les conflits entre branches parallèles

- Rester sur son sujet : ne pas reformater ni « nettoyer » des fichiers hors du sujet de la branche.
- `src/lib/products.ts` et `src/App.tsx` sont gros et très partagés : y faire des modifications
  localisées, et rebaser souvent (`git fetch && git rebase origin/main`).
- Les données de l'IA vont dans `TOLERIE/devis-3d/knowledge/` (un fichier par sujet) : plusieurs agents
  peuvent en ajouter sans se gêner.
- Les fichiers générés `api/*.js` : les régénérer après rebase (`npm run build:api`) plutôt que résoudre
  le conflit à la main.

## Ce qu'une PR doit contenir

- Un titre clair en français, la description de ce qui change et comment le tester sur la preview.
- Les vérifications vertes (`npm test`, `npm run lint`, `npm run build`).
- Pour un nouveau produit : sa reconnaissance dans le chat (ajouter un cas à `tests/run.ts`).
- Aucun secret, aucune donnée client réelle.

## Réglages de l'environnement

Variables Vercel (Settings → Environment Variables), jamais dans le code :

| Variable | Rôle |
|---|---|
| `ANTHROPIC_API_KEY` | Clé de l'API Claude (clé d'espace de travail, `sk-ant-api03-…`) |
| `ANTHROPIC_WORKSPACE_ID` | Seulement si la clé n'est pas rattachée à un espace de travail |
| `ASSISTANT_MODEL` | Facultatif, modèle utilisé (par défaut `claude-opus-5-5`) |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Captcha Cloudflare Turnstile de l'assistant IA (désactivé si absentes) |

Hébergement, domaine `devis.`, migration vers les comptes de l'entreprise : `TOLERIE/PLAN-HEBERGEMENT-ET-REFONTE.md`.

En local : `TOLERIE/devis-3d/server/.env` (modèle : `server/.env.example`).
