// Construit les fonctions Vercel (dossier api/) à partir de server/vercel/*.ts : un fichier JS par route,
// le code de l'assistant inclus, les paquets npm laissés en dépendances (installés par Vercel).
import { build } from 'rolldown';

for (const name of ['assistant', 'health']) {
  await build({
    input: `server/vercel/${name}.ts`,
    platform: 'node',
    external: [/^@anthropic-ai\//, /^zod/],
    output: { file: `api/${name}.js`, format: 'esm' },
    logLevel: 'warn',
  });
}
console.log('api/assistant.js, api/health.js construits');
