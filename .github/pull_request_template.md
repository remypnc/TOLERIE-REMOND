## Ce qui change

<!-- En quelques lignes, en français. -->

## Comment le tester

<!-- Sur la preview Vercel de cette PR : quoi taper dans le chat, quel bouton, quel résultat attendu. -->

## Vérifications

- [ ] `npm test`, `npm run lint`, `npm run build` passent (dans `TOLERIE/devis-3d`)
- [ ] Aucun secret ni donnée client réelle
- [ ] Nouveau produit ou réglage : reconnu dans le chat (cas ajouté à `tests/run.ts`)
- [ ] `api/*.js` régénérés si `server/ai.ts` ou `server/vercel/` ont changé
