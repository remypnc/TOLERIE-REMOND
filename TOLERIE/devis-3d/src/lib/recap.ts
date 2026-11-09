// Récapitulatif lisible d'une pièce (carte dans le chat) et versions successives de la pièce.
import type { Edge, PartSpec } from './types';
import { FINISHES, MATERIALS } from './catalog';
import { HARDWARE_LABEL, hardwareList } from './hardware';
import { PRODUCTS, productRecap } from './products';

const fr = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const SIDE: Record<Edge, string> = { nord: 'arrière', sud: 'avant', est: 'droite', ouest: 'gauche' };
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

const cadText = (spec: PartSpec) =>
  [spec.cad?.provided && 'fournis par le client', spec.cad?.deliver && 'à livrer (STEP, DXF, plans)'].filter(Boolean).join(' · ') || null;

/** Lignes du récapitulatif, dans l'ordre où un technicien les lirait. */
export function specRecap(spec: PartSpec): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  if (spec.imported) {
    const im = spec.imported;
    out.push({ label: 'Fichier', value: `${im.name} (${im.format})` });
    out.push({ label: 'Encombrement', value: im.size.map((v) => fr(v)).join(' × ') + ' mm' });
    if (!im.profile) out.push({ label: 'Plis estimés', value: String(im.bends) });
    out.push({ label: 'Matière', value: `${MATERIALS[spec.material]?.label ?? spec.material}, ép. ${fr(spec.thickness)} mm` });
    out.push({ label: 'Finition', value: `${FINISHES[spec.finish]?.label ?? spec.finish}${spec.ral ? ` RAL ${spec.ral}` : ''}` });
    out.push({ label: 'Quantité', value: plural(spec.quantity, 'pièce') });
    return out;
  }
  if (spec.product) {
    out.push(...productRecap(spec.product));
    out.push({ label: 'Matière', value: `${MATERIALS[spec.material]?.label ?? spec.material}, ép. ${fr(spec.thickness)} mm` });
    out.push({ label: 'Finition', value: `${FINISHES[spec.finish]?.label ?? spec.finish}${spec.ral ? ` RAL ${spec.ral}` : ''}` });
    if (cadText(spec)) out.push({ label: 'Fichiers CAO', value: cadText(spec)! });
    out.push({ label: 'Quantité', value: plural(spec.quantity, 'exemplaire') });
    return out;
  }
  out.push({ label: 'Base', value: `${fr(spec.width)} × ${fr(spec.depth)} mm` });
  if (spec.flanges.length) {
    const flanges = spec.flanges.map((f) => `${SIDE[f.edge]} ${fr(f.height)} mm${f.angle !== 90 ? ` à ${fr(f.angle)}°` : ''}`);
    out.push({ label: spec.flanges.length > 1 ? 'Ailes' : 'Aile', value: flanges.join(' · ') });
    out.push({ label: 'Rayon de pliage', value: `R${fr(spec.innerRadius ?? spec.thickness)} mm (intérieur)` });
  }
  out.push({ label: 'Matière', value: `${MATERIALS[spec.material]?.label ?? spec.material}, ép. ${fr(spec.thickness)} mm` });
  if (spec.holes.length) {
    const sizes = [...new Set(spec.holes.map((h) => h.diameter))].sort((a, b) => a - b).map((d) => `Ø${fr(d)}`);
    out.push({ label: 'Perçages', value: `${spec.holes.length} × ${sizes.join(', ')}` });
  }
  const hw = hardwareList(spec);
  if (hw.length) out.push({ label: 'Inserts / taraudages', value: hw.map((x) => `${x.count} × ${HARDWARE_LABEL[x.kind].toLowerCase()} ${x.thread}`).join(', ') });
  if (spec.cuts?.length) out.push({ label: 'Découpes', value: plural(spec.cuts.length, 'découpe droite') });
  if (spec.fillets?.length) {
    const radii = [...new Set(spec.fillets.map((f) => f.radius))].sort((a, b) => a - b).map((r) => `R${fr(r)}`);
    out.push({ label: 'Angles arrondis', value: `${spec.fillets.length} × ${radii.join(', ')}` });
  }
  out.push({ label: 'Finition', value: `${FINISHES[spec.finish]?.label ?? spec.finish}${spec.ral ? ` RAL ${spec.ral}` : ''}` });
  if (cadText(spec)) out.push({ label: 'Fichiers CAO', value: cadText(spec)! });
  out.push({ label: 'Quantité', value: plural(spec.quantity, 'pièce') });
  return out;
}

// --- Versions ---------------------------------------------------------------------------------

export interface PartVersion {
  n: number;
  at: string;
  label: string;
  spec: PartSpec;
}

/** Ce qui définit la pièce elle-même (la quantité relève de la commande, pas d'une version). */
const geometryKey = ({ quantity: _q, name: _n, ...rest }: PartSpec) => JSON.stringify(rest);
export const sameGeometry = (a: PartSpec, b: PartSpec) => geometryKey(a) === geometryKey(b);

/** Résumé court de ce qui a changé entre deux versions, ex. « Aile droite 60 mm ». */
export function versionLabel(prev: PartSpec | null, next: PartSpec): string {
  if (!prev) return `${next.name} créée`;
  const changes: string[] = [];
  if (next.product) {
    const p = next.product;
    if (prev.product?.kind !== p.kind) changes.push(`${PRODUCTS[p.kind].label} créé`);
    else {
      if (prev.product.width !== p.width || prev.product.height !== p.height || prev.product.depth !== p.depth) changes.push(`Encombrement ${fr(p.width)} × ${fr(p.height)} × ${fr(p.depth)}`);
      const opt = PRODUCTS[p.kind].params.find((x) => prev.product!.options[x.key] !== p.options[x.key]);
      if (opt) changes.push(`${opt.label} : ${typeof p.options[opt.key] === 'boolean' ? (p.options[opt.key] ? 'oui' : 'non') : fr(Number(p.options[opt.key]))}`);
    }
    if (prev.material !== next.material) changes.push(MATERIALS[next.material]?.label.split(' (')[0] ?? next.material);
    if (prev.thickness !== next.thickness) changes.push(`Épaisseur ${fr(next.thickness)} mm`);
    if (prev.finish !== next.finish || prev.ral !== next.ral) changes.push(`Finition ${FINISHES[next.finish]?.label.toLowerCase() ?? next.finish}`);
    return changes.slice(0, 2).join(' · ') || 'Modification';
  } else if (prev.product) changes.push(`Forme : ${next.name}`);
  if (prev.name !== next.name && !next.product && !prev.product && prev.flanges.length !== next.flanges.length) changes.push(`Forme : ${next.name}`);
  if (prev.width !== next.width || prev.depth !== next.depth) changes.push(`Base ${fr(next.width)} × ${fr(next.depth)}`);
  const flangeKey = (s: PartSpec) => JSON.stringify(s.flanges);
  if (flangeKey(prev) !== flangeKey(next) && prev.flanges.length === next.flanges.length) {
    const f = next.flanges.find((x, i) => JSON.stringify(x) !== JSON.stringify(prev.flanges[i]));
    if (f) changes.push(`Aile ${SIDE[f.edge]} ${fr(f.height)} mm${f.angle !== 90 ? ` à ${fr(f.angle)}°` : ''}`);
  }
  if ((prev.innerRadius ?? prev.thickness) !== (next.innerRadius ?? next.thickness)) changes.push(`Rayon de pliage R${fr(next.innerRadius ?? next.thickness)}`);
  if (prev.material !== next.material) changes.push(MATERIALS[next.material]?.label.split(' (')[0] ?? next.material);
  if (prev.thickness !== next.thickness) changes.push(`Épaisseur ${fr(next.thickness)} mm`);
  const count = (a: unknown[] | undefined, b: unknown[] | undefined, word: string, fem = false) => {
    const x = a?.length ?? 0;
    const y = b?.length ?? 0;
    const e = fem ? 'e' : '';
    if (y > x) changes.push(y - x === 1 ? `1 ${word} ajouté${e}` : `${y - x} ${word}s ajouté${e}s`);
    else if (y < x) changes.push(x - y === 1 ? `1 ${word} retiré${e}` : `${x - y} ${word}s retiré${e}s`);
    else if (JSON.stringify(a ?? []) !== JSON.stringify(b ?? [])) changes.push(`${word.charAt(0).toUpperCase() + word.slice(1)}s modifié${e}s`);
  };
  count(prev.holes, next.holes, 'perçage');
  count(prev.cuts, next.cuts, 'découpe', true);
  count(prev.fillets, next.fillets, 'arrondi');
  if (prev.finish !== next.finish || prev.ral !== next.ral) changes.push(`Finition ${FINISHES[next.finish]?.label.toLowerCase() ?? next.finish}`);
  if (!changes.length) return 'Modification';
  return changes.length > 2 ? `${changes.slice(0, 2).join(' · ')} +${changes.length - 2}` : changes.join(' · ');
}
