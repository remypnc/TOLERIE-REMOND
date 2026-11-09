# Tôlerie Rémond

- `TOLERIE/devis-3d/` : devis en ligne 3D (React + Vite), assistant IA, back-office. Voir son README.
- `CLAUDE.md` : règles pour les agents. `CONTRIBUTING.md` : branches et pull requests.
- `TOLERIE/site-refonte/` : plan de refonte du site tolerie-remond.com (WordPress → nouveau site).

## Mise en ligne (Vercel)

Projet Vercel relié à ce dépôt, **Root Directory = `TOLERIE/devis-3d`** (le reste est dans `vercel.json`).
Variables d'environnement Vercel : `ANTHROPIC_API_KEY` (et `ANTHROPIC_WORKSPACE_ID` si la clé n'est pas
rattachée à un espace de travail). Sans clé, le devis fonctionne avec son moteur de règles.

## Vérifier avant de pousser

```bash
cd TOLERIE/devis-3d && npm ci && npm test && npm run lint && npm run build
```
