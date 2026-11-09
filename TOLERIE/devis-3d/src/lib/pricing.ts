// Chiffrage d'un lot de pièces : matière, programmation, laser, pliage, finition, contrôle, livraison.
import { HARDWARE_LABEL, HARDWARE_SETUP, HARDWARE_UNIT_PRICE, hardwareList } from './hardware';
import {
  BEND_HANDLING_S,
  BEND_SETUP_MIN,
  BEND_TIME_S,
  CAD_BASE_MIN,
  CAD_PER_BEND_MIN,
  CAD_PER_HOLE_MIN,
  CAD_RATE_PER_HOUR,
  DEFAULT_DELIVERY_ZONE,
  DELIVERY_ZONES,
  deliveryZoneFor,
  FINISHES,
  FINISH_MIN_AREA_M2,
  LASER_MIN_CHARGE,
  LASER_RATE_PER_HOUR,
  LASER_SHEET_HANDLING_MIN,
  LASER_SPEED_STEEL,
  LEAD_TIME_BASE_DAYS,
  LEAD_TIME_FINISH_DAYS,
  LEAD_TIME_MAX_DAYS,
  MATERIALS,
  MAX_UNIT_PRICE_RATIO,
  OVERSIZE_MATERIAL_FACTOR,
  PACKAGING_MASS_RATE,
  PIERCE_TIME_BASE_S,
  PIERCE_TIME_PER_MM_S,
  PRESS_BRAKE_RATE_PER_HOUR,
  PROTOTYPE_FEE,
  QC_PER_PART,
  QC_SETUP,
  SCRAP_RESTOCK_RATE,
  SERIES_COEFFICIENTS,
  SERIES_REFERENCE_QTY,
  TECHNICAL_SCRAP_RATE,
  TIER_QUANTITIES,
  VAT_RATE,
} from './catalog';
import { nest } from './nesting';
import { cadLines } from './cad';
import type { DeliveryZone } from './catalog';
import type { FlatPattern, PartSpec, PriceLine, PriceTier, Quote } from './types';

const eur = (v: number): number => Math.round(v * 100) / 100;
const fr = (v: number, digits = 2): string => v.toFixed(digits).replace('.', ',');

function seriesCoef(qty: number): number {
  let coef = 1;
  for (const s of SERIES_COEFFICIENTS) if (qty >= s.minQty) coef = s.coef;
  return coef;
}

/** Vitesse de coupe acier interpolée (mm/min). */
function steelSpeed(t: number): number {
  const table = LASER_SPEED_STEEL;
  if (t <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [t1, v1] = table[i];
    if (t <= t1) {
      const [t0, v0] = table[i - 1];
      return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    }
  }
  const [tl, vl] = table[table.length - 1];
  return (vl * tl) / t;
}

/** Où livrer : code postal (zone de prix), ou retrait à l'atelier. */
export interface Delivery {
  zip?: string;
  city?: string;
  pickup?: boolean;
}

/** Zone retenue et libellé lisible, ex. « Livraison 75011 Paris · France métropolitaine ». */
export function deliveryInfo(d?: Delivery): { zone: DeliveryZone | null; label: string; known: boolean } {
  if (d?.pickup) return { zone: null, label: 'Retrait à l’atelier (Crépand, 21)', known: true };
  const zone = deliveryZoneFor(d?.zip);
  if (zone) return { zone, label: `${d!.zip}${d?.city ? ` ${d.city}` : ''} · ${zone.label}`, known: true };
  const def = DELIVERY_ZONES.find((z) => z.id === DEFAULT_DELIVERY_ZONE) ?? DELIVERY_ZONES[0];
  return { zone: def, label: `${def.label} (estimation : adresse de livraison à préciser)`, known: false };
}

export function deliveryPrice(kg: number, zone: DeliveryZone | null = DELIVERY_ZONES.find((z) => z.id === DEFAULT_DELIVERY_ZONE) ?? DELIVERY_ZONES[0]): number {
  if (!zone) return 0;
  for (const b of zone.brackets) if (kg <= b.maxKg) return b.price;
  const last = zone.brackets[zone.brackets.length - 1];
  return last.price + (kg - last.maxKg) * zone.extraPerKg;
}

interface LotCost {
  lines: PriceLine[];
  subtotal: number;
}

/** Livraison : hors plafond dégressif, elle dépend seulement du poids et de l'adresse. */
export function deliveryLine(mass: number, qty: number, delivery?: Delivery): PriceLine {
  const shipKg = mass * qty * (1 + PACKAGING_MASS_RATE);
  const where = deliveryInfo(delivery);
  return {
    id: 'livraison',
    label: delivery?.pickup ? 'Emballage (retrait à l’atelier)' : 'Emballage et livraison',
    detail: `${where.label} · ${fr(shipKg, 1)} kg emballé`,
    amount: eur(delivery?.pickup ? 0 : deliveryPrice(shipKg, where.zone)),
  };
}

/** Coût de fabrication du lot (sans la livraison). */
function lotCost(spec: PartSpec, flat: FlatPattern, qty: number): LotCost {
  const material = MATERIALS[spec.material];
  const finish = FINISHES[spec.finish];
  const t = spec.thickness;
  const bends = flat.bendLines.length;
  const holes = spec.holes.length;
  const coef = seriesCoef(qty);
  const nesting = nest(flat, qty, material, t);
  const lines: PriceLine[] = [];

  // Matière : tôles achetées, reprise partielle des chutes réutilisables.
  let materialAmount: number;
  let materialDetail: string;
  if (nesting.perSheet > 0) {
    const bought = nesting.sheetMass;
    const reusable = Math.max(nesting.scrapMass - TECHNICAL_SCRAP_RATE * bought, 0);
    const billedKg = bought - SCRAP_RESTOCK_RATE * reusable;
    materialAmount = billedKg * material.pricePerKg;
    materialDetail =
      `${nesting.sheets} tôle${nesting.sheets > 1 ? 's' : ''} ${nesting.sheet.label} ép. ${fr(t, 1)} mm` +
      ` (${nesting.perSheet} pièce${nesting.perSheet > 1 ? 's' : ''}/tôle, utilisation ${fr(nesting.utilisation * 100, 0)} %)` +
      ` · ${fr(bought, 1)} kg achetés, ${fr(billedKg, 1)} kg facturés après reprise chutes · ${fr(material.pricePerKg)} €/kg`;
  } else {
    const kg = flat.mass * qty * OVERSIZE_MATERIAL_FACTOR;
    materialAmount = kg * material.pricePerKg;
    materialDetail = `Pièce hors format standard (flan ${fr(flat.blankWidth, 0)} × ${fr(flat.blankHeight, 0)} mm) · tôle sur mesure ${fr(kg, 1)} kg`;
  }
  lines.push({ id: 'matiere', label: `Matière ${material.label}`, detail: materialDetail, amount: eur(materialAmount) });

  // Programmation CAO / FAO : forfait unique par lot.
  const cadMin = CAD_BASE_MIN + CAD_PER_BEND_MIN * bends + CAD_PER_HOLE_MIN * holes;
  lines.push({
    id: 'cao',
    label: 'Programmation FAO',
    detail: `Mise à plat, programmes laser et plieuse · ${fr(cadMin, 0)} min à ${CAD_RATE_PER_HOUR} €/h (forfait par lot)`,
    amount: eur((cadMin / 60) * CAD_RATE_PER_HOUR),
  });

  // Découpe laser.
  const speed = steelSpeed(t) * material.cutFactor;
  const cutMinPerPart = flat.cutLength / speed;
  const pierceMinPerPart = (flat.pierces * (PIERCE_TIME_BASE_S + PIERCE_TIME_PER_MM_S * t)) / 60;
  const sheetsHandled = Math.max(nesting.sheets, 1);
  const laserMin = (cutMinPerPart + pierceMinPerPart) * qty * coef + sheetsHandled * LASER_SHEET_HANDLING_MIN;
  const laserAmount = Math.max((laserMin / 60) * LASER_RATE_PER_HOUR, LASER_MIN_CHARGE);
  lines.push({
    id: 'laser',
    label: 'Découpe laser',
    detail:
      `${fr(flat.cutLength / 1000, 2)} m de coupe/pièce à ${fr(speed / 1000, 1)} m/min + ${flat.pierces} amorçage${flat.pierces > 1 ? 's' : ''}` +
      ` · ${fr(laserMin, 1)} min à ${LASER_RATE_PER_HOUR} €/h`,
    amount: eur(laserAmount),
  });

  // Pliage.
  if (bends > 0) {
    const setupMin = BEND_SETUP_MIN * bends;
    const runMin = ((bends * BEND_TIME_S + BEND_HANDLING_S) * qty * coef) / 60;
    lines.push({
      id: 'pliage',
      label: 'Pliage presse plieuse',
      detail: `${bends} pli${bends > 1 ? 's' : ''}/pièce · réglage ${fr(setupMin, 0)} min + ${fr(runMin, 1)} min de production à ${PRESS_BRAKE_RATE_PER_HOUR} €/h`,
      amount: eur(((setupMin + runMin) / 60) * PRESS_BRAKE_RATE_PER_HOUR),
    });
  }

  // Finition.
  if (finish.pricePerM2 > 0 || finish.setup > 0) {
    const m2PerPart = Math.max(flat.area / 1e6, FINISH_MIN_AREA_M2);
    const m2 = m2PerPart * qty;
    const ral = spec.finish === 'epoxy' && spec.ral ? ` RAL ${spec.ral}` : '';
    lines.push({
      id: 'finition',
      label: `Finition ${finish.label}${ral}`,
      detail: `${fr(m2, 2)} m² à ${fr(finish.pricePerM2)} €/m² + lancement ${fr(finish.setup)} €`,
      amount: eur(m2 * finish.pricePerM2 + finish.setup),
    });
  }

  // Sertissage (écrous, goujons) et taraudages.
  const hw = hardwareList(spec);
  if (hw.length) {
    const perPart = hw.reduce((acc, x) => acc + x.count * HARDWARE_UNIT_PRICE[x.kind], 0);
    const n = hw.reduce((acc, x) => acc + x.count, 0);
    lines.push({
      id: 'sertissage',
      label: 'Goujonnage, sertissage et taraudage',
      detail: `${hw.map((x) => `${x.count} × ${HARDWARE_LABEL[x.kind].toLowerCase()} ${x.thread}`).join(', ')} par pièce (${n * qty} au total) + réglage ${fr(HARDWARE_SETUP)} €`,
      amount: eur(perPart * qty + HARDWARE_SETUP),
    });
  }

  // Surcoût prototype.
  if (qty === 1) {
    lines.push({
      id: 'prototype',
      label: 'Surcoût pièce unitaire (prototype)',
      detail: 'Réglages non amortis, contrôle premier article',
      amount: eur(PROTOTYPE_FEE),
    });
  }

  // Contrôle qualité.
  lines.push({
    id: 'controle',
    label: 'Contrôle qualité',
    detail: `Contrôle dimensionnel · forfait ${fr(QC_SETUP)} € + ${fr(QC_PER_PART)} €/pièce`,
    amount: eur(QC_SETUP + QC_PER_PART * qty),
  });

  const subtotal = eur(lines.reduce((acc, l) => acc + l.amount, 0));
  return { lines, subtotal };
}

function leadTime(spec: PartSpec, qty: number): number {
  let days = LEAD_TIME_BASE_DAYS + LEAD_TIME_FINISH_DAYS[spec.finish];
  if (qty > 10) days += 1;
  if (qty > 50) days += 2;
  if (qty > 200) days += 3;
  return Math.min(Math.max(days, LEAD_TIME_BASE_DAYS), LEAD_TIME_MAX_DAYS);
}

/** Plafond de prix unitaire pour une quantité, en multiple du prix unitaire de série. */
function capRatio(qty: number): number {
  if (qty >= SERIES_REFERENCE_QTY) return Infinity;
  const ref = Math.log(SERIES_REFERENCE_QTY);
  return 1 + ((MAX_UNIT_PRICE_RATIO - 1) * (ref - Math.log(qty))) / ref;
}

/**
 * Coût du lot avec plafond dégressif : au-delà du plafond, toutes les lignes sont réduites
 * au prorata (pas de ligne négative visible par le client). À recalibrer sur le modèle de devis réel.
 */
function cappedLot(spec: PartSpec, flat: FlatPattern, qty: number, seriesUnit: number, delivery?: Delivery): LotCost {
  const lot = lotCost(spec, flat, qty);
  const maxTotal = seriesUnit * capRatio(qty) * qty;
  const k = lot.subtotal > maxTotal ? maxTotal / lot.subtotal : 1;
  // Conception CAO et livraison : hors plafond (frais d'étude uniques, transport selon l'adresse).
  const lines: PriceLine[] = [...lot.lines.map((l) => ({ ...l, amount: eur(l.amount * k) })), ...cadLines(spec, flat), deliveryLine(flat.mass, qty, delivery)];
  return { lines, subtotal: eur(lines.reduce((sum, l) => sum + l.amount, 0)) };
}

export function computeQuote(spec: PartSpec, flat: FlatPattern, quantity?: number, delivery?: Delivery): Quote {
  const raw = quantity ?? spec.quantity;
  const qty = Math.max(1, Math.round(Number.isFinite(raw) ? raw : 1));
  const seriesUnit = lotCost(spec, flat, SERIES_REFERENCE_QTY).subtotal / SERIES_REFERENCE_QTY;
  const { lines, subtotal } = cappedLot(spec, flat, qty, seriesUnit, delivery);
  const vat = eur(subtotal * VAT_RATE);
  const tiers: PriceTier[] = TIER_QUANTITIES.map((q) => {
    const total = q === qty ? subtotal : cappedLot(spec, flat, q, seriesUnit, delivery).subtotal;
    return { quantity: q, unitPrice: eur(total / q), total };
  });
  return {
    quantity: qty,
    lines,
    subtotal,
    vat,
    total: eur(subtotal + vat),
    unitPrice: eur(subtotal / qty),
    tiers,
    leadTimeDays: leadTime(spec, qty),
  };
}
