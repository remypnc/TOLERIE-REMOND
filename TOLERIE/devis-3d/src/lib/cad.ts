// Conception CAO : modélisation 3D, mise en plan cotée et fichiers livrés. Ce sont des frais d'étude
// uniques (non récurrents) : ils ne dépendent pas de la quantité, mais pèsent lourd sur une petite série.
// La programmation FAO (laser, plieuse) reste comptée à part dans la fabrication.
import type { FlatPattern, PartSpec, PriceLine, ProductKind } from './types';
import { CAD_DELIVERY, DESIGN_PART_MIN, DESIGN_PROVIDED_RATE, DESIGN_RATE_PER_HOUR } from './catalog';
import { hardwareList } from './hardware';
import { productModel } from './products';

/** Produits assemblés : heures de conception de base (structure, ouvrants, intégration des équipements). */
const PRODUCT_BASE_H: Record<ProductKind, number> = {
  armoire: 8, locker: 12, photomaton: 22, pharmacie: 30, cabine: 18, kiosque: 14,
  distributeur: 24, recharge: 12, boites: 8, baie: 10, horodateur: 14, carter: 16,
  fauteuil: 6, libre: 10,
  banque: 14, bar: 12, etagere: 4, meubleTiroirs: 8, vitrine: 8, table: 4, salleAttente: 8, bacFleurs: 3, pergola: 16, porte: 8,
  borneSonore: 10, gel: 5, tri: 6, caveVin: 5, lampe: 4, supportMenu: 3, chariot: 4, grille: 3, tremie: 8, marche: 4, tolePerforee: 1.5, cassette: 6,
};

const eur = (v: number) => Math.round(v * 100) / 100;
const fr = (v: number, d = 1) => v.toLocaleString('fr-FR', { maximumFractionDigits: d });

/** Heures de conception complète (modélisation + mise en plan), avant reprise de fichiers client. */
export function designHours(spec: PartSpec, flat: FlatPattern): number {
  if (spec.product) {
    const m = productModel(spec.product, spec.thickness);
    const sheets = m.panels.filter((x) => x.sheet).length;
    const motions = m.motions.filter((x) => !x.auto).length;
    // Modélisation : base + par tôle + par ouvrant (charnières, jeux) ; mise en plan : un plan par tôle + l'ensemble.
    return PRODUCT_BASE_H[spec.product.kind] + sheets * 0.3 + Math.min(motions, 40) * 0.6 + 2 + sheets * 0.15;
  }
  const k = DESIGN_PART_MIN;
  const bends = flat.bendLines.length;
  const inserts = hardwareList(spec).reduce((s, x) => s + x.count, 0);
  const min = k.base + k.bend * bends + k.hole * spec.holes.length + k.cut * (spec.cuts?.length ?? 0) + k.fillet * (spec.fillets?.length ?? 0) + k.insert * inserts + k.drawing + k.drawingPerBend * bends;
  return min / 60;
}

/** Lignes du devis : conception (ou reprise des fichiers du client) et, si demandé, fichiers livrés. */
export function cadLines(spec: PartSpec, flat: FlatPattern): PriceLine[] {
  const full = designHours(spec, flat);
  const provided = !!spec.cad?.provided;
  const h = provided ? Math.max(0.5, full * DESIGN_PROVIDED_RATE) : full;
  const design = eur(h * DESIGN_RATE_PER_HOUR);
  const lines: PriceLine[] = [
    provided
      ? { id: 'conception', label: 'Reprise de vos fichiers CAO', detail: `Contrôle, mise au format atelier · ${fr(h)} h de bureau d’études (frais unique)`, amount: design }
      : { id: 'conception', label: 'Conception CAO', detail: `Modélisation 3D et mise en plan cotée · ${fr(h)} h de bureau d’études à ${DESIGN_RATE_PER_HOUR} €/h (frais unique)`, amount: design },
  ];
  if (spec.cad?.deliver) {
    const base = spec.product ? CAD_DELIVERY.product : CAD_DELIVERY.part;
    lines.push({ id: 'fichiers', label: 'Fichiers CAO livrés', detail: `STEP 3D, DXF des développés, plans PDF${spec.product ? ', nomenclature' : ''} · cession des fichiers`, amount: eur(base + full * DESIGN_RATE_PER_HOUR * CAD_DELIVERY.rate) });
  }
  return lines;
}
