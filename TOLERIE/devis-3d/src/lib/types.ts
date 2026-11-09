// Modèle de données partagé : pièce de tôlerie, mise à plat, imbrication, prix, conversation.
// Toutes les cotes sont en millimètres, les angles en degrés, les prix en euros HT.

export type MaterialId = 'acier' | 'galva' | 'inox304' | 'inox316' | 'alu5754';
export type FinishId = 'brut' | 'epoxy' | 'galvanisation' | 'brossage' | 'anodisation';

/** Bord de la plaque de base (vue de dessus) : nord = Y max, sud = Y 0, est = X max, ouest = X 0. */
export type Edge = 'nord' | 'sud' | 'est' | 'ouest';

/** Un bord tombé (pli) sur un bord de la base. `height` est la cote EXTÉRIEURE, comme sur un plan client. */
export interface Flange {
  edge: Edge;
  height: number;
  /** Angle de pli, 90 = équerre. Plié vers le haut (+Z). */
  angle: number;
}

/**
 * Face de la pièce : la base, ou l'aile posée sur un bord.
 * Coordonnées sur une face (mm, cotes extérieures) :
 * - base : x depuis le bord gauche (ouest), y depuis le bord avant (sud) ;
 * - aile nord / sud : x depuis le bord gauche, y = hauteur depuis le dessous de la base ;
 * - aile est / ouest : x depuis le bord avant, y = hauteur depuis le dessous de la base.
 */
export type Face = 'base' | Edge;

export type HardwareKind = 'ecrou' | 'goujon' | 'taraudage';
export type Thread = 'M3' | 'M4' | 'M5' | 'M6' | 'M8';
/** Ce qui est posé dans un perçage : écrou ou goujon à sertir, ou taraudage. Le diamètre devient le trou de préparation. */
export interface Hardware {
  kind: HardwareKind;
  thread: Thread;
}

/** Perçage rond. x, y = centre, dans le repère de sa face (base par défaut). */
export interface Hole {
  id: string;
  x: number;
  y: number;
  diameter: number;
  face?: Face;
  hardware?: Hardware;
}

/**
 * Découpe droite d'une face entre deux points (repère de la face). La ligne est prolongée jusqu'aux
 * bords de la face ; on retire le côté qui ne contient pas le centre de la face (ou l'autre si `flip`).
 */
export interface Cut {
  id: string;
  face?: Face;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  flip?: boolean;
}

/**
 * Arrondi d'un angle de face (rayon de congé). Le coin est repéré depuis le bord le plus proche :
 * x depuis la gauche (ou depuis la droite si `fromRight`), y depuis le bas (ou le haut si `fromTop`),
 * pour rester accroché au bon coin quand la pièce change de taille.
 */
export interface Fillet {
  id: string;
  face?: Face;
  x: number;
  y: number;
  fromRight?: boolean;
  fromTop?: boolean;
  radius: number;
}

/** Produits assemblés : plusieurs panneaux de tôle, des mécanismes (portes, trappes…) et un état « en marche ». */
export type ProductKind = 'armoire' | 'locker' | 'photomaton' | 'pharmacie' | 'cabine' | 'kiosque' | 'distributeur' | 'recharge' | 'boites' | 'baie' | 'horodateur' | 'carter'
  | 'fauteuil' | 'libre'
  | 'banque' | 'bar' | 'etagere' | 'meubleTiroirs' | 'vitrine' | 'table' | 'salleAttente' | 'bacFleurs' | 'pergola' | 'porte' | 'borneSonore' | 'gel' | 'tri' | 'caveVin' | 'lampe' | 'supportMenu' | 'chariot' | 'grille' | 'tremie' | 'marche' | 'tolePerforee' | 'cassette';

/** Panneau d'un objet sur mesure : boîte (taille, centre, rotation en degrés), aspect, plis. */
export interface CustomPanel {
  id: string;
  label: string;
  size: [number, number, number];
  at: [number, number, number];
  rot?: [number, number, number];
  look: 'tole' | 'bois' | 'verre' | 'noir' | 'galva' | 'interieur' | 'blanc';
  sheet?: { bends: number; returns: number };
}

export interface ProductSpec {
  kind: ProductKind;
  /** Encombrement hors tout, mm : largeur (face avant), hauteur, profondeur. */
  width: number;
  height: number;
  depth: number;
  /** Réglages propres au produit (portes, colonnes, options…), décrits par PRODUCTS[kind].params. */
  options: Record<string, number | boolean | string>;
  /** Objet sur mesure (« libre ») : nom et panneaux décrits un par un (par l'IA). */
  custom?: { label: string; panels: CustomPanel[] };
  /** Couleurs RAL par panneau (id de panneau ou de mouvement) ; sinon la couleur de la pièce. */
  colors?: Record<string, string>;
}

/** Fiche d'un fichier CAO importé ; le maillage lui-même reste en mémoire dans le navigateur (cadImport). */
export interface ImportedModel {
  id: string;
  name: string;
  format: string;
  /** Encombrement x, y, z du fichier, mm. */
  size: [number, number, number];
  /** Surface totale du solide, mm². */
  area: number;
  triangles: number;
  /** Épaisseur de tôle estimée (2 × volume / surface), mm. */
  thickness: number;
  /** Plis estimés (orientations de faces planes). */
  bends: number;
  /** DXF : profil plat exact (découpe, amorçages, surface). */
  profile?: { cut: number; pierces: number; area: number };
}

export interface PartSpec {
  name: string;
  /** Pièce importée d'un fichier CAO (STEP, IGES, STL, OBJ, DXF) : remplace la pièce dessinée. */
  imported?: ImportedModel;
  /** Fichiers CAO : fournis par le client (simple reprise) et / ou à lui livrer (STEP, DXF, plans). */
  cad?: { provided?: boolean; deliver?: boolean };
  /** Produit assemblé : remplace la pièce pliée simple (base, ailes, perçages ne servent plus). */
  product?: ProductSpec;
  material: MaterialId;
  thickness: number;
  /** Cote extérieure en X de la base. */
  width: number;
  /** Cote extérieure en Y de la base. */
  depth: number;
  flanges: Flange[];
  holes: Hole[];
  finish: FinishId;
  /** RAL si finition époxy. */
  ral?: string;
  quantity: number;
  /** Rayon intérieur de pliage ; par défaut = épaisseur. */
  innerRadius?: number;
  cuts?: Cut[];
  fillets?: Fillet[];
}

export interface MaterialInfo {
  id: MaterialId;
  label: string;
  /** kg/dm³ */
  density: number;
  /** €/kg tôle */
  pricePerKg: number;
  /** Facteur K pour le calcul de la fibre neutre. */
  kFactor: number;
  thicknesses: number[];
  /** Coefficient de vitesse de coupe laser (1 = acier). */
  cutFactor: number;
}

export interface FinishInfo {
  id: FinishId;
  label: string;
  /** €/m² (deux faces) */
  pricePerM2: number;
  /** Forfait de lancement par lot */
  setup: number;
  compatible: MaterialId[];
}

export interface BendLine {
  /** Coordonnées dans le flan (mise à plat), origine coin bas-gauche du rectangle englobant. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  edge: Edge;
  angle: number;
  innerRadius: number;
  /** Longueur développée de l'arc sur la fibre neutre (BA). */
  bendAllowance: number;
  /** Déduction au pli (BD) : somme des cotes extérieures − longueur développée. */
  bendDeduction: number;
}

export interface FlatPattern {
  /** Contour extérieur du flan, polygone fermé (sens anti-horaire), mm. */
  outline: [number, number][];
  /** Le flan face par face (base, ailes), dans le même repère : leur réunion forme le flan. */
  faces: [number, number][][];
  /** Jonctions entre faces (le long des plis) : à ne pas tracer comme découpe. */
  seams: [number, number, number, number][];
  /** Perçages repositionnés dans le repère du flan. */
  holes: Hole[];
  bendLines: BendLine[];
  /** Rectangle englobant du flan. */
  blankWidth: number;
  blankHeight: number;
  /** Surface nette (perçages déduits), mm². */
  area: number;
  /** Longueur de coupe laser totale (contour + perçages), mm. */
  cutLength: number;
  /** Nombre d'amorçages laser (1 contour + 1 par perçage). */
  pierces: number;
  /** Masse d'une pièce, kg. */
  mass: number;
  /** Rappel de calcul lisible, une ligne par pli, pour affichage « cotes ». */
  notes: string[];
}

export interface SheetFormat {
  label: string;
  width: number;
  height: number;
}

export interface NestPlacement {
  x: number;
  y: number;
  rotated: boolean;
}

export interface NestingResult {
  sheet: SheetFormat;
  /** Pièces par tôle. */
  perSheet: number;
  /** Tôles nécessaires pour la quantité. */
  sheets: number;
  /** Placements sur UNE tôle pleine (pour dessin). */
  placements: NestPlacement[];
  /** Taux d'utilisation matière moyen sur le lot, 0..1. */
  utilisation: number;
  /** Masse de tôle achetée, kg. */
  sheetMass: number;
  /** Chute (perte), kg. */
  scrapMass: number;
  /** Espacement entre pièces et marge de bord utilisés, mm. */
  gap: number;
  margin: number;
  /** Comparatif des autres formats testés, pour afficher l'économie. */
  alternatives: { sheet: SheetFormat; perSheet: number; sheets: number; utilisation: number }[];
}

export interface PriceLine {
  id: string;
  label: string;
  detail: string;
  /** Montant total pour le lot, € HT. */
  amount: number;
}

export interface PriceTier {
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface Quote {
  quantity: number;
  lines: PriceLine[];
  subtotal: number;
  vat: number;
  total: number;
  unitPrice: number;
  /** Prix unitaires pour 1 (proto), 10, 20, 50. */
  tiers: PriceTier[];
  /** Délai indicatif en jours ouvrés. */
  leadTimeDays: number;
}

// ---- Conversation -------------------------------------------------------

export interface Choice {
  label: string;
  /** Valeur renvoyée à l'assistant comme si le client l'avait tapée. */
  value: string;
}

export interface Attachment {
  id: string;
  name: string;
  kind: 'image' | 'pdf' | 'cad' | 'other';
  /** URL objet locale pour aperçu image. */
  url?: string;
  size: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  attachments?: Attachment[];
  /** Réponses rapides proposées (assistant uniquement). */
  choices?: Choice[];
  /** Autoriser une réponse libre en plus des choix. */
  allowCustom?: boolean;
  /** Carte récapitulative de la pièce après ce message (version et état de la pièce à cet instant). */
  recap?: { version: number; spec: PartSpec };
  /** Message du client : état de la pièce juste avant lui, pour pouvoir le modifier et repartir de là. */
  snapshot?: { spec: PartSpec; answered: MissingField[] };
  /** Indique quelle info manquante cette question cherche à combler. */
  asks?: MissingField;
}

export type MissingField = 'shape' | 'dimensions' | 'material' | 'thickness' | 'flanges' | 'holes' | 'finish' | 'quantity';

export interface AssistantTurn {
  message: ChatMessage;
  /** Modifications à appliquer à la pièce (fusion superficielle ; flanges/holes remplacent le tableau). */
  patch: Partial<PartSpec>;
  /** Infos encore manquantes ou supposées par défaut. */
  missing: MissingField[];
}
