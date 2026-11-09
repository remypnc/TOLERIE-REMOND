// Tests rapides (npm test) : géométrie de tous les produits et compréhension du chat.
import { PRODUCTS, newProduct, productModel, productQuote } from '../src/lib/products';
import { checkModel } from '../src/lib/productCheck';
import { initialSpec, respond } from '../src/lib/assistant';
import { computeQuote } from '../src/lib/pricing';
import { unfold } from '../src/lib/sheetmetal';
import type { PartSpec, ProductKind, ProductSpec } from '../src/lib/types';

let failures = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    failures++;
    console.error(`✗ ${msg}`);
  }
};

// 1. Chaque produit, chaque option basculée, chaque choix : rien ne flotte, ne se croise ni ne traverse.
let models = 0;
for (const k of Object.keys(PRODUCTS) as ProductKind[]) {
  if (k === 'libre') continue;
  const variants: ProductSpec[] = [newProduct(k)];
  for (const prm of PRODUCTS[k].params) {
    if (prm.type === 'bool') { const p = newProduct(k); p.options[prm.key] = !p.options[prm.key]; variants.push(p); }
    if (prm.type === 'choice') for (const c of prm.choices!) { const p = newProduct(k); p.options[prm.key] = c.value; variants.push(p); }
  }
  for (const p of variants) {
    const r = checkModel(productModel(p, 1.5));
    models++;
    ok(!r.floating.length, `${k} : pièces qui flottent ${r.floating.slice(0, 4).join(', ')}`);
    ok(!r.clashes.length, `${k} : tôles qui se croisent ${r.clashes.slice(0, 2).map((x) => x.join('×')).join(', ')}`);
    ok(!r.crossing.length, `${k} : pièces qui traversent ${r.crossing.slice(0, 2).map((x) => x.join('→')).join(', ')}`);
  }
  const spec: PartSpec = { ...initialSpec(), product: newProduct(k), thickness: 1.5 };
  const q = productQuote(spec);
  ok(q.subtotal > 0 && Number.isFinite(q.subtotal), `${k} : prix invalide`);
}

// 2. Pièce simple : un prix cohérent.
const plate = { ...initialSpec(), width: 400, depth: 300 };
ok(computeQuote(plate, unfold(plate)).subtotal > 0, 'plaque : prix invalide');

// 3. Chat : chaque phrase doit donner le produit et les réglages attendus.
const cases: [string[], (s: PartSpec) => boolean][] = [
  [['un locker en coin 4 colonnes', 'finalement je ne veux pas un locker en coin mais juste un locker de face'], (s) => s.product?.kind === 'locker' && s.product.options.angle === false],
  [['une cabine photomaton', 'une banquette collée à droite, l’écran sur le mur de gauche'], (s) => s.product?.options.siege === 'banquette' && s.product.options.siegeCote === 'droite' && s.product.options.priseVue === 'gauche'],
  [['une cabine téléphonique', 'un tabouret rond à gauche, porte en rouge'], (s) => s.product?.options.siege === 'rond' && Object.values(s.product.colors ?? {}).includes('3020')],
  [['je veux un fauteuil allongé en tole plié origami'], (s) => s.product?.kind === 'fauteuil' && s.product.options.allonge === true],
  [['un automate de pharmacie', '8 étagères'], (s) => s.product?.kind === 'pharmacie' && s.product.options.etageres === 8],
  [['une borne interactive 43 pouces'], (s) => s.product?.kind === 'kiosque' && s.product.options.pouces === 43],
  [['une plaque 200 x 100 en rouge'], (s) => !s.product && s.width === 200 && s.ral === '3020'],
];
for (const [msgs, expect] of cases) {
  let spec = initialSpec();
  for (const m of msgs) spec = { ...spec, ...respond({ spec, history: [], answered: [] }, m, []).patch };
  ok(expect(spec), `chat : « ${msgs[msgs.length - 1]} »`);
}

console.log(`${models} modèles contrôlés, ${cases.length} conversations : ${failures ? `${failures} échec(s)` : 'tout est bon'}`);
process.exit(failures ? 1 : 0);
