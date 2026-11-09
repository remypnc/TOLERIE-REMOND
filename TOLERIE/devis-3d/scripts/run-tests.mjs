// Lance tests/run.ts : regroupé par rolldown (imports du front sans extension), puis exécuté par Node.
import { build } from 'rolldown';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const out = resolve('node_modules/.tmp/tests.mjs');
await build({ input: 'tests/run.ts', platform: 'node', output: { file: out, format: 'esm' }, logLevel: 'warn' });
await import(pathToFileURL(out).href);
