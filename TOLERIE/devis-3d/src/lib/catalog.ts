// Catalogue matières, finitions, formats de tôle et barème atelier (marché France 2026, € HT).
import type { FinishId, FinishInfo, MaterialId, MaterialInfo, SheetFormat } from './types';

const STEEL_THICKNESSES = [0.8, 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
const INOX_THICKNESSES = [0.8, 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8];
const ALU_THICKNESSES = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8];

export const MATERIALS: Record<MaterialId, MaterialInfo> = {
  acier: {
    id: 'acier',
    label: 'Acier S235 laminé à froid / à chaud',
    density: 7.85,
    pricePerKg: 1.3,
    kFactor: 0.33,
    thicknesses: STEEL_THICKNESSES,
    cutFactor: 1,
  },
  galva: {
    id: 'galva',
    label: 'Acier galvanisé DX51D Z275',
    density: 7.85,
    pricePerKg: 1.55,
    kFactor: 0.33,
    thicknesses: STEEL_THICKNESSES,
    cutFactor: 0.95,
  },
  inox304: {
    id: 'inox304',
    label: 'Inox 304L (1.4307)',
    density: 7.93,
    pricePerKg: 4.5,
    kFactor: 0.4,
    thicknesses: INOX_THICKNESSES,
    cutFactor: 0.8,
  },
  inox316: {
    id: 'inox316',
    label: 'Inox 316L (1.4404)',
    density: 7.98,
    pricePerKg: 6.2,
    kFactor: 0.4,
    thicknesses: INOX_THICKNESSES,
    cutFactor: 0.78,
  },
  alu5754: {
    id: 'alu5754',
    label: 'Aluminium 5754 H111',
    density: 2.66,
    pricePerKg: 5,
    kFactor: 0.38,
    thicknesses: ALU_THICKNESSES,
    cutFactor: 0.9,
  },
};

export const FINISHES: Record<FinishId, FinishInfo> = {
  brut: {
    id: 'brut',
    label: 'Brut de découpe / pliage',
    pricePerM2: 0,
    setup: 0,
    compatible: ['acier', 'galva', 'inox304', 'inox316', 'alu5754'],
  },
  epoxy: {
    id: 'epoxy',
    label: 'Thermolaquage époxy-polyester (RAL au choix)',
    pricePerM2: 28,
    setup: 90,
    compatible: ['acier', 'galva', 'inox304', 'inox316', 'alu5754'],
  },
  galvanisation: {
    id: 'galvanisation',
    label: 'Galvanisation à chaud',
    pricePerM2: 22,
    setup: 80,
    compatible: ['acier'],
  },
  brossage: {
    id: 'brossage',
    label: 'Brossage grain 240',
    pricePerM2: 18,
    setup: 40,
    compatible: ['inox304', 'inox316', 'alu5754'],
  },
  anodisation: {
    id: 'anodisation',
    label: 'Anodisation naturelle 15 µm',
    pricePerM2: 35,
    setup: 120,
    compatible: ['alu5754'],
  },
};

export const SHEET_FORMATS: SheetFormat[] = [
  { label: '2000 × 1000', width: 2000, height: 1000 },
  { label: '2500 × 1250', width: 2500, height: 1250 },
  { label: '3000 × 1500', width: 3000, height: 1500 },
  { label: '4000 × 2000', width: 4000, height: 2000 },
];

// ---- Imbrication ---------------------------------------------------------

/** Espacement minimal entre pièces sur la tôle, mm (porté à 2·T si plus grand). */
export const NEST_MIN_GAP = 5;
/** Marge de bord de tôle (prise des pinces / bord non sain), mm. */
export const NEST_MARGIN = 10;

// ---- Matière -------------------------------------------------------------

/** Part de la tôle achetée considérée comme perte technique, jamais reprise. */
export const TECHNICAL_SCRAP_RATE = 0.15;
/** Part de la valeur des chutes réutilisables reprise en stock (déduite de la ligne matière). */
export const SCRAP_RESTOCK_RATE = 0.85;
/** Majoration matière pour une pièce hors format standard (tôle sur mesure). */
export const OVERSIZE_MATERIAL_FACTOR = 1.6;

// ---- Découpe laser -------------------------------------------------------

/** Taux horaire laser fibre 6 kW (machine + opérateur), €/h. */
export const LASER_RATE_PER_HOUR = 150;
/** Vitesse de coupe acier (mm/min) selon l'épaisseur ; multipliée par `cutFactor` de la matière. */
export const LASER_SPEED_STEEL: [thickness: number, mmPerMin: number][] = [
  [0.8, 12000],
  [1, 10000],
  [1.5, 8000],
  [2, 6500],
  [3, 4500],
  [4, 3500],
  [5, 2800],
  [6, 2300],
  [8, 1600],
  [10, 1200],
];
/** Temps d'amorçage : base + par mm d'épaisseur, secondes. */
export const PIERCE_TIME_BASE_S = 0.5;
export const PIERCE_TIME_PER_MM_S = 0.3;
/** Chargement / déchargement d'une tôle sur le laser, minutes. */
export const LASER_SHEET_HANDLING_MIN = 3;
/** Minimum facturé pour la découpe d'un lot, €. */
export const LASER_MIN_CHARGE = 15;

// ---- Pliage --------------------------------------------------------------

/** Taux horaire presse plieuse CN + opérateur, €/h. */
export const PRESS_BRAKE_RATE_PER_HOUR = 85;
/** Réglage (outillage, butées, pli d'essai) par pli distinct, minutes — une fois par lot. */
export const BEND_SETUP_MIN = 12;
/** Temps de pli par pli et par pièce, secondes. */
export const BEND_TIME_S = 25;
/** Manutention par pièce pliée (prise, retournement, dépose), secondes. */
export const BEND_HANDLING_S = 20;

// ---- Programmation / préparation -----------------------------------------

/** Taux horaire bureau d'études / programmation CAO-FAO, €/h. */
export const CAD_RATE_PER_HOUR = 65;
/** Temps de programmation : base, par pli, par perçage, minutes. */
export const CAD_BASE_MIN = 25;
export const CAD_PER_BEND_MIN = 6;
export const CAD_PER_HOLE_MIN = 1;

// ---- Conception CAO et fichiers (frais d'étude uniques, hors programmation FAO) ------------

/** Taux horaire du bureau d'études pour la conception (modélisation 3D, mise en plan), €/h. */
export const DESIGN_RATE_PER_HOUR = 75;
/** Pièce simple : modélisation 3D + mise en plan cotée, minutes (base, par pli, perçage, découpe, arrondi, insert). */
export const DESIGN_PART_MIN = { base: 35, bend: 10, hole: 2, cut: 12, fillet: 4, insert: 4, drawing: 25, drawingPerBend: 6 };
/** Fichiers fournis par le client : reprise (contrôle, mise au format atelier), part du temps de conception. */
export const DESIGN_PROVIDED_RATE = 0.3;
/** Fichiers CAO livrés au client (STEP, DXF, plans PDF, nomenclature) : forfait + part de la conception. */
export const CAD_DELIVERY = { part: 45, product: 180, rate: 0.2 };

// ---- Prototype, contrôle, finition ---------------------------------------

/** Surcoût pièce unitaire (prototype : réglages non amortis, contrôle premier article), €. */
export const PROTOTYPE_FEE = 45;
/** Contrôle qualité : forfait par lot + par pièce, €. */
export const QC_SETUP = 12;
export const QC_PER_PART = 0.6;
/** Surface minimale facturée par pièce en finition, m². */
export const FINISH_MIN_AREA_M2 = 0.05;

// ---- Livraison -----------------------------------------------------------

export interface DeliveryBracket {
  /** Masse maxi du colis, kg. */
  maxKg: number;
  price: number;
}

export interface DeliveryZone {
  id: string;
  label: string;
  brackets: DeliveryBracket[];
  /** Au-delà de la dernière tranche, €/kg supplémentaire. */
  extraPerKg: number;
}

export const DELIVERY_ZONES: DeliveryZone[] = [
  {
    id: 'local',
    label: 'Département / limitrophes',
    brackets: [
      { maxKg: 30, price: 15 },
      { maxKg: 100, price: 35 },
      { maxKg: 300, price: 70 },
    ],
    extraPerKg: 0.2,
  },
  {
    id: 'france',
    label: 'France métropolitaine',
    brackets: [
      { maxKg: 5, price: 14 },
      { maxKg: 30, price: 29 },
      { maxKg: 100, price: 65 },
      { maxKg: 300, price: 140 },
    ],
    extraPerKg: 0.4,
  },
];
export const DEFAULT_DELIVERY_ZONE = 'france';
// Corse : traversée maritime, tarifs à part.
DELIVERY_ZONES.push({
  id: 'corse',
  label: 'Corse',
  brackets: [
    { maxKg: 5, price: 32 },
    { maxKg: 30, price: 69 },
    { maxKg: 100, price: 145 },
    { maxKg: 300, price: 310 },
  ],
  extraPerKg: 0.9,
});

/** Atelier (départ des livraisons, retrait possible sur place). */
export const WORKSHOP_ADDRESS = '13 route de Semur, 21500 Crépand';
/** Côte-d'Or et départements limitrophes : zone locale. */
const LOCAL_DEPARTMENTS = ['21', '89', '58', '71', '39', '70', '52', '10'];

/** Zone de livraison d'un code postal ; null si le code n'est pas un code postal français valide. */
export function deliveryZoneFor(zip: string | undefined): DeliveryZone | null {
  const z = (zip ?? '').replace(/\s/g, '');
  if (!/^\d{5}$/.test(z) || z.startsWith('00') || z.startsWith('96') || z.startsWith('97') || z.startsWith('98') || z.startsWith('99')) return null;
  const dep = z.slice(0, 2);
  const id = dep === '20' ? 'corse' : LOCAL_DEPARTMENTS.includes(dep) ? 'local' : 'france';
  return DELIVERY_ZONES.find((x) => x.id === id) ?? null;
}
/** Emballage : part de la masse ajoutée (carton, palette légère). */
export const PACKAGING_MASS_RATE = 0.1;

// ---- Coefficients de série -----------------------------------------------

/**
 * Coefficient appliqué aux temps machine selon la quantité (effet d'apprentissage,
 * enchaînement sans arrêt). Tranche retenue : la plus grande `minQty` ≤ quantité.
 */
export const SERIES_COEFFICIENTS: { minQty: number; coef: number }[] = [
  { minQty: 1, coef: 1 },
  { minQty: 5, coef: 0.95 },
  { minQty: 10, coef: 0.9 },
  { minQty: 20, coef: 0.85 },
  { minQty: 50, coef: 0.8 },
  { minQty: 100, coef: 0.75 },
];

/** Quantités affichées dans la grille dégressive. */
export const TIER_QUANTITIES = [1, 10, 20, 50];
/** Taux de TVA. */
export const VAT_RATE = 0.2;

// ---- Délais --------------------------------------------------------------

export const LEAD_TIME_BASE_DAYS = 5;
export const LEAD_TIME_MAX_DAYS = 15;
export const LEAD_TIME_FINISH_DAYS: Record<FinishId, number> = {
  brut: 0,
  epoxy: 4,
  galvanisation: 6,
  brossage: 2,
  anodisation: 5,
};

// ---- Plafond dégressif ---------------------------------------------------

/** Quantité de référence « série » pour le plafond dégressif. */
export const SERIES_REFERENCE_QTY = 50;
/**
 * Règle commerciale : le prix unitaire d'une pièce seule ne dépasse pas ce multiple du
 * prix unitaire en série (référence 50 pcs). Entre 1 et 50, le plafond décroît
 * logarithmiquement ; l'excédent de frais fixes est remis via une ligne « Remise ».
 */
export const MAX_UNIT_PRICE_RATIO = 2.8;
