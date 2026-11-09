// Assistant par IA générative : la page envoie l'état de la pièce et le catalogue, le serveur interroge Claude,
// la réponse structurée est contrôlée ici (bornes, clés connues) avant d'être appliquée. Sans IA : moteur de règles.
import type { AssistantTurn, ChatMessage, CustomPanel, MissingField, PartSpec, ProductKind } from './types';
import { FINISHES, MATERIALS } from './catalog';
import { missingFields, simplePatch } from './assistant';
import { newProduct, panelsNamed, productModel, PRODUCTS } from './products';

let available: Promise<boolean> | null = null;
/** L'IA est-elle branchée côté serveur (clé API présente) ? Vérifié une fois. */
export function aiAvailable(): Promise<boolean> {
  available ??= fetch('/api/health').then((r) => (r.ok ? r.json() : {})).then((h: { ai?: boolean }) => !!h.ai).catch(() => false);
  return available;
}

/** Ce que l'IA doit savoir : la pièce actuelle, ce qui manque, le catalogue des produits et des matières. */
function context(spec: PartSpec, answered: MissingField[]): string {
  const { product, imported, ...part } = spec;
  return JSON.stringify({
    piece: product ? { produit: product } : imported ? { fichierImporte: imported.name, encombrement: imported.size } : part,
    manque: missingFields(spec, answered),
    produits: Object.values(PRODUCTS).map((d) => ({
      cle: d.kind,
      nom: d.label,
      encombrement: d.limits,
      reglages: d.params.map((p) => ({ cle: p.key, nom: p.label, type: p.type, min: p.min, max: p.max, unite: p.unit, choix: p.choices?.map((c) => ({ valeur: c.value, nom: c.label })) })),
    })),
    matieres: Object.values(MATERIALS).map((m) => ({ cle: m.id, nom: m.label, epaisseurs: m.thicknesses })),
    finitions: Object.values(FINISHES).map((f) => ({ cle: f.id, nom: f.label })),
  });
}

interface AiOut {
  reply: string;
  choices: string[];
  target: 'keep' | 'simple' | 'product' | 'custom';
  simple: Parameters<typeof simplePatch>[1];
  product: { kind: string | null; width: number | null; height: number | null; depth: number | null; options: { key: string; number: number | null; flag: boolean | null; choice: string | null }[]; panelColors: { panel: string; ral: string }[] };
  custom: { label: string; panels: { label: string; size: number[]; at: number[]; rot: number[]; look: CustomPanel['look']; bends: number }[] } | null;
  material: PartSpec['material'] | null;
  thickness: number | null;
  finish: PartSpec['finish'] | null;
  ral: string | null;
  quantity: number | null;
  cadProvided: boolean | null;
  cadDeliver: boolean | null;
  answered: MissingField[];
}

const clamp = (v: number, [a, b]: [number, number]) => Math.min(b, Math.max(a, v));

/** Réponse de l'IA → modification sûre de la pièce (valeurs bornées, clés inconnues ignorées). */
function toTurn(spec: PartSpec, out: AiOut, answeredBefore: MissingField[]): { turn: AssistantTurn; answered: MissingField[] } {
  let patch: Partial<PartSpec> = {};
  if (out.target === 'product') {
    const kind = (out.product.kind && out.product.kind in PRODUCTS ? out.product.kind : spec.product?.kind) as ProductKind | undefined;
    if (kind) {
      const def = PRODUCTS[kind];
      const fresh = kind !== spec.product?.kind;
      const p = fresh ? newProduct(kind) : { ...spec.product!, options: { ...spec.product!.options } };
      if (out.product.width) p.width = clamp(out.product.width, def.limits.width);
      if (out.product.height) p.height = clamp(out.product.height, def.limits.height);
      if (out.product.depth) p.depth = clamp(out.product.depth, def.limits.depth);
      for (const o of out.product.options) {
        const prm = def.params.find((x) => x.key === o.key);
        if (!prm) continue;
        if (prm.type === 'bool' && o.flag !== null) p.options[o.key] = o.flag;
        if (prm.type === 'number' && o.number !== null) p.options[o.key] = Math.round(clamp(o.number, [prm.min ?? 0, prm.max ?? 1e6]));
        if (prm.type === 'choice' && o.choice && prm.choices?.some((c) => c.value === o.choice)) p.options[o.key] = o.choice;
      }
      // Couleurs par partie : le mot désigne les panneaux (« rideau », « porte »), le RAL est contrôlé (4 chiffres).
      for (const c of out.product.panelColors) {
        const ral = /^\d{4}$/.test(c.ral) ? c.ral : undefined;
        const ids = ral ? panelsNamed(productModel(p, spec.thickness), c.panel).ids : [];
        if (ids.length) p.colors = { ...(p.colors ?? {}), ...Object.fromEntries(ids.map((id) => [id, ral!])) };
      }
      patch = { ...(fresh ? def.start : {}), product: p, imported: undefined, name: def.label, width: p.width, depth: p.depth, flanges: [], holes: [], cuts: [], fillets: [] };
    }
  } else if (out.target === 'custom' && out.custom?.panels.length) {
    // Objet dessiné par l'IA : panneaux bornés (taille, position, rotation, aspect connu), 150 au plus.
    const v3 = (a: number[], lo: number, hi: number, def: number) => [0, 1, 2].map((i) => (Number.isFinite(a[i]) ? Math.min(hi, Math.max(lo, a[i])) : def)) as [number, number, number];
    const looks: CustomPanel['look'][] = ['tole', 'bois', 'verre', 'noir', 'galva', 'interieur', 'blanc'];
    const panels: CustomPanel[] = out.custom.panels.slice(0, 150).map((q, i) => ({
      id: `p${i}`,
      label: q.label.slice(0, 60) || `Panneau ${i + 1}`,
      size: v3(q.size, 0.5, 6000, 100),
      at: v3(q.at, -6000, 6000, 0),
      rot: v3(q.rot ?? [], -180, 180, 0),
      look: looks.includes(q.look) ? q.look : 'tole',
      sheet: q.look === 'tole' || q.look === 'galva' ? { bends: Math.max(0, Math.min(8, Math.round(q.bends || 0))), returns: 20 } : undefined,
    }));
    const ext = (k: 0 | 1 | 2) => Math.max(...panels.map((q) => q.at[k] + q.size[k] / 2)) - Math.min(...panels.map((q) => q.at[k] - q.size[k] / 2));
    const label = out.custom.label.slice(0, 60) || 'Objet sur mesure';
    const p = { kind: 'libre' as const, width: Math.round(ext(0)), height: Math.round(ext(1)), depth: Math.round(ext(2)), options: {}, custom: { label, panels } };
    patch = { ...(spec.product?.kind === 'libre' ? {} : PRODUCTS.libre.start), product: p, imported: undefined, name: label, width: p.width, depth: p.depth, flanges: [], holes: [], cuts: [], fillets: [] };
  } else if (out.target === 'simple') patch = simplePatch(spec, out.simple);
  if (out.material && out.material in MATERIALS) patch.material = out.material;
  if (out.thickness && out.thickness >= 0.5 && out.thickness <= 10) patch.thickness = out.thickness;
  if (out.finish && out.finish in FINISHES) patch.finish = out.finish;
  if (out.ral) patch.ral = out.ral.replace(/\D/g, '').slice(0, 4) || undefined;
  if (out.quantity && out.quantity >= 1) patch.quantity = Math.min(100000, Math.round(out.quantity));
  // Fichiers fournis : décidé par le fichier joint, jamais par la conversation ; la livraison des fichiers peut se demander.
  if (out.cadDeliver !== null) patch.cad = { ...spec.cad, deliver: out.cadDeliver };
  const answered = [...new Set([...answeredBefore, ...out.answered, ...(patch.product && !spec.product ? (['shape'] as MissingField[]) : [])])];
  const missing = missingFields({ ...spec, ...patch }, answered);
  const choices = out.choices.slice(0, 5).map((c) => ({ label: c.slice(0, 40), value: c }));
  if (!missing.length) choices.unshift({ label: 'Voir la preview', value: '__preview__' });
  const message: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', text: out.reply, choices, allowCustom: true, asks: missing[0] };
  return { turn: { message, patch, missing }, answered: out.answered };
}

/** Un tour avec l'IA ; null si elle n'est pas disponible ou a échoué (la page bascule alors sur les règles). */
export async function askAi(spec: PartSpec, history: ChatMessage[], answered: MissingField[], text: string) {
  try {
    const r = await fetch('/api/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, context: context(spec, answered), history: history.slice(-12).map((m) => ({ role: m.role, text: m.text })) }),
    });
    if (!r.ok) return null;
    return toTurn(spec, (await r.json()) as AiOut, answered);
  } catch {
    return null;
  }
}
