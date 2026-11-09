// Produits assemblés : armoire électrique, locker (casiers, en ligne ou en angle), cabine photomaton,
// automate de pharmacie. Un produit = des panneaux positionnés en 3D (tôles à fabriquer et composants),
// des mouvements (portes, trappes, tiroirs, rideau) et un état « en marche ».
// Les réglages de chaque produit sont décrits ici : l'éditeur, l'assistant et le chiffrage s'en servent tels quels.
import type { FlatPattern, PartSpec, PriceLine, ProductKind, ProductSpec, Quote } from './types';
import {
  BEND_SETUP_MIN,
  BEND_TIME_S,
  CAD_RATE_PER_HOUR,
  FINISHES,
  LASER_RATE_PER_HOUR,
  LASER_SPEED_STEEL,
  LEAD_TIME_FINISH_DAYS,
  MATERIALS,
  PIERCE_TIME_BASE_S,
  PRESS_BRAKE_RATE_PER_HOUR,
  QC_PER_PART,
  QC_SETUP,
  SERIES_COEFFICIENTS,
  TECHNICAL_SCRAP_RATE,
  TIER_QUANTITIES,
  VAT_RATE,
} from './catalog';
import { deliveryLine, type Delivery } from './pricing';
import { cadLines } from './cad';

export type V3 = [number, number, number];

// --- Réglages ---------------------------------------------------------------------------------

export interface ParamDef {
  key: string;
  label: string;
  type: 'number' | 'bool' | 'choice';
  /** Réglage à choix (mur, type de siège…) : valeur, libellé, mots qui le désignent dans un message. */
  choices?: { value: string; label: string; words: string }[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Réglage affiché seulement si cette option est active. */
  if?: string;
}

export interface ProductDef {
  kind: ProductKind;
  label: string;
  /** « une armoire électrique » : pour les phrases de l'assistant. */
  article: string;
  defaults: Omit<ProductSpec, 'kind'>;
  limits: { width: [number, number]; height: [number, number]; depth: [number, number] };
  params: ParamDef[];
  /** Bouton de mise en marche (voyants, écran, ventilation…). */
  activeLabel: string;
  /** Matière, épaisseur et finition proposées au départ. */
  start: Pick<PartSpec, 'material' | 'thickness' | 'finish' | 'ral'>;
}

// --- Gamme mobilier, agencement et tôlerie industrielle (réalisations Tôlerie Rémond) ---------------
const bool = (key: string, label: string, ifKey?: string): ParamDef => ({ key, label, type: 'bool', if: ifKey });
const int = (key: string, label: string, min: number, max: number, step = 1, unit?: string, ifKey?: string): ParamDef => ({ key, label, type: 'number', min, max, step, unit, if: ifKey });
const def = (
  kind: ProductKind, label: string, article: string, [width, height, depth]: V3, limits: ProductDef['limits'],
  options: ProductSpec['options'], params: ParamDef[], activeLabel: string, start: ProductDef['start'],
): ProductDef => ({ kind, label, article, defaults: { width, height, depth, options }, limits, params, activeLabel, start });
const PAINT = (ral: string): ProductDef['start'] => ({ material: 'acier', thickness: 1.5, finish: 'epoxy', ral });

const MORE_PRODUCTS = {
  fauteuil: def('fauteuil', 'Fauteuil en tôle pliée', 'un fauteuil en tôle pliée', [650, 800, 800], { width: [400, 1200], height: [500, 1300], depth: [500, 2200] },
    { allonge: false, accoudoirs: false, coussin: true },
    [bool('allonge', 'Chaise longue (allongé)'), bool('accoudoirs', 'Accoudoirs'), bool('coussin', 'Coussin')], 'Éclairer', { material: 'acier', thickness: 3, finish: 'epoxy', ral: '7016' }),
  libre: def('libre', 'Objet sur mesure', 'un objet sur mesure', [1000, 1000, 1000], { width: [10, 12000], height: [10, 6000], depth: [10, 12000] },
    {}, [], 'Éclairer', { material: 'acier', thickness: 2, finish: 'epoxy', ral: '7016' }),
  banque: def('banque', 'Banque d’accueil', 'une banque d’accueil', [2400, 1100, 800], { width: [800, 6000], height: [700, 1250], depth: [500, 1200] },
    { angle: false, retour: 1200, rehausse: true, pmr: true, caissons: 1, passeCables: true, perfore: false, bois: true, led: true },
    [bool('angle', 'En L (retour)'), int('retour', 'Longueur du retour', 600, 3000, 100, 'mm', 'angle'), bool('rehausse', 'Tablette haute (rehausse)'), bool('pmr', 'Partie basse PMR'),
      int('caissons', 'Caissons à tiroirs', 0, 3), bool('passeCables', 'Passe-câbles'), bool('perfore', 'Façade perforée'), bool('bois', 'Plateaux bois'), bool('led', 'Bandeau LED')],
    'Allumer l’éclairage', PAINT('9016')),
  bar: def('bar', 'Bar / comptoir CHR', 'un bar', [3000, 1100, 700], { width: [1000, 8000], height: [900, 1250], depth: [500, 1000] },
    { reposePieds: true, etagereArriere: true, perfore: false, bois: true, led: true, caissons: 0 },
    [bool('reposePieds', 'Repose-pieds'), bool('etagereArriere', 'Étagère arrière'), int('caissons', 'Caissons à tiroirs', 0, 4), bool('perfore', 'Façade perforée'), bool('bois', 'Plateau bois'), bool('led', 'Bandeau LED')],
    'Allumer l’éclairage', PAINT('9005')),
  etagere: def('etagere', 'Étagère modulable', 'une étagère modulable', [1200, 2000, 400], { width: [400, 4000], height: [400, 2600], depth: [200, 800] },
    { travees: 2, niveaux: 5, bois: true, fond: true },
    [int('travees', 'Travées', 1, 6), int('niveaux', 'Niveaux', 2, 10), bool('bois', 'Tablettes bois'), bool('fond', 'Fond perforé')], 'Éclairer', PAINT('9005')),
  meubleTiroirs: def('meubleTiroirs', 'Meuble à tiroirs', 'un meuble à tiroirs', [800, 1000, 600], { width: [300, 2400], height: [300, 2000], depth: [300, 900] },
    { colonnes: 2, tiroirs: 5, roulettes: false, serrure: true, bois: true },
    [int('colonnes', 'Colonnes de tiroirs', 1, 6), int('tiroirs', 'Tiroirs par colonne', 1, 12), bool('roulettes', 'Sur roulettes'), bool('serrure', 'Serrure centralisée'), bool('bois', 'Plateau bois')],
    'Éclairer', PAINT('7016')),
  vitrine: def('vitrine', 'Vitrine', 'une vitrine', [1000, 1800, 500], { width: [400, 3000], height: [800, 2400], depth: [300, 900] },
    { socle: 400, etageres: 3, porte: true, eclairage: true, serrure: true },
    [int('socle', 'Socle', 100, 1000, 50, 'mm'), int('etageres', 'Étagères en verre', 0, 6), bool('porte', 'Porte vitrée'), bool('eclairage', 'Éclairage LED'), bool('serrure', 'Serrure')],
    'Allumer l’éclairage', PAINT('9005')),
  table: def('table', 'Table basse', 'une table basse', [1000, 400, 600], { width: [300, 2400], height: [250, 800], depth: [300, 1200] },
    { origami: true, bois: true, etagere: false },
    [bool('origami', 'Pieds origami (tôle pliée)'), bool('bois', 'Plateau bois'), bool('etagere', 'Tablette basse')], 'Éclairer', PAINT('9005')),
  salleAttente: def('salleAttente', 'Sièges de salle d’attente', 'une rangée de sièges de salle d’attente', [1800, 820, 620], { width: [500, 4000], height: [700, 1000], depth: [450, 800] },
    { places: 3, accoudoirs: true, perfore: true, tablette: false },
    [int('places', 'Places', 1, 8), bool('accoudoirs', 'Accoudoirs'), bool('perfore', 'Assises perforées'), bool('tablette', 'Tablette en bout')], 'Éclairer', PAINT('7016')),
  bacFleurs: def('bacFleurs', 'Bac à fleurs', 'un bac à fleurs', [1000, 600, 400], { width: [200, 4000], height: [200, 1500], depth: [200, 1500] },
    { bois: true, drainage: true, doubleFond: true, roulettes: false },
    [bool('bois', 'Habillage bois'), bool('drainage', 'Trous de drainage'), bool('doubleFond', 'Double fond'), bool('roulettes', 'Sur roulettes')], 'Éclairer', PAINT('7016')),
  pergola: def('pergola', 'Pergola bioclimatique', 'une pergola', [4000, 2500, 3000], { width: [1500, 8000], height: [2000, 3500], depth: [1500, 6000] },
    { lames: true, moteur: true, led: true, poteaux: 4 },
    [bool('lames', 'Lames orientables'), bool('moteur', 'Motorisation', 'lames'), bool('led', 'Éclairage LED'), int('poteaux', 'Poteaux', 2, 6, 2)], 'Allumer l’éclairage', { material: 'alu5754', thickness: 3, finish: 'epoxy', ral: '7016' }),
  porte: def('porte', 'Porte extérieure', 'une porte extérieure', [1000, 2150, 80], { width: [600, 3000], height: [1800, 3000], depth: [50, 150] },
    { vantaux: 1, vitree: false, imposte: false, serrure: true },
    [int('vantaux', 'Vantaux', 1, 2), bool('vitree', 'Partie vitrée'), bool('imposte', 'Imposte fixe'), bool('serrure', 'Serrure 3 points')], 'Éclairer', { material: 'galva', thickness: 2, finish: 'epoxy', ral: '7016' }),
  borneSonore: def('borneSonore', 'Borne sonore', 'une borne sonore', [400, 1600, 400], { width: [250, 900], height: [800, 2400], depth: [250, 900] },
    { hautParleurs: 2, bouton: true, ecran: false, maintenance: true },
    [int('hautParleurs', 'Haut-parleurs', 1, 4), bool('bouton', 'Bouton d’appel'), bool('ecran', 'Écran'), bool('maintenance', 'Trappe de maintenance')], 'Lancer le son', PAINT('9005')),
  gel: def('gel', 'Distributeur de gel', 'un distributeur de gel hydroalcoolique', [320, 1300, 320], { width: [200, 600], height: [900, 1700], depth: [200, 600] },
    { pedale: true, bac: true, affiche: true },
    [bool('pedale', 'Commande à pédale'), bool('bac', 'Bac récupérateur'), bool('affiche', 'Porte-affiche A4')], 'Éclairer', { material: 'inox304', thickness: 1.5, finish: 'brossage' }),
  tri: def('tri', 'Meuble de tri du courrier', 'un meuble de tri du courrier', [1600, 1800, 500], { width: [600, 4000], height: [800, 2400], depth: [300, 800] },
    { colonnes: 8, rangees: 6, plan: true, roulettes: false },
    [int('colonnes', 'Colonnes de cases', 2, 16), int('rangees', 'Rangées de cases', 2, 12), bool('plan', 'Plan de travail'), bool('roulettes', 'Sur roulettes')], 'Éclairer', PAINT('5015')),
  caveVin: def('caveVin', 'Casier à bouteilles', 'un casier à bouteilles', [1200, 2000, 350], { width: [300, 4000], height: [400, 2600], depth: [250, 500] },
    { colonnes: 6, rangees: 10, bouteilles: true, bois: false },
    [int('colonnes', 'Bouteilles par rangée', 2, 20), int('rangees', 'Rangées', 2, 20), bool('bouteilles', 'Afficher des bouteilles'), bool('bois', 'Montants bois')], 'Éclairer', PAINT('9005')),
  lampe: def('lampe', 'Lampe en métal perforé', 'une lampe en métal perforé', [300, 500, 300], { width: [120, 1000], height: [150, 1800], depth: [120, 1000] },
    { trou: 8, bois: true, suspension: false },
    [int('trou', 'Diamètre des perforations', 3, 20, 1, 'mm'), bool('bois', 'Socle bois'), bool('suspension', 'Suspension')], 'Allumer', PAINT('9005')),
  supportMenu: def('supportMenu', 'Support de menu', 'un support de menu', [420, 1300, 350], { width: [250, 900], height: [900, 1700], depth: [250, 700] },
    { inclinaison: 25, eclairage: true },
    [int('inclinaison', 'Inclinaison du pupitre', 0, 60, 5, '°'), bool('eclairage', 'Éclairage du menu')], 'Allumer', PAINT('3020')),
  chariot: def('chariot', 'Structure tube sur roulettes', 'une structure sur roulettes', [1000, 900, 600], { width: [300, 3000], height: [300, 2000], depth: [300, 1500] },
    { niveaux: 2, poignee: true, freins: true },
    [int('niveaux', 'Plateaux', 1, 6), bool('poignee', 'Poignée de poussée'), bool('freins', 'Roulettes à frein')], 'Éclairer', PAINT('9005')),
  grille: def('grille', 'Grille d’aération / persiennes', 'une grille d’aération', [600, 400, 40], { width: [100, 3000], height: [100, 3000], depth: [20, 200] },
    { persiennes: true, lames: 8, cadre: true },
    [bool('persiennes', 'Persiennes (sinon perforée)'), int('lames', 'Lames', 3, 30, 1, undefined, 'persiennes'), bool('cadre', 'Cadre de fixation')], 'Éclairer', { material: 'galva', thickness: 1.5, finish: 'brut' }),
  tremie: def('tremie', 'Trémie / bac étanche', 'une trémie', [800, 1400, 800], { width: [300, 3000], height: [400, 3000], depth: [300, 3000] },
    { pieds: true, couvercle: true, vanne: true, vibreur: true },
    [bool('pieds', 'Piètement'), bool('couvercle', 'Couvercle'), bool('vanne', 'Vanne guillotine'), bool('vibreur', 'Support de vibreur')], 'Mettre en vibration', { material: 'inox304', thickness: 2, finish: 'brut' }),
  marche: def('marche', 'Marches antidérapantes', 'des marches antidérapantes', [800, 900, 1250], { width: [400, 2000], height: [150, 3000], depth: [200, 4000] },
    { marches: 5, limons: true, perforations: true },
    [int('marches', 'Marches', 1, 18), bool('limons', 'Limons'), bool('perforations', 'Picots antidérapants')], 'Éclairer', { material: 'galva', thickness: 2.5, finish: 'brut' }),
  tolePerforee: def('tolePerforee', 'Tôle perforée', 'une tôle perforée', [1000, 600, 20], { width: [100, 3000], height: [100, 1500], depth: [3, 60] },
    { trou: 10, pas: 20, cadre: true },
    [int('trou', 'Diamètre des trous', 2, 40, 1, 'mm'), int('pas', 'Entraxe', 4, 80, 1, 'mm'), bool('cadre', 'Bords pliés')], 'Éclairer', { material: 'acier', thickness: 1.5, finish: 'epoxy', ral: '9005' }),
  cassette: def('cassette', 'Cassettes de façade', 'des cassettes de façade', [3000, 2000, 50], { width: [500, 12000], height: [300, 6000], depth: [30, 120] },
    { colonnes: 4, rangees: 3, joint: 20, perfore: false },
    [int('colonnes', 'Colonnes', 1, 20), int('rangees', 'Rangées', 1, 12), int('joint', 'Joint', 5, 60, 5, 'mm'), bool('perfore', 'Perforées')], 'Éclairer', { material: 'alu5754', thickness: 2, finish: 'epoxy', ral: '7016' }),
} satisfies Partial<Record<ProductKind, ProductDef>>;

/** Choix de mur intérieur ; `subject` = mots de ce qu'on place (« écran sur le mur de gauche »). */
function WALL_CHOICES(subject: string): NonNullable<ParamDef['choices']> {
  const near = `(?:${subject})[^,.;]{0,40}`;
  return [
    { value: 'fond', label: 'Mur du fond', words: `${near}(?:mur du fond|au fond|fond)` },
    { value: 'gauche', label: 'Mur de gauche', words: `${near}(?:mur de gauche|cote gauche|a gauche|gauche)` },
    { value: 'droite', label: 'Mur de droite', words: `${near}(?:mur de droite|cote droit|a droite|droite)` },
  ];
}
/** Place d'un siège : au centre ou collé à un mur. */
function SIDE_CHOICES(subject: string): NonNullable<ParamDef['choices']> {
  const near = `(?:${subject})[^,.;]{0,40}`;
  return [
    { value: 'centre', label: 'Au centre', words: `${near}(?:au centre|au milieu|centre)` },
    { value: 'gauche', label: 'Contre la gauche', words: `${near}(?:cote gauche|a gauche|gauche)` },
    { value: 'droite', label: 'Contre la droite', words: `${near}(?:cote droit|a droite|droite)` },
    { value: 'fond', label: 'Contre le fond', words: `${near}(?:au fond|fond)` },
  ];
}

export const PRODUCTS: Record<ProductKind, ProductDef> = {
  ...MORE_PRODUCTS,
  armoire: {
    kind: 'armoire',
    label: 'Armoire électrique',
    article: 'une armoire électrique',
    defaults: { width: 800, height: 2000, depth: 400, options: { portes: 2, socle: 100, plaque: true, rails: 4, ventilation: true, passeCables: true } },
    limits: { width: [300, 2400], height: [400, 2400], depth: [200, 800] },
    params: [
      { key: 'portes', label: 'Portes', type: 'number', min: 1, max: 2, step: 1 },
      { key: 'socle', label: 'Socle', type: 'number', min: 0, max: 300, step: 50, unit: 'mm' },
      { key: 'plaque', label: 'Plaque de montage', type: 'bool' },
      { key: 'rails', label: 'Rails DIN', type: 'number', min: 0, max: 8, step: 1, if: 'plaque' },
      { key: 'ventilation', label: 'Ventilation (grilles + ventilateur)', type: 'bool' },
      { key: 'passeCables', label: 'Plaque passe-câbles', type: 'bool' },
    ],
    activeLabel: 'Mettre sous tension',
    start: { material: 'acier', thickness: 1.5, finish: 'epoxy', ral: '7035' },
  },
  locker: {
    kind: 'locker',
    label: 'Locker à casiers',
    article: 'un locker à casiers',
    defaults: { width: 1600, height: 1900, depth: 550, options: { colonnes: 4, rangees: 5, ecran: true, angle: false, colonnesRetour: 3, socle: 80 } },
    limits: { width: [300, 4000], height: [600, 2400], depth: [300, 800] },
    params: [
      { key: 'colonnes', label: 'Colonnes de casiers', type: 'number', min: 1, max: 10, step: 1 },
      { key: 'rangees', label: 'Casiers par colonne', type: 'number', min: 1, max: 10, step: 1 },
      { key: 'ecran', label: 'Borne écran intégrée', type: 'bool' },
      { key: 'angle', label: 'En angle (retour en L)', type: 'bool' },
      { key: 'colonnesRetour', label: 'Colonnes du retour', type: 'number', min: 1, max: 8, step: 1, if: 'angle' },
      { key: 'socle', label: 'Socle', type: 'number', min: 0, max: 200, step: 20, unit: 'mm' },
    ],
    activeLabel: 'Mettre en service',
    start: { material: 'galva', thickness: 1.2, finish: 'epoxy', ral: '7016' },
  },
  photomaton: {
    kind: 'photomaton',
    label: 'Cabine photomaton',
    article: 'une cabine photomaton',
    defaults: { width: 1500, height: 2000, depth: 800, options: { rideau: true, siege: 'tabouret', siegeCote: 'centre', priseVue: 'fond', commandes: 'exterieur', ecran: true, imprimante: true, enseigne: true } },
    limits: { width: [900, 2400], height: [1700, 2400], depth: [600, 1400] },
    params: [
      { key: 'rideau', label: 'Rideau d’entrée', type: 'bool' },
      { key: 'siege', label: 'Siège', type: 'choice', choices: [
        { value: 'tabouret', label: 'Tabouret carré', words: 'tabourets? carres?|tabourets?' },
        { value: 'rond', label: 'Tabouret rond', words: 'tabourets? ronds?|sieges? ronds?|assises? rondes?' },
        { value: 'banquette', label: 'Banquette', words: 'banquettes?|banc' },
        { value: 'aucun', label: 'Sans siège', words: 'sans (siege|tabouret|assise)|pas de (siege|tabouret)|debout' },
      ] },
      { key: 'siegeCote', label: 'Place du siège', type: 'choice', choices: SIDE_CHOICES('siege|tabouret|banquette|banc|assise') },
      { key: 'priseVue', label: 'Mur de la caméra et de l’écran', type: 'choice', choices: WALL_CHOICES('camera|ecran|flash|prise de vue') },
      { key: 'commandes', label: 'Écran d’accueil et paiement', type: 'choice', choices: [
        { value: 'exterieur', label: 'En façade (dehors)', words: '(paiement|terminal|ecran d.accueil|commandes?) (en facade|dehors|a l.exterieur|exterieur)' },
        { value: 'interieur', label: 'À l’intérieur', words: '(paiement|terminal|ecran d.accueil|commandes?|ecran) (a l.interieur|dedans|interieur|sur le mur interieur)|mur interieur' },
      ] },
      { key: 'ecran', label: 'Écran de prise de vue', type: 'bool' },
      { key: 'imprimante', label: 'Imprimante et sortie photos', type: 'bool' },
      { key: 'enseigne', label: 'Enseigne lumineuse', type: 'bool' },
    ],
    activeLabel: 'Lancer une séance',
    start: { material: 'acier', thickness: 1.5, finish: 'epoxy', ral: '9005' },
  },
  pharmacie: {
    kind: 'pharmacie',
    label: 'Automate de pharmacie',
    article: 'un automate de pharmacie',
    defaults: { width: 1200, height: 2000, depth: 800, options: { ecran: true, trappe: true, tiroirs: 3, maintenance: true, etageres: 6, croix: true } },
    limits: { width: [700, 3000], height: [1400, 2600], depth: [500, 1500] },
    params: [
      { key: 'ecran', label: 'Écran tactile', type: 'bool' },
      { key: 'trappe', label: 'Trappe de délivrance', type: 'bool' },
      { key: 'tiroirs', label: 'Tiroirs de retrait', type: 'number', min: 0, max: 6, step: 1 },
      { key: 'etageres', label: 'Étagères de stockage', type: 'number', min: 2, max: 12, step: 1 },
      { key: 'maintenance', label: 'Porte de maintenance arrière', type: 'bool' },
      { key: 'croix', label: 'Croix lumineuse', type: 'bool' },
    ],
    activeLabel: 'Mettre en service',
    start: { material: 'inox304', thickness: 1.5, finish: 'brossage' },
  },
  cabine: {
    kind: 'cabine',
    label: 'Cabine téléphonique',
    article: 'une cabine téléphonique',
    defaults: { width: 1000, height: 2300, depth: 1000, options: { vitree: true, tablette: true, siege: 'rabattable', siegeCote: 'droite', telephone: true, posteMur: 'fond', ventilation: true, eclairage: true } },
    limits: { width: [800, 2400], height: [1900, 2700], depth: [800, 2400] },
    params: [
      { key: 'vitree', label: 'Porte et côtés vitrés', type: 'bool' },
      { key: 'tablette', label: 'Tablette', type: 'bool' },
      { key: 'siege', label: 'Siège', type: 'choice', choices: [
        { value: 'rabattable', label: 'Assise rabattable', words: 'assises? rabattables?|strapontins?' },
        { value: 'banquette', label: 'Banquette', words: 'banquettes?|banc' },
        { value: 'rond', label: 'Tabouret rond', words: 'tabourets? ronds?' },
        { value: 'tabouret', label: 'Tabouret carré', words: 'tabourets? carres?|tabourets?' },
        { value: 'aucun', label: 'Sans siège', words: 'sans (siege|assise|tabouret)|pas de (siege|assise)|debout' },
      ] },
      { key: 'siegeCote', label: 'Place du siège', type: 'choice', choices: SIDE_CHOICES('siege|assise|tabouret|banquette|banc') },
      { key: 'telephone', label: 'Poste téléphonique / visio', type: 'bool' },
      { key: 'posteMur', label: 'Mur du poste et de la tablette', type: 'choice', choices: WALL_CHOICES('poste|telephone|tablette|visio') },
      { key: 'ventilation', label: 'Ventilation', type: 'bool' },
      { key: 'eclairage', label: 'Éclairage et enseigne', type: 'bool' },
    ],
    activeLabel: 'Allumer la cabine',
    start: { material: 'acier', thickness: 1.5, finish: 'epoxy', ral: '3020' },
  },
  kiosque: {
    kind: 'kiosque',
    label: 'Borne interactive',
    article: 'une borne interactive',
    defaults: { width: 600, height: 1750, depth: 450, options: { pouces: 32, imprimante: true, lecteurCarte: true, sansContact: true, scanner: true, maintenance: true } },
    limits: { width: [400, 1400], height: [1000, 2300], depth: [250, 900] },
    params: [
      { key: 'pouces', label: 'Écran', type: 'number', min: 15, max: 65, step: 1, unit: 'pouces' },
      { key: 'imprimante', label: 'Imprimante de tickets', type: 'bool' },
      { key: 'lecteurCarte', label: 'Terminal carte bancaire', type: 'bool' },
      { key: 'sansContact', label: 'Paiement sans contact', type: 'bool' },
      { key: 'scanner', label: 'Lecteur QR code / badge', type: 'bool' },
      { key: 'maintenance', label: 'Porte de maintenance arrière', type: 'bool' },
    ],
    activeLabel: 'Mettre en service',
    start: { material: 'acier', thickness: 2, finish: 'epoxy', ral: '9005' },
  },
  distributeur: {
    kind: 'distributeur',
    label: 'Distributeur automatique',
    article: 'un distributeur automatique',
    defaults: { width: 900, height: 1830, depth: 850, options: { etages: 6, selections: 6, monnayeur: true, refrigere: true } },
    limits: { width: [600, 1600], height: [1300, 2100], depth: [550, 1100] },
    params: [
      { key: 'etages', label: 'Plateaux', type: 'number', min: 2, max: 9, step: 1 },
      { key: 'selections', label: 'Sélections par plateau', type: 'number', min: 2, max: 10, step: 1 },
      { key: 'monnayeur', label: 'Monnayeur', type: 'bool' },
      { key: 'refrigere', label: 'Groupe froid', type: 'bool' },
    ],
    activeLabel: 'Mettre en service',
    start: { material: 'acier', thickness: 1.5, finish: 'epoxy', ral: '9005' },
  },
  recharge: {
    kind: 'recharge',
    label: 'Borne de recharge',
    article: 'une borne de recharge',
    defaults: { width: 400, height: 1500, depth: 300, options: { prises: 2, ecran: true, supportCable: true, maintenance: true } },
    limits: { width: [250, 900], height: [900, 2100], depth: [180, 600] },
    params: [
      { key: 'prises', label: 'Points de charge', type: 'number', min: 1, max: 2, step: 1 },
      { key: 'ecran', label: 'Écran', type: 'bool' },
      { key: 'supportCable', label: 'Supports de câble', type: 'bool' },
      { key: 'maintenance', label: 'Porte de maintenance', type: 'bool' },
    ],
    activeLabel: 'Lancer une recharge',
    start: { material: 'acier', thickness: 2, finish: 'epoxy', ral: '9016' },
  },
  boites: {
    kind: 'boites',
    label: 'Boîtes aux lettres collectives',
    article: 'un ensemble de boîtes aux lettres',
    defaults: { width: 1000, height: 1100, depth: 300, options: { colonnes: 3, rangees: 4, interphone: false, pied: false } },
    limits: { width: [280, 3500], height: [300, 2100], depth: [250, 450] },
    params: [
      { key: 'colonnes', label: 'Colonnes', type: 'number', min: 1, max: 12, step: 1 },
      { key: 'rangees', label: 'Boîtes par colonne', type: 'number', min: 1, max: 8, step: 1 },
      { key: 'interphone', label: 'Platine d’interphone', type: 'bool' },
      { key: 'pied', label: 'Sur pied', type: 'bool' },
    ],
    activeLabel: 'Allumer les étiquettes',
    start: { material: 'alu5754', thickness: 1.5, finish: 'epoxy', ral: '7016' },
  },
  baie: {
    kind: 'baie',
    label: 'Baie serveur 19"',
    article: 'une baie serveur 19 pouces',
    defaults: { width: 600, height: 2000, depth: 1000, options: { vitree: true, porteArriere: true, serveurs: 8, ventilation: true } },
    limits: { width: [600, 800], height: [600, 2300], depth: [450, 1200] },
    params: [
      { key: 'vitree', label: 'Porte avant vitrée', type: 'bool' },
      { key: 'porteArriere', label: 'Porte arrière', type: 'bool' },
      { key: 'serveurs', label: 'Serveurs 2U montés', type: 'number', min: 0, max: 20, step: 1 },
      { key: 'ventilation', label: 'Ventilateurs de toit', type: 'bool' },
    ],
    activeLabel: 'Démarrer les serveurs',
    start: { material: 'acier', thickness: 1.5, finish: 'epoxy', ral: '9005' },
  },
  horodateur: {
    kind: 'horodateur',
    label: 'Horodateur',
    article: 'un horodateur',
    defaults: { width: 400, height: 1750, depth: 300, options: { ecran: true, clavier: true, imprimante: true, solaire: true, monnayeur: true } },
    limits: { width: [280, 800], height: [1200, 2300], depth: [200, 600] },
    params: [
      { key: 'ecran', label: 'Écran', type: 'bool' },
      { key: 'clavier', label: 'Clavier', type: 'bool' },
      { key: 'imprimante', label: 'Imprimante de tickets', type: 'bool' },
      { key: 'monnayeur', label: 'Monnayeur', type: 'bool' },
      { key: 'solaire', label: 'Panneau solaire', type: 'bool' },
    ],
    activeLabel: 'Imprimer un ticket',
    start: { material: 'acier', thickness: 2, finish: 'epoxy', ral: '5010' },
  },
  carter: {
    kind: 'carter',
    label: 'Carter de machine',
    article: 'un carter de machine',
    defaults: { width: 1500, height: 1700, depth: 1200, options: { portes: 2, hublots: true, pupitre: true, gyrophare: true, ventilation: true } },
    limits: { width: [500, 6000], height: [500, 3000], depth: [400, 4000] },
    params: [
      { key: 'portes', label: 'Portes d’accès', type: 'number', min: 0, max: 4, step: 1 },
      { key: 'hublots', label: 'Vitrages de visite', type: 'bool' },
      { key: 'pupitre', label: 'Pupitre de commande', type: 'bool' },
      { key: 'gyrophare', label: 'Colonne lumineuse', type: 'bool' },
      { key: 'ventilation', label: 'Extraction en toiture', type: 'bool' },
    ],
    activeLabel: 'Démarrer la machine',
    start: { material: 'acier', thickness: 2, finish: 'epoxy', ral: '7035' },
  },
};

export function newProduct(kind: ProductKind): ProductSpec {
  const d = PRODUCTS[kind].defaults;
  return { kind, width: d.width, height: d.height, depth: d.depth, options: { ...d.options } };
}

const num = (p: ProductSpec, k: string) => Number(p.options[k] ?? PRODUCTS[p.kind].defaults.options[k] ?? 0);
const on = (p: ProductSpec, k: string) => Boolean(p.options[k] ?? PRODUCTS[p.kind].defaults.options[k]);
const opt = (p: ProductSpec, k: string) => String(p.options[k] ?? PRODUCTS[p.kind].defaults.options[k] ?? '');

/** Mur intérieur d'une cabine : fond, gauche, droite (vus de l'entrée), ou face intérieure de la façade. */
export type Wall = 'fond' | 'gauche' | 'droite' | 'facade';
/**
 * Pose un élément contre la face intérieure d'un mur (1 mm de jeu, jamais à travers) : `w` le long du mur, `h` en hauteur,
 * `d` en saillie du mur ; `along` décale le long du mur depuis son milieu.
 */
function onWall(wall: Wall, [w, h, d]: V3, y: number, along: number, W: number, D: number, T: number): { size: V3; at: V3 } {
  if (wall === 'fond') return { size: [w, h, d], at: [along, y, -D / 2 + T + 1 + d / 2] };
  if (wall === 'facade') return { size: [w, h, d], at: [along, y, D / 2 - T - 1 - d / 2] };
  if (wall === 'gauche') return { size: [d, h, w], at: [-W / 2 + T + 1 + d / 2, y, along] };
  return { size: [d, h, w], at: [W / 2 - T - 1 - d / 2, y, -along] };
}

/** Siège posé au sol : tabouret carré ou rond (pied + platine), ou banquette contre un mur. */
function seat(add: Add, kind: string, wall: Wall | 'centre', y0: number, W: number, D: number, T: number, cx = 0, cz = 0, along = 0, maxLen = Infinity) {
  if (kind === 'aucun') return;
  if (kind === 'banquette') {
    const w2: Wall = wall === 'centre' ? 'fond' : wall;
    // Longueur bornée au mur (et à la place libre), décalage borné pour ne jamais traverser un mur voisin.
    const wallLen = wall === 'gauche' || wall === 'droite' ? D : W;
    const len = Math.min(wallLen * 0.7, 1200, maxLen);
    const lim = Math.max(0, wallLen / 2 - T - 1 - len / 2);
    along = Math.max(-lim, Math.min(lim, along));
    const body = onWall(w2, [len, 420, 380], y0 + 210, along, W, D, T);
    add({ id: 'banquette', label: 'Banquette (caisson tôle)', ...body, look: 'tole', sheet: { bends: 4, returns: 40, hems: 1 } });
    const cushion = onWall(w2, [len - 20, 60, 360], y0 + 450, along, W, D, T);
    add({ id: 'banquette-coussin', label: 'Coussin', ...cushion, look: 'noir' });
    return;
  }
  // Tabouret : au centre, ou décalé vers le mur choisi.
  const off = 0.22;
  const x = wall === 'gauche' ? -W * off : wall === 'droite' ? W * off : cx;
  const z = wall === 'fond' ? -D * off : cz;
  const round = kind === 'rond';
  add({ id: 'tabouret-platine', label: 'Platine du tabouret', size: [300, 8, 300], at: [x, y0 + 4, z], look: 'galva', round, sheet: { bends: 0, returns: 0 }, holes: round ? undefined : [[-110, -110, 9], [110, 110, 9]] });
  add({ id: 'tabouret-pied', label: 'Pied de tabouret', size: [50, 420, 50], at: [x, y0 + 8 + 210, z], look: 'galva', round });
  add({ id: 'tabouret', label: round ? 'Assise ronde' : 'Assise carrée', size: [360, 50, 360], at: [x, y0 + 8 + 420 + 25, z], look: 'noir', round });
}

// --- Modèle 3D (sans three.js) -------------------------------------------------------------------

/** Aspect d'un panneau ; « tole » prend la matière et la finition de la pièce. */
export type Look = 'tole' | 'interieur' | 'galva' | 'noir' | 'verre' | 'ecran' | 'led' | 'rideau' | 'boite' | 'blanc' | 'solaire' | 'bois';

export interface Panel {
  id: string;
  label: string;
  /** Boîte : taille (x, y, z) et centre, mm. Repère produit : x à droite, y en haut, z vers l'avant, sol en y = 0. */
  size: V3;
  at: V3;
  look: Look;
  /** Tôle à fabriquer (plis et bords tombés pour le chiffrage) ; absent = composant acheté (écran, rideau, électronique…). */
  sheet?: { bends: number; returns: number; hems?: number };
  /** Mouvement qui entraîne ce panneau (porte et sa poignée bougent ensemble). */
  motion?: string;
  /** Lumière quand le produit est en marche : couleur et effet. */
  glow?: { color: number; mode: 'steady' | 'blink' | 'flash' | 'pulse' };
  /** Tourne sur lui-même en marche (ventilateur), autour de cet axe. */
  spin?: 'x' | 'y' | 'z';
  /** Couleur imposée (boîtes de médicaments, voyants). */
  color?: number;
  /** Texte imprimé sur la face avant (pictogramme, sérigraphie : « CARTE BANCAIRE », « ))) »…). */
  text?: string;
  /** Posé en applique sur une face (pas de découpe dans la tôle derrière). */
  mounted?: boolean;
  /** Pièce ronde (tabouret, pied) : cylindre vertical de diamètre size[0]. */
  round?: boolean;
  /** Rotation propre du panneau, degrés autour de x, y, z (panneau solaire incliné…). */
  rot?: V3;
  /** Trous ronds percés dans le panneau : (u, v, Ø) depuis son centre, repère de `panelAxes`. */
  holes?: [number, number, number][];
  /** Contour non rectangulaire dans le plan du panneau (trapèze de trémie…), points (u, v) depuis son centre. */
  poly?: [number, number][];
  /** Ouvertures rectangulaires (écran, trappe, tiroir, passe-câbles) : (u, v, largeur, hauteur). */
  cutouts?: [number, number, number, number][];
}

export interface Motion {
  id: string;
  label: string;
  /** hinge : rotation de `angle` degrés autour de l'axe passant par `pivot` ; slide : translation `move` ; fold : écrasement vers `pivot`. */
  type: 'hinge' | 'slide' | 'fold';
  axis?: 'x' | 'y' | 'z';
  pivot?: V3;
  angle?: number;
  move?: V3;
  /** fold : échelle finale sur x (rideau replié). */
  scale?: number;
  /** Mouvement joué en boucle quand le produit est en marche (robot, impression). */
  auto?: boolean;
  /** Mouvement automatique qui s'accomplit une fois à la mise en marche et reste (reçu imprimé) au lieu d'aller et venir. */
  hold?: boolean;
  /** Mouvement porté par un autre (trappe dans une porte) : il suit son ouverture. */
  parent?: string;
}

/** Bouton de la 3D : ouvre / ferme un groupe de mouvements. */
export interface Mechanism {
  id: string;
  label: string;
  open: string;
  close: string;
  members: string[];
}

export interface ProductModel {
  panels: Panel[];
  motions: Motion[];
  mechanisms: Mechanism[];
}

const letter = (i: number) => String.fromCharCode(65 + (i % 26));

/** Construit les panneaux, mouvements et boutons d'un produit. `t` = épaisseur de tôle. */
export function productModel(p: ProductSpec, t: number): ProductModel {
  return machine(buildModel(p, Math.max(t, 0.8)));
}

/** Composants qui traversent la tôle : on découpe leur passage (le reste — poignées, moteurs — se fixe par des trous). */
const PASS_THROUGH: Look[] = ['ecran', 'noir', 'led'];

/**
 * Usinage automatique : chaque composant plat (écran, lecteur, voyant, presse-étoupe, ventilateur…) posé contre une tôle
 * y découpe son ouverture, comme sur le plan de découpe. Les ouvertures déjà prévues ne sont pas doublées.
 */
function machine(m: ProductModel): ProductModel {
  const hosts = m.panels.filter((x) => x.sheet);
  for (const c of m.panels) {
    // Traversent la tôle : écrans, voyants, lecteurs, monnayeurs, fentes, presse-étoupes, ventilateurs, boutons, caméras.
    // Un boîtier simplement fixé au mur (poste, PC, imprimante) ne la perce pas.
    // Éclairages (plafonnier, flash, bandeau, enseigne) et éléments posés sur une face (`mounted`) ne percent pas.
    const through = c.look === 'ecran' || /voyant|lecteur|terminal|paiement|tpe|monnayeur|scanner|fente|sortie|presse|ventil|bouton|cam[ée]ra|clavier|serrure/i.test(c.label);
    if (c.sheet || c.mounted || !PASS_THROUGH.includes(c.look) || c.rot || c.round || !through || /poign|moteur|composant|plafonnier|flash|bandeau|enseigne|éclairage|croix/i.test(c.label)) continue;
    const k = c.size.indexOf(Math.min(...c.size));
    if (c.size[k] > 90) continue;
    const host = hosts.find((h) => {
      if (h.rot || panelAxes(h.size).thin !== k || (h.motion ?? '') !== (c.motion ?? '')) return false;
      if (Math.abs(c.at[k] - h.at[k]) > h.size[k] / 2 + c.size[k] / 2 + 30) return false;
      return [0, 1, 2].every((i) => i === k || Math.abs(c.at[i] - h.at[i]) + c.size[i] / 2 <= h.size[i] / 2 + 0.5);
    });
    if (!host) continue;
    const { thin } = panelAxes(host.size);
    const d = [0, 1, 2].map((i) => c.at[i] - host.at[i]);
    const [u, v] = thin === 2 ? [d[0], d[1]] : thin === 1 ? [d[0], -d[2]] : [d[2], d[1]];
    if (host.cutouts?.some(([cu, cv, w, h]) => Math.abs(cu - u) < w / 2 && Math.abs(cv - v) < h / 2)) continue;
    openingFor(host, c, Math.min(8, Math.min(...c.size.filter((_, i) => i !== k)) / 4));
  }
  return m;
}

function buildModel(p: ProductSpec, T: number): ProductModel {
  switch (p.kind) {
    case 'armoire': return armoire(p, T);
    case 'locker': return locker(p, T);
    case 'photomaton': return photomaton(p, T);
    case 'pharmacie': return pharmacie(p, T);
    case 'cabine': return cabine(p, T);
    case 'kiosque': return kiosque(p, T);
    case 'distributeur': return distributeur(p, T);
    case 'recharge': return recharge(p, T);
    case 'boites': return boites(p, T);
    case 'baie': return baie(p, T);
    case 'horodateur': return horodateur(p, T);
    case 'carter': return carter(p, T);
    case 'fauteuil': return fauteuil(p, T);
    case 'libre': return libre(p);
    case 'banque': return comptoir(p, T, false);
    case 'bar': return comptoir(p, T, true);
    case 'etagere': return etagere(p, T);
    case 'meubleTiroirs': return meubleTiroirs(p, T);
    case 'vitrine': return vitrine(p, T);
    case 'table': return table(p, T);
    case 'salleAttente': return salleAttente(p, T);
    case 'bacFleurs': return bacFleurs(p, T);
    case 'pergola': return pergola(p, T);
    case 'porte': return porte(p, T);
    case 'borneSonore': return borneSonore(p, T);
    case 'gel': return gel(p, T);
    case 'tri': return tri(p, T);
    case 'caveVin': return caveVin(p, T);
    case 'lampe': return lampe(p, T);
    case 'supportMenu': return supportMenu(p, T);
    case 'chariot': return chariot(p, T);
    case 'grille': return grille(p, T);
    case 'tremie': return tremie(p, T);
    case 'marche': return marche(p, T);
    case 'tolePerforee': return tolePerforee(p, T);
    case 'cassette': return cassette(p, T);
  }
}

function armoire(p: ProductSpec, T: number): ProductModel {
  const { width: W, height: H, depth: D } = p;
  const panels: Panel[] = [];
  const motions: Motion[] = [];
  const s = Math.min(num(p, 'socle'), H / 3);
  const hb = H - s;
  const yc = s + hb / 2;
  const add = (x: Panel) => panels.push(x);
  if (s > 0) {
    add({ id: 'socle-av', label: 'Socle avant', size: [W, s, T], at: [0, s / 2, D / 2 - 30], look: 'noir', sheet: { bends: 2, returns: 30 } });
    add({ id: 'socle-ar', label: 'Socle arrière', size: [W, s, T], at: [0, s / 2, -D / 2 + 30], look: 'noir', sheet: { bends: 2, returns: 30 } });
    add({ id: 'socle-g', label: 'Socle gauche', size: [T, s, D - 60], at: [-W / 2 + T / 2, s / 2, 0], look: 'noir', sheet: { bends: 2, returns: 30 } });
    add({ id: 'socle-d', label: 'Socle droit', size: [T, s, D - 60], at: [W / 2 - T / 2, s / 2, 0], look: 'noir', sheet: { bends: 2, returns: 30 } });
  }
  const dz = D - T - 2;
  add({ id: 'cote-g', label: 'Côté gauche', size: [T, hb, dz], at: [-W / 2 + T / 2, yc, -D / 2 + dz / 2], look: 'tole', sheet: { bends: 4, returns: 25 } });
  add({ id: 'cote-d', label: 'Côté droit', size: [T, hb, dz], at: [W / 2 - T / 2, yc, -D / 2 + dz / 2], look: 'tole', sheet: { bends: 4, returns: 25 } });
  add({ id: 'fond', label: 'Fond', size: [W - 2 * T, hb, T], at: [0, yc, -D / 2 + T / 2], look: 'tole', sheet: { bends: 4, returns: 20 } });
  add({ id: 'toit', label: 'Toit', size: [W + 10, T, D + 10], at: [0, H - T / 2, 0], look: 'tole', sheet: { bends: 4, returns: 30 } });
  add({ id: 'bas', label: on(p, 'passeCables') ? 'Plaque passe-câbles' : 'Fond bas', size: [W - 2 * T, T, dz - T], at: [0, s + T / 2, -D / 2 + T + (dz - T) / 2], look: on(p, 'passeCables') ? 'galva' : 'tole', sheet: { bends: 2, returns: 20 } });
  if (on(p, 'passeCables')) {
    for (let i = 0; i < 4; i++) add({ id: `pe-${i}`, label: 'Presse-étoupe', size: [40, 30, 40], at: [-W / 2 + (W * (i + 1)) / 5, s + T + 15, 0], look: 'noir' });
  }
  if (on(p, 'plaque')) {
    const pw = W - 2 * T - 70;
    const ph = hb - 140;
    const pz = -D / 2 + T + 30;
    add({ id: 'plaque', label: 'Plaque de montage', size: [pw, ph, 2.5], at: [0, yc, pz], look: 'galva', sheet: { bends: 4, returns: 20 } });
    const n = Math.min(num(p, 'rails'), Math.floor(ph / 220));
    for (let i = 0; i < n; i++) {
      const y = s + 70 + (ph * (i + 1)) / (n + 1);
      add({ id: `rail-${i}`, label: `Rail DIN ${i + 1}`, size: [pw - 60, 35, 8], at: [0, y, pz + 6], look: 'galva' });
      // Appareillage modulaire : disjoncteurs de largeurs variées, toujours la même rangée pour une ligne donnée.
      let x = -pw / 2 + 50;
      let k = 0;
      while (x < pw / 2 - 90) {
        const w = 18 * (1 + ((i * 7 + k * 3) % 3));
        add({ id: `mod-${i}-${k}`, label: 'Appareillage modulaire', size: [w - 1, 85, 65], at: [x + w / 2, y, pz + 40], look: 'blanc' });
        x += w + (k % 5 === 4 ? 24 : 0);
        k++;
      }
    }
  }
  // Portes : charnières à gauche (et à droite pour la seconde), ouverture vers l'avant.
  const doors = Math.max(1, Math.min(2, Math.round(num(p, 'portes'))));
  const dw = doors === 1 ? W : W / 2 - 1;
  const zf = D / 2 - T / 2;
  for (let i = 0; i < doors; i++) {
    const left = i === 0;
    const id = `porte-${i}`;
    const cx = doors === 1 ? 0 : left ? -W / 4 : W / 4;
    motions.push({ id, label: doors === 1 ? 'Porte' : left ? 'Porte gauche' : 'Porte droite', type: 'hinge', axis: 'y', pivot: [left ? -W / 2 : W / 2, yc, D / 2], angle: left ? -105 : 105 });
    add({ id, label: doors === 1 ? 'Porte' : left ? 'Porte gauche' : 'Porte droite', size: [dw, hb - 4, T], at: [cx, yc, zf], look: 'tole', sheet: { bends: 4, returns: 22 }, motion: id });
    const hx = doors === 1 ? W / 2 - 50 : left ? -10 - 30 : 10 + 30;
    add({ id: `${id}-poignee`, label: 'Poignée', size: [24, 140, 30], at: [hx, s + hb * 0.5, zf + 16], look: 'noir', motion: id });
    if (on(p, 'ventilation')) {
      add({ id: `${id}-grille`, label: 'Grille de ventilation', size: [Math.min(220, dw * 0.6), 220, 6], at: [cx, s + 220, zf + 4], look: 'noir', motion: id });
    }
  }
  // Voyants en façade (porte gauche) et ventilateur en toiture.
  const vx = doors === 1 ? -W / 2 + 80 : -W / 2 + 60;
  ([[0x22c55e, 'Voyant sous tension', 'steady'], [0xf59e0b, 'Voyant défaut', 'blink'], [0x3b82f6, 'Voyant marche', 'pulse']] as const).forEach(([color, label, mode], i) => {
    add({ id: `voyant-${i}`, label, size: [22, 22, 10], at: [vx + i * 40, H - 120, zf + 6], look: 'led', color, glow: { color, mode }, motion: 'porte-0' });
  });
  if (on(p, 'ventilation')) {
    add({ id: 'ventilo-cadre', label: 'Ventilateur de toit', size: [200, 20, 200], at: [0, H + 10, 0], look: 'noir' });
    add({ id: 'ventilo', label: 'Hélice', size: [170, 6, 26], at: [0, H + 23, 0], look: 'galva', spin: 'y' });
  }
  return {
    panels,
    motions,
    mechanisms: [{ id: 'portes', label: doors === 1 ? 'Porte' : 'Portes', open: doors === 1 ? 'Ouvrir la porte' : 'Ouvrir les portes', close: doors === 1 ? 'Fermer la porte' : 'Fermer les portes', members: motions.map((m) => m.id) }],
  };
}

/** Une rangée de casiers, repère local : x de 0 à largeur, façade en z = 0, fond en z = −D. */
function lockerBank(prefix: string, cols: number, rows: number, cw: number, H: number, D: number, s: number, T: number, screenAt: number | null) {
  const panels: Panel[] = [];
  const motions: Motion[] = [];
  const W = cols * cw;
  const top = H - T;
  const rh = (top - s - T) / rows;
  const name = prefix === 'A' ? '' : ` (retour)`;
  panels.push({ id: `${prefix}-fond`, label: `Fond${name}`, size: [W, H - s, T], at: [W / 2, s + (H - s) / 2, -D + T / 2], look: 'tole', sheet: { bends: 4, returns: 20 } });
  panels.push({ id: `${prefix}-toit`, label: `Dessus${name}`, size: [W, T, D], at: [W / 2, H - T / 2, -D / 2], look: 'tole', sheet: { bends: 3, returns: 30 } });
  panels.push({ id: `${prefix}-bas`, label: `Dessous${name}`, size: [W, T, D], at: [W / 2, s + T / 2, -D / 2], look: 'tole', sheet: { bends: 2, returns: 25 } });
  if (s > 0) panels.push({ id: `${prefix}-socle`, label: `Socle${name}`, size: [W, s, T], at: [W / 2, s / 2, -40], look: 'noir', sheet: { bends: 2, returns: 40 } });
  for (let c = 0; c <= cols; c++) {
    panels.push({ id: `${prefix}-sep-${c}`, label: c === 0 || c === cols ? `Côté${name}` : `Séparation ${c}${name}`, size: [T, H - s, D], at: [c === cols ? W - T / 2 : c * cw + (c === 0 ? T / 2 : 0), s + (H - s) / 2, -D / 2], look: c === 0 || c === cols ? 'tole' : 'interieur', sheet: { bends: 2, returns: 20 } });
  }
  let n = 0;
  for (let c = 0; c < cols; c++) {
    const x0 = c * cw;
    if (c === screenAt) {
      // Borne : façade pleine avec écran, lecteur et fente colis.
      panels.push({ id: `${prefix}-borne`, label: 'Façade borne', size: [cw - 3, top - s - T, T], at: [x0 + cw / 2, s + T + (top - s - T) / 2, -T / 2], look: 'tole', sheet: { bends: 4, returns: 20 } });
      const sw = cw * 0.72;
      panels.push({ id: `${prefix}-ecran`, label: 'Écran tactile', size: [sw, sw * 1.45, 8], at: [x0 + cw / 2, Math.min(H - 260, 1350), 4], look: 'ecran', glow: { color: 0x7dd3fc, mode: 'steady' } });
      panels.push({ id: `${prefix}-lecteur`, label: 'Lecteur de badge / QR', size: [cw * 0.35, 70, 30], at: [x0 + cw / 2, Math.min(H - 260, 1350) - sw * 0.9, 15], look: 'noir', glow: { color: 0xef4444, mode: 'pulse' } });
      continue;
    }
    for (let r = 0; r < rows; r++) {
      const y0 = top - (r + 1) * rh;
      if (r > 0) panels.push({ id: `${prefix}-tab-${c}-${r}`, label: 'Tablette', size: [cw - T, T, D - T], at: [x0 + cw / 2, y0 + rh, -D / 2], look: 'interieur', sheet: { bends: 2, returns: 15 } });
      const id = `${prefix}-porte-${c}-${r}`;
      const label = `Casier ${prefix === 'A' ? '' : 'R'}${letter(c)}${r + 1}`;
      motions.push({ id, label, type: 'hinge', axis: 'y', pivot: [x0 + 1.5, y0 + rh / 2, 0], angle: -100 });
      panels.push({ id, label, size: [cw - 3, rh - 3, T], at: [x0 + cw / 2, y0 + rh / 2, T / 2], look: 'tole', sheet: { bends: 4, returns: 15 }, motion: id });
      panels.push({ id: `${id}-serrure`, label: 'Serrure électronique', size: [26, 46, 14], at: [x0 + cw - 32, y0 + rh / 2, T + 7], look: 'noir', motion: id });
      // Voyant : vert = libre, rouge = occupé (même tirage d'une fois à l'autre).
      const busy = (c * 7 + r * 3 + n) % 3 === 0;
      const color = busy ? 0xef4444 : 0x22c55e;
      panels.push({ id: `${id}-led`, label: busy ? 'Voyant occupé' : 'Voyant libre', size: [10, 10, 6], at: [x0 + cw - 32, y0 + rh / 2 + 36, T + 3], look: 'led', color, glow: { color, mode: busy ? 'steady' : 'pulse' }, motion: id });
      n++;
    }
  }
  return { panels, motions, width: W };
}

/** Rotation d'un quart de tour autour de Y (+90°) : la façade (z+) regarde vers x+. */
const rotY = ([x, y, z]: V3): V3 => [z, y, -x];

function locker(p: ProductSpec, T: number): ProductModel {
  const { width: W, height: H, depth: D } = p;
  const s = num(p, 'socle');
  const cols = Math.max(1, Math.round(num(p, 'colonnes')));
  const rows = Math.max(1, Math.round(num(p, 'rangees')));
  const screen = on(p, 'ecran');
  const slots = cols + (screen ? 1 : 0);
  const cw = W / slots;
  const a = lockerBank('A', slots, rows, cw, H, D, s, T, screen ? Math.floor(slots / 2) : null);
  // Rangée principale centrée en x, façade en z = D/2.
  const shift = (v: V3): V3 => [v[0] - W / 2, v[1], v[2] + D / 2];
  const panels: Panel[] = a.panels.map((x) => ({ ...x, at: shift(x.at) }));
  const motions: Motion[] = a.motions.map((m) => ({ ...m, pivot: m.pivot && shift(m.pivot) }));
  if (on(p, 'angle')) {
    // Module d'angle plein (carré D × D à gauche), puis le retour façade vers x+, le long du mur gauche.
    const xa = -W / 2 - D / 2;
    panels.push({ id: 'angle-face', label: 'Façade module d’angle', size: [T, H - s, D], at: [-W / 2 - D + T / 2, s + (H - s) / 2, 0], look: 'tole', sheet: { bends: 4, returns: 20 } });
    panels.push({ id: 'angle-avant', label: 'Habillage d’angle', size: [D, H - s, T], at: [xa, s + (H - s) / 2, D / 2 - T / 2], look: 'tole', sheet: { bends: 4, returns: 20 } });
    panels.push({ id: 'angle-toit', label: 'Dessus module d’angle', size: [D, T, D], at: [xa, H - T / 2, 0], look: 'tole', sheet: { bends: 3, returns: 30 } });
    const rc = Math.max(1, Math.round(num(p, 'colonnesRetour')));
    const b = lockerBank('B', rc, rows, cw, H, D, s, T, null);
    // Local → monde : rotation +90° puis la façade du retour en x = −W/2 − D … tournée vers x+, qui part de z = D/2 vers l'avant.
    const place = (v: V3): V3 => {
      const r = rotY([v[0] - b.width, v[1], v[2]]);
      return [r[0] - W / 2, r[1], r[2] + D / 2];
    };
    for (const x of b.panels) panels.push({ ...x, at: place(x.at), size: [x.size[2], x.size[1], x.size[0]] });
    for (const m of b.motions) motions.push({ ...m, pivot: m.pivot && place(m.pivot) });
  }
  const doors = motions.map((m) => m.id);
  return {
    panels,
    motions,
    mechanisms: [
      { id: 'portes', label: 'Casiers', open: 'Ouvrir tous les casiers', close: 'Fermer les casiers', members: doors },
      { id: 'un', label: 'Un casier', open: 'Ouvrir un casier', close: 'Refermer le casier', members: doors.slice(Math.floor(doors.length / 3), Math.floor(doors.length / 3) + 1) },
    ],
  };
}

function photomaton(p: ProductSpec, T: number): ProductModel {
  const { width: W, height: H, depth: D } = p;
  const panels: Panel[] = [];
  const motions: Motion[] = [];
  const add: Add = (x) => panels.push(x);
  const find = (id: string) => panels.find((x) => x.id === id);
  const base = 120;
  const zf = D / 2 - T / 2;
  add({ id: 'socle', label: 'Socle', size: [W, base, D], at: [0, base / 2, 0], look: 'noir', sheet: { bends: 4, returns: 40 } });
  add({ id: 'cote-g', label: 'Côté gauche', size: [T, H - base - T, D], at: [-W / 2 + T / 2, base + (H - base - T) / 2, 0], look: 'tole', sheet: { bends: 4, returns: 25 } });
  add({ id: 'cote-d', label: 'Côté droit', size: [T, H - base - T, D], at: [W / 2 - T / 2, base + (H - base - T) / 2, 0], look: 'tole', sheet: { bends: 4, returns: 25 } });
  add({ id: 'fond', label: 'Fond', size: [W - 2 * T, H - base - T, T], at: [0, base + (H - base - T) / 2, -D / 2 + T / 2], look: 'tole', sheet: { bends: 4, returns: 20 } });
  add({ id: 'toit', label: 'Toit', size: [W, T, D], at: [0, H - T / 2, 0], look: 'tole', sheet: { bends: 4, returns: 30 } });
  add({ id: 'plancher', label: 'Plancher', size: [W - 2 * T, T, D - 2 * T], at: [0, base + T / 2, 0], look: 'noir', sheet: { bends: 2, returns: 20 } });
  const y0 = base + T;
  // Façade : partie gauche fermée (accueil, paiement, impression, trappe de service), entrée à droite sous un bandeau.
  const fl = W * 0.42;
  const xl = -W / 2 + T + (fl - T) / 2;
  const hl = 380;
  const fh = H - T - base - hl;
  add({ id: 'facade', label: 'Façade gauche', size: [fl - T, fh, T], at: [xl, base + fh / 2, zf], look: 'tole', sheet: { bends: 4, returns: 25 } });
  add({ id: 'bandeau', label: 'Bandeau d’entrée', size: [W - 2 * T, hl, T], at: [0, H - T - hl / 2, zf], look: 'tole', sheet: { bends: 4, returns: 25 } });
  if (on(p, 'enseigne')) add({ id: 'enseigne', label: 'Enseigne lumineuse', size: [W * 0.7, hl * 0.55, 20], at: [0, H - T - hl / 2, zf + T / 2 + 10], look: 'led', color: 0xfef3c7, glow: { color: 0xfff1b8, mode: 'steady' } });
  // Écran d'accueil et paiement : en façade (dehors) ou sur la face intérieure de la façade.
  const inside = opt(p, 'commandes') === 'interieur';
  const zc = (d: number) => (inside ? zf - T / 2 - 1 - d / 2 : zf + T / 2 + d / 2);
  add({ id: 'ecran-ext', label: 'Écran d’accueil', size: [fl * 0.5, fl * 0.38, 8], at: [xl, 1350, zc(8)], look: 'ecran', glow: { color: 0x93c5fd, mode: 'steady' }, mounted: inside });
  add({ id: 'paiement', label: 'Terminal de paiement', size: [fl * 0.3, 160, 40], at: [xl, 1050, zc(40)], look: 'noir', glow: { color: 0x22c55e, mode: 'pulse' }, mounted: inside });
  if (on(p, 'imprimante')) {
    add({ id: 'fente', label: 'Sortie photos', size: [160, 30, 30], at: [xl, 820, zf + T / 2 + 15], look: 'noir' });
    motions.push({ id: 'impression', label: 'Impression', type: 'slide', move: [0, -150, 0], auto: true, hold: true });
    add({ id: 'bande', label: 'Bande de photos', size: [50, 150, 2], at: [xl, 830, zf + T / 2 + 22], look: 'blanc', motion: 'impression' });
  }
  // Trappe de service : la façade est ouverte derrière, sur un compartiment technique (imprimante, PC, alimentation).
  const th = 420;
  const ty = y0 + 40 + th / 2;
  const tw = fl * 0.7;
  motions.push({ id: 'trappe', label: 'Trappe de service', type: 'hinge', axis: 'x', pivot: [xl, ty - th / 2, zf + T / 2], angle: 80 });
  add({ id: 'trappe', label: 'Trappe de service', size: [tw, th, T], at: [xl, ty, zf + T], look: 'tole', sheet: { bends: 4, returns: 15, hems: 2 }, motion: 'trappe' });
  add({ id: 'trappe-serrure', label: 'Serrure', size: [40, 40, 12], at: [xl, ty + th / 2 - 40, zf + T * 1.5 + 6], look: 'noir', motion: 'trappe' });
  openingFor(find('facade'), { id: 'x', label: '', size: [tw, th, T], at: [xl, ty, zf], look: 'tole' }, 15);
  const cd = Math.min(380, D * 0.45);
  const zb = zf - T / 2 - cd;
  add({ id: 'compartiment-dessus', label: 'Compartiment technique : dessus', size: [tw, T, cd], at: [xl, ty + th / 2 - 15 + T / 2, zf - T / 2 - cd / 2], look: 'interieur', sheet: { bends: 2, returns: 20 } });
  add({ id: 'compartiment-dos', label: 'Compartiment technique : dos', size: [tw, th - 15, T], at: [xl, y0 + (th - 15) / 2 + 40, zb], look: 'interieur', sheet: { bends: 2, returns: 20 },
    cutouts: [[0, -th / 2 + 60, 120, 40]] });
  add({ id: 'compartiment-tablette', label: 'Compartiment technique : tablette', size: [tw, T, cd], at: [xl, y0 + 40 + T / 2, zf - T / 2 - cd / 2], look: 'interieur', sheet: { bends: 2, returns: 20 } });
  add({ id: 'imprimante', label: 'Imprimante à sublimation (composant)', size: [tw * 0.5, 220, cd * 0.7], at: [xl - tw * 0.2, y0 + 40 + T + 110, zf - T / 2 - cd * 0.45], look: 'noir' });
  add({ id: 'pc', label: 'PC de la cabine (composant)', size: [tw * 0.28, 260, cd * 0.6], at: [xl + tw * 0.3, y0 + 40 + T + 130, zf - T / 2 - cd * 0.4], look: 'blanc', glow: { color: 0x60a5fa, mode: 'pulse' } });
  // Prise de vue : écran, caméra et flashs sur le mur choisi ; le siège leur fait face.
  const wall = opt(p, 'priseVue') as Wall;
  if (on(p, 'ecran')) add({ id: 'ecran', label: 'Écran de prise de vue', ...onWall(wall, [W * 0.32, W * 0.24, 10], 1300, 0, W, D, T), look: 'ecran', glow: { color: 0xbfdbfe, mode: 'steady' }, mounted: true });
  add({ id: 'camera', label: 'Caméra', ...onWall(wall, [90, 60, 50], 1300 + W * 0.12 + 40, 0, W, D, T), look: 'noir', glow: { color: 0xef4444, mode: 'blink' }, mounted: true });
  const span = wall === 'fond' ? W : D;
  for (const sx of [-1, 1]) add({ id: `flash-${sx}`, label: 'Flash', ...onWall(wall, [120, 420, 30], 1350, sx * span * 0.3, W, D, T), look: 'led', color: 0xf8fafc, glow: { color: 0xffffff, mode: 'flash' } });
  add({ id: 'plafonnier', label: 'Plafonnier', size: [W * 0.5, 12, D * 0.4], at: [0, H - T - 6, 0], look: 'led', color: 0xf8fafc, glow: { color: 0xfff7e6, mode: 'steady' } });
  // Siège : face à la caméra par défaut (milieu de la pièce, décalé à l'opposé du mur de prise de vue).
  const side = opt(p, 'siegeCote');
  const cx = wall === 'gauche' ? W * 0.15 : wall === 'droite' ? -W * 0.15 : W * 0.08;
  const cz = wall === 'fond' ? D * 0.12 : -D * 0.2;
  // À gauche, le compartiment technique occupe l'avant : le siège recule vers le fond.
  const back = side === 'gauche' ? -(cd / 2 + 40) : 0;
  seat(add, opt(p, 'siege'), side === 'centre' ? 'centre' : (side as Wall), y0, W, D, T, cx, side === 'gauche' ? -D * 0.2 : cz, back, side === 'gauche' ? D - cd - 2 * T - 30 : Infinity);
  if (on(p, 'rideau')) {
    const rw = W - fl - 20;
    motions.push({ id: 'rideau', label: 'Rideau', type: 'fold', pivot: [W / 2 - T, 0, 0], scale: 0.18 });
    add({ id: 'rideau', label: 'Rideau', size: [rw, fh - 20, 8], at: [W / 2 - T - rw / 2, base + 10 + (fh - 20) / 2, zf - T / 2 - 10], look: 'rideau', motion: 'rideau' });
    add({ id: 'tringle', label: 'Tringle', size: [W - fl, 20, 20], at: [W / 2 - (W - fl) / 2, H - T - hl - 10, zf - T / 2 - 10], look: 'galva' });
  }
  const mechanisms: Mechanism[] = [];
  if (on(p, 'rideau')) mechanisms.push({ id: 'rideau', label: 'Rideau', open: 'Ouvrir le rideau', close: 'Fermer le rideau', members: ['rideau'] });
  mechanisms.push({ id: 'trappe', label: 'Trappe', open: 'Ouvrir la trappe de service', close: 'Fermer la trappe', members: ['trappe'] });
  return { panels, motions, mechanisms };
}

function pharmacie(p: ProductSpec, T: number): ProductModel {
  const { width: W, height: H, depth: D } = p;
  const panels: Panel[] = [];
  const motions: Motion[] = [];
  const add = (x: Panel) => panels.push(x);
  const zf = D / 2 - T / 2;
  add({ id: 'socle', label: 'Socle', size: [W, 80, D], at: [0, 40, 0], look: 'noir', sheet: { bends: 4, returns: 40 } });
  add({ id: 'cote-g', label: 'Côté gauche', size: [T, H - 80, D], at: [-W / 2 + T / 2, 80 + (H - 80) / 2, 0], look: 'tole', sheet: { bends: 4, returns: 25 } });
  add({ id: 'cote-d', label: 'Côté droit', size: [T, H - 80, D], at: [W / 2 - T / 2, 80 + (H - 80) / 2, 0], look: 'tole', sheet: { bends: 4, returns: 25 } });
  add({ id: 'toit', label: 'Toit', size: [W, T, D], at: [0, H - T / 2, 0], look: 'tole', sheet: { bends: 4, returns: 30 } });
  // Arrière : porte de maintenance (charnière à gauche vue de derrière) ou fond fixe.
  if (on(p, 'maintenance')) {
    motions.push({ id: 'maintenance', label: 'Porte de maintenance', type: 'hinge', axis: 'y', pivot: [-W / 2, H / 2, -D / 2], angle: 100 });
    add({ id: 'maintenance', label: 'Porte de maintenance', size: [W - 2 * T, H - 80 - T, T], at: [0, 80 + (H - 80 - T) / 2, -D / 2 + T / 2], look: 'tole', sheet: { bends: 4, returns: 22 }, motion: 'maintenance' });
    add({ id: 'maintenance-poignee', label: 'Poignée', size: [24, 140, 30], at: [W / 2 - 60, H / 2, -D / 2 - 14], look: 'noir', motion: 'maintenance' });
  } else add({ id: 'fond', label: 'Fond', size: [W - 2 * T, H - 80 - T, T], at: [0, 80 + (H - 80 - T) / 2, -D / 2 + T / 2], look: 'tole', sheet: { bends: 4, returns: 20 } });
  // Stockage : étagères et boîtes de médicaments, sur l'arrière ; le robot circule devant.
  const n = Math.max(2, Math.round(num(p, 'etageres')));
  const sd = D * 0.45;
  const sz = -D / 2 + T + sd / 2 + 10;
  const colors = [0xf8fafc, 0x93c5fd, 0xfca5a5, 0x86efac, 0xfde68a, 0xc4b5fd];
  for (let i = 0; i < n; i++) {
    const y = 160 + ((H - 300) * i) / n;
    add({ id: `etagere-${i}`, label: `Étagère ${i + 1}`, size: [W - 2 * T - 20, T, sd], at: [0, y, sz], look: 'interieur', sheet: { bends: 2, returns: 20 } });
    const bh = Math.min(120, ((H - 300) / n) * 0.7);
    let x = -W / 2 + 40;
    let k = 0;
    while (x < W / 2 - 100) {
      const bw = 50 + ((i * 5 + k * 7) % 4) * 15;
      add({ id: `boite-${i}-${k}`, label: 'Boîte de médicament', size: [bw - 4, bh * (0.7 + ((i + k) % 3) * 0.15), sd * 0.8], at: [x + bw / 2, y + T / 2 + (bh * (0.7 + ((i + k) % 3) * 0.15)) / 2, sz], look: 'boite', color: colors[(i + k * 3) % colors.length] });
      x += bw + 3;
      k++;
    }
  }
  // Robot de préhension : rail haut, chariot qui va et vient en marche.
  motions.push({ id: 'robot', label: 'Robot de préhension', type: 'slide', move: [W * 0.6, 0, 0], auto: true });
  const rz = sz + sd / 2 + 60;
  add({ id: 'rail', label: 'Rail du robot', size: [W - 2 * T - 20, 40, 60], at: [0, H - 120, rz], look: 'galva' });
  add({ id: 'robot-mat', label: 'Mât du robot', size: [50, H - 300, 50], at: [-W * 0.3, (H - 300) / 2 + 160, rz], look: 'galva', motion: 'robot' });
  add({ id: 'robot-pince', label: 'Pince', size: [120, 80, 140], at: [-W * 0.3, H * 0.55, rz - 60], look: 'noir', motion: 'robot', glow: { color: 0x38bdf8, mode: 'pulse' } });
  // Façade : écran, lecteur, trappe de délivrance, tiroirs de retrait.
  const fw = W - 2 * T;
  add({ id: 'facade-haut', label: 'Façade haute', size: [fw, H * 0.3, T], at: [0, H - T - H * 0.15, zf], look: 'tole', sheet: { bends: 4, returns: 25 } });
  add({ id: 'facade-bas', label: 'Façade basse', size: [fw, H * 0.7 - 80 - T, T], at: [0, 80 + (H * 0.7 - 80 - T) / 2, zf], look: 'tole', sheet: { bends: 4, returns: 25 } });
  const cx = -W * 0.18;
  if (on(p, 'ecran')) {
    add({ id: 'ecran', label: 'Écran tactile', size: [360, 560, 10], at: [cx, 1350, zf + 8], look: 'ecran', glow: { color: 0x86efac, mode: 'steady' } });
    add({ id: 'lecteur', label: 'Lecteur carte Vitale / ordonnance', size: [220, 80, 50], at: [cx, 1000, zf + 25], look: 'noir', glow: { color: 0x22c55e, mode: 'pulse' } });
  }
  if (on(p, 'trappe')) {
    add({ id: 'guichet', label: 'Guichet de délivrance', size: [380, 260, 300], at: [cx, 760, zf - 150], look: 'interieur', glow: { color: 0xfef9c3, mode: 'steady' } });
    motions.push({ id: 'trappe', label: 'Trappe de délivrance', type: 'slide', move: [0, 270, 0] });
    add({ id: 'trappe', label: 'Trappe de délivrance', size: [380, 260, 6], at: [cx, 760, zf + 6], look: 'verre', motion: 'trappe' });
  }
  const nt = Math.max(0, Math.round(num(p, 'tiroirs')));
  const tx = W * 0.25;
  const th = Math.min(220, (H * 0.6 - 200) / Math.max(nt, 1));
  const tirs: string[] = [];
  for (let i = 0; i < nt; i++) {
    const id = `tiroir-${i}`;
    const y = 300 + i * (th + 20) + th / 2;
    tirs.push(id);
    motions.push({ id, label: `Tiroir ${i + 1}`, type: 'slide', move: [0, 0, D * 0.4] });
    drawer(add, id, `Tiroir ${i + 1}`, id, [tx, y, zf + 4], W * 0.32, th, D * 0.42, T, false);
    openingFor(panels.find((x) => x.id === 'facade-bas'), panels.find((x) => x.id === id), 8);
    add({ id: `${id}-led`, label: 'Voyant', size: [40, 8, 6], at: [tx, y + th / 2 - 18, zf + 8], look: 'led', color: 0x22c55e, glow: { color: 0x22c55e, mode: 'pulse' }, motion: id });
  }
  if (on(p, 'croix')) {
    const cy = H - T - H * 0.15;
    add({ id: 'croix-v', label: 'Croix lumineuse', size: [90, 280, 30], at: [W * 0.25, cy, zf + 18], look: 'led', color: 0x16a34a, glow: { color: 0x22c55e, mode: 'pulse' } });
    add({ id: 'croix-h', label: 'Croix lumineuse', size: [280, 90, 30], at: [W * 0.25, cy, zf + 18], look: 'led', color: 0x16a34a, glow: { color: 0x22c55e, mode: 'pulse' } });
  }
  // Façade réellement ouverte derrière l'écran, le lecteur et la trappe ; moteur du robot en bout de rail.
  const fb = panels.find((x) => x.id === 'facade-bas');
  for (const id of ['ecran', 'lecteur', 'trappe']) openingFor(fb, panels.find((x) => x.id === id), 10);
  motorMount(add, 'robot-moteur', 'Support moteur du robot', [W / 2 - T - 110, H - 200, rz], 140, 100, 60);
  cablePass(panels.find((x) => x.id === 'toit'), [[W / 2 - 120, 0, 40]]);
  const mechanisms: Mechanism[] = [];
  if (on(p, 'trappe')) mechanisms.push({ id: 'trappe', label: 'Trappe', open: 'Ouvrir la trappe', close: 'Fermer la trappe', members: ['trappe'] });
  if (nt) mechanisms.push({ id: 'tiroirs', label: 'Tiroirs', open: 'Sortir les tiroirs', close: 'Rentrer les tiroirs', members: tirs });
  if (on(p, 'maintenance')) mechanisms.push({ id: 'maintenance', label: 'Maintenance', open: 'Ouvrir la maintenance', close: 'Fermer la maintenance', members: ['maintenance'] });
  return { panels, motions, mechanisms };
}

// --- Nouvelles machines ---------------------------------------------------------------------------

type Add = (x: Panel) => void;

/** Porte ou cadre vitré : quatre montants en tôle et un vitrage, entraînés par `motion` s'il y en a un. */
function glazed(add: Add, id: string, label: string, [cx, cy, cz]: V3, w: number, h: number, T: number, motion?: string, frame = 70) {
  const f = Math.min(frame, w / 4, h / 4);
  const sheet = { bends: 2, returns: 20 };
  add({ id: `${id}-haut`, label: `${label} : traverse haute`, size: [w, f, T], at: [cx, cy + h / 2 - f / 2, cz], look: 'tole', sheet, motion });
  add({ id: `${id}-bas`, label: `${label} : traverse basse`, size: [w, f * 1.6, T], at: [cx, cy - h / 2 + f * 0.8, cz], look: 'tole', sheet, motion });
  add({ id: `${id}-g`, label: `${label} : montant gauche`, size: [f, h - 2.6 * f, T], at: [cx - w / 2 + f / 2, cy + f * 0.3, cz], look: 'tole', sheet, motion });
  add({ id: `${id}-d`, label: `${label} : montant droit`, size: [f, h - 2.6 * f, T], at: [cx + w / 2 - f / 2, cy + f * 0.3, cz], look: 'tole', sheet, motion });
  // Vitrage pris dans l'épaisseur du cadre : il ne dépasse ni dedans ni dehors.
  add({ id: `${id}-verre`, label: `${label} : vitrage`, size: [w - 2 * f + 8, h - 2.6 * f + 8, T], at: [cx, cy + f * 0.3, cz], look: 'verre', motion });
}

/** Caisse simple : côtés, fond, dessus et dessous, de y0 à y1 (façade ouverte, à habiller). */
function carcass(add: Add, W: number, D: number, y0: number, y1: number, T: number, back = true) {
  const h = y1 - y0;
  const yc = y0 + h / 2;
  add({ id: 'cote-g', label: 'Côté gauche', size: [T, h, D], at: [-W / 2 + T / 2, yc, 0], look: 'tole', sheet: { bends: 4, returns: 25 } });
  add({ id: 'cote-d', label: 'Côté droit', size: [T, h, D], at: [W / 2 - T / 2, yc, 0], look: 'tole', sheet: { bends: 4, returns: 25 } });
  if (back) add({ id: 'fond', label: 'Fond', size: [W - 2 * T, h, T], at: [0, yc, -D / 2 + T / 2], look: 'tole', sheet: { bends: 4, returns: 20 },
    cutouts: W > 250 && h > 300 ? [[0, -h / 2 + 70, Math.min(160, W * 0.4), 40]] : undefined });
  add({ id: 'dessus', label: 'Dessus', size: [W, T, D], at: [0, y1 - T / 2, 0], look: 'tole', sheet: { bends: 4, returns: 25 } });
  // Passages de câbles (le câblage lui-même n'est pas dessiné) : deux trous Ø40 au fond, une lumière en bas du dos.
  add({ id: 'dessous', label: 'Dessous', size: [W - 2 * T, T, D - 2 * T], at: [0, y0 + T / 2, 0], look: 'tole', sheet: { bends: 2, returns: 20 },
    holes: W > 200 && D > 150 ? [[-W / 4, D / 6, 40], [W / 4, D / 6, 40]] : undefined });
}

function cabine(p: ProductSpec, T: number): ProductModel {
  const { width: W, height: H, depth: D } = p;
  const panels: Panel[] = [];
  const motions: Motion[] = [];
  const add: Add = (x) => panels.push(x);
  const base = 80;
  const roof = 140;
  const hw = H - roof - base;
  const yc = base + hw / 2;
  add({ id: 'socle', label: 'Socle', size: [W, base, D], at: [0, base / 2, 0], look: 'noir', sheet: { bends: 4, returns: 40 } });
  add({ id: 'plancher', label: 'Plancher', size: [W - 2 * T, T, D - 2 * T], at: [0, base + T / 2, 0], look: 'noir', sheet: { bends: 2, returns: 20 } });
  add({ id: 'toit', label: 'Toit', size: [W + 40, roof, D + 40], at: [0, H - roof / 2, 0], look: 'tole', sheet: { bends: 4, returns: roof } });
  for (const [side, x] of [['gauche', -W / 2 + T / 2], ['droit', W / 2 - T / 2]] as const) {
    if (on(p, 'vitree')) {
      add({ id: `cote-${side}-bas`, label: `Côté ${side} : allège`, size: [T, 900, D], at: [x, base + 450, 0], look: 'tole', sheet: { bends: 4, returns: 25 } });
      add({ id: `cote-${side}-av`, label: `Côté ${side} : montant avant`, size: [T, hw - 900, 70], at: [x, base + 900 + (hw - 900) / 2, D / 2 - 35], look: 'tole', sheet: { bends: 2, returns: 25 } });
      add({ id: `cote-${side}-ar`, label: `Côté ${side} : montant arrière`, size: [T, hw - 900, 70], at: [x, base + 900 + (hw - 900) / 2, -D / 2 + 35], look: 'tole', sheet: { bends: 2, returns: 25 } });
      add({ id: `cote-${side}-verre`, label: `Côté ${side} : vitrage`, size: [T, hw - 900, D - 140], at: [x, base + 900 + (hw - 900) / 2, 0], look: 'verre' });
    } else add({ id: `cote-${side}`, label: `Côté ${side}`, size: [T, hw, D], at: [x, yc, 0], look: 'tole', sheet: { bends: 4, returns: 25 } });
  }
  add({ id: 'fond', label: 'Fond', size: [W - 2 * T, hw, T], at: [0, yc, -D / 2 + T / 2], look: 'tole', sheet: { bends: 4, returns: 20 } });
  // Façade : dormant, puis la porte (charnières à gauche, ouverture vers l'extérieur).
  const post = 70;
  add({ id: 'dormant-g', label: 'Dormant gauche', size: [post, hw, T], at: [-W / 2 + post / 2, yc, D / 2 - T / 2], look: 'tole', sheet: { bends: 2, returns: 30 } });
  add({ id: 'dormant-d', label: 'Dormant droit', size: [post, hw, T], at: [W / 2 - post / 2, yc, D / 2 - T / 2], look: 'tole', sheet: { bends: 2, returns: 30 } });
  const dw = W - 2 * post - 4;
  motions.push({ id: 'porte', label: 'Porte', type: 'hinge', axis: 'y', pivot: [-W / 2 + post, yc, D / 2], angle: -100 });
  if (on(p, 'vitree')) glazed(add, 'porte', 'Porte', [0, yc, D / 2 + T / 2], dw, hw - 4, T, 'porte', 90);
  else add({ id: 'porte', label: 'Porte', size: [dw, hw - 4, T], at: [0, yc, D / 2 + T / 2], look: 'tole', sheet: { bends: 4, returns: 22 }, motion: 'porte' });
  add({ id: 'porte-poignee', label: 'Poignée', size: [30, 300, 40], at: [W / 2 - post - 60, base + 1050, D / 2 + T + 20], look: 'galva', motion: 'porte' });
  // Intérieur : poste et tablette sur le mur choisi, siège posé au sol ou rabattable contre un mur.
  const pw = opt(p, 'posteMur') as Wall;
  const y0 = base + T;
  if (on(p, 'tablette')) add({ id: 'tablette', label: 'Tablette', ...onWall(pw, [Math.min(W, D) * 0.6, 30, 300], y0 + 950, 0, W, D, T), look: 'bois' });
  if (on(p, 'telephone')) {
    add({ id: 'poste', label: 'Poste téléphonique / visio', ...onWall(pw, [260, 340, 90], y0 + 1380, 0, W, D, T), look: 'noir' });
    add({ id: 'poste-ecran', label: 'Écran du poste', ...onWall(pw, [200, 120, 6], y0 + 1460, 0, W, D, T + 90), look: 'ecran', glow: { color: 0x93c5fd, mode: 'steady' }, mounted: true });
    add({ id: 'poste-clavier', label: 'Clavier', ...onWall(pw, [160, 100, 6], y0 + 1320, 0, W, D, T + 90), look: 'galva', glow: { color: 0x22c55e, mode: 'pulse' }, mounted: true });
  }
  const sk = opt(p, 'siege');
  const sc = opt(p, 'siegeCote');
  if (sk === 'rabattable') {
    // Strapontin : console fixée au mur, assise rabattable dessus.
    const w2: Wall = sc === 'centre' ? 'fond' : (sc as Wall);
    add({ id: 'assise-console', label: 'Console d’assise', ...onWall(w2, [360, 60, 40], y0 + 420, 0, W, D, T), look: 'galva', sheet: { bends: 2, returns: 30 } });
    add({ id: 'assise', label: 'Assise rabattable', ...onWall(w2, [400, 30, 340], y0 + 465, 0, W, D, T), look: 'bois' });
  } else seat(add, sk, sc === 'centre' ? 'centre' : (sc as Wall), y0, W, D, T);
  if (on(p, 'ventilation')) {
    add({ id: 'ventilo-cadre', label: 'Ventilation', size: [240, 12, 240], at: [W * 0.2, H - roof - 6, 0], look: 'noir' });
    add({ id: 'ventilo', label: 'Hélice', size: [200, 6, 30], at: [W * 0.2, H - roof - 16, 0], look: 'galva', spin: 'y' });
  }
  if (on(p, 'eclairage')) {
    add({ id: 'plafonnier', label: 'Plafonnier', size: [W * 0.35, 12, D * 0.35], at: [-W * 0.15, H - roof - 6, 0], look: 'led', color: 0xf8fafc, glow: { color: 0xfff7e6, mode: 'steady' } });
    add({ id: 'enseigne', label: 'Enseigne', size: [W * 0.7, 80, 10], at: [0, H - roof / 2, D / 2 + 25], look: 'led', color: 0xfef3c7, glow: { color: 0xfff1b8, mode: 'steady' } });
  }
  return { panels, motions, mechanisms: [{ id: 'porte', label: 'Porte', open: 'Ouvrir la porte', close: 'Fermer la porte', members: ['porte'] }] };
}

function kiosque(p: ProductSpec, T: number): ProductModel {
  const { width: W, height: H, depth: D } = p;
  const panels: Panel[] = [];
  const motions: Motion[] = [];
  const add: Add = (x) => panels.push(x);
  const find = (id: string) => panels.find((x) => x.id === id);
  const zf = D / 2 - T / 2;
  const zs = D / 2; // face avant de la façade
  add({ id: 'platine', label: 'Platine de pied', size: [W + 200, 20, D + 200], at: [0, 10, 0], look: 'galva', sheet: { bends: 0, returns: 0 } });
  carcass(add, W, D, 20, H, T, !on(p, 'maintenance'));
  add({ id: 'facade', label: 'Façade', size: [W - 2 * T, H - 20 - T, T], at: [0, 20 + (H - 20 - T) / 2, zf], look: 'tole', sheet: { bends: 4, returns: 25 } });
  if (on(p, 'maintenance')) {
    motions.push({ id: 'maintenance', label: 'Porte de maintenance', type: 'hinge', axis: 'y', pivot: [-W / 2, H / 2, -D / 2], angle: 100 });
    add({ id: 'maintenance', label: 'Porte de maintenance', size: [W - 2 * T, H - 20 - T, T], at: [0, 20 + (H - 20 - T) / 2, -D / 2 + T / 2], look: 'tole', sheet: { bends: 4, returns: 22 }, motion: 'maintenance' });
    add({ id: 'maintenance-serrure', label: 'Serrure', size: [40, 40, 14], at: [W / 2 - 60, H * 0.6, -D / 2 - 7], look: 'noir', motion: 'maintenance' });
  }
  // En-tête lumineux.
  add({ id: 'bandeau', label: 'Bandeau lumineux', size: [W - 60, 70, 8], at: [0, H - 70, zs + 4], look: 'led', color: 0x67e8f9, glow: { color: 0x0891b2, mode: 'steady' }, text: 'BIENVENUE', mounted: true });
  // Écran portrait (9:16) dans un cadre noir.
  const diag = num(p, 'pouces') * 25.4;
  const sw = Math.min(diag * 0.49, W - 110);
  const sh = Math.min(diag * 0.872, H * 0.45);
  const sy = H - 130 - sh / 2 - 25;
  add({ id: 'cadre-ecran', label: 'Cadre d’écran', size: [sw + 50, sh + 50, 10], at: [0, sy, zs + 5], look: 'noir', mounted: true });
  add({ id: 'ecran', label: `Écran tactile ${num(p, 'pouces')} pouces`, size: [sw, sh, 4], at: [0, sy, zs + 12], look: 'ecran', glow: { color: 0x7dd3fc, mode: 'steady' }, text: 'Touchez pour commencer', mounted: true });
  openingFor(find('facade'), { id: 'x', label: '', size: [sw, sh, T], at: [0, sy, zf], look: 'tole' }, 10);
  // Plastron de paiement : plaque en saillie qui regroupe carte, sans contact, QR code et reçu, chacun signalé.
  const top = sy - sh / 2 - 60;
  const ph = Math.min(680, top - 140);
  const py = top - ph / 2;
  const pz = zs + 20;
  add({ id: 'plastron', label: 'Plastron de paiement', size: [W - 80, ph, T], at: [0, py, pz + T / 2], look: 'tole', sheet: { bends: 4, returns: 20, hems: 2 } });
  for (const s of [-1, 1]) add({ id: `plastron-entretoise${s}`, label: 'Entretoise', size: [20, ph - 40, 20], at: [s * (W / 2 - 60), py, zs + 10], look: 'galva' });
  const zp = pz + T; // face avant du plastron
  const label = (id: string, text: string, x: number, y: number, w: number) =>
    add({ id: `${id}-etiquette`, label: `Pictogramme ${text}`, size: [w, 26, 1], at: [x, y, zp + 0.5], look: 'noir', text, mounted: true });
  let y = top - 40;
  const row1 = on(p, 'lecteurCarte') || on(p, 'sansContact');
  if (row1) {
    const bx = on(p, 'lecteurCarte') && on(p, 'sansContact') ? W * 0.2 : 0;
    if (on(p, 'lecteurCarte')) {
      // Terminal de paiement : boîtier, petit écran, clavier, fente à carte en bas.
      const x = on(p, 'sansContact') ? -bx : 0;
      add({ id: 'tpe', label: 'Terminal de paiement (composant)', size: [120, 190, 45], at: [x, y - 95, zp + 22.5], look: 'noir', mounted: true });
      add({ id: 'tpe-ecran', label: 'Écran du terminal', size: [88, 54, 3], at: [x, y - 50, zp + 46.5], look: 'ecran', glow: { color: 0xa7f3d0, mode: 'steady' }, mounted: true });
      add({ id: 'tpe-clavier', label: 'Clavier du terminal', size: [88, 80, 3], at: [x, y - 120, zp + 46.5], look: 'galva', text: '1 2 3  4 5 6  7 8 9', mounted: true });
      add({ id: 'tpe-fente', label: 'Fente carte', size: [80, 8, 12], at: [x, y - 182, zp + 51], look: 'noir', glow: { color: 0x22c55e, mode: 'pulse' }, mounted: true });
      label('tpe', 'CARTE BANCAIRE', x, y - 215, 150);
    }
    if (on(p, 'sansContact')) {
      const x = on(p, 'lecteurCarte') ? bx : 0;
      add({ id: 'nfc', label: 'Zone sans contact', size: [130, 130, 6], at: [x, y - 90, zp + 3], look: 'blanc', glow: { color: 0x60a5fa, mode: 'pulse' }, text: ')))', mounted: true });
      label('nfc', 'SANS CONTACT', x, y - 215, 150);
    }
    y -= 250;
  }
  if (on(p, 'scanner')) {
    // Lecteur QR : fenêtre de lecture rouge sous une casquette.
    add({ id: 'scanner', label: 'Lecteur QR code / badge', size: [170, 90, 30], at: [0, y - 50, zp + 15], look: 'noir', mounted: true });
    add({ id: 'scanner-vitre', label: 'Fenêtre de lecture', size: [130, 50, 2], at: [0, y - 50, zp + 31], look: 'verre', glow: { color: 0xef4444, mode: 'pulse' }, mounted: true });
    label('scanner', 'SCANNEZ VOTRE QR CODE', 0, y - 112, 220);
    y -= 175;
  }
  if (on(p, 'imprimante')) {
    // Imprimante : le reçu sort de la fente à la fin de la séance et reste sorti.
    const slotY = Math.max(py - ph / 2 + 60, y - 50);
    add({ id: 'imprimante', label: 'Sortie des reçus', size: [170, 24, 30], at: [0, slotY, zp + 15], look: 'noir', mounted: true });
    label('recu', 'VOTRE REÇU', 0, slotY + 32, 130);
    motions.push({ id: 'ticket', label: 'Impression du reçu', type: 'fold', axis: 'y', pivot: [0, slotY - 12, zp + 26], scale: 0.02, auto: true, hold: true });
    add({ id: 'ticket', label: 'Reçu', size: [70, 140, 1], at: [0, slotY - 12 - 70, zp + 26], look: 'blanc', motion: 'ticket' });
    add({ id: 'imprimante-support', label: 'Support d’imprimante', size: [W - 2 * T, 3, 200], at: [0, slotY - 60, zf - 120], look: 'galva', sheet: { bends: 2, returns: 40 }, holes: [[-90, -80, 5], [90, -80, 5], [-90, 80, 5], [90, 80, 5]] });
  }
  // Passage des câbles du plastron vers l'intérieur.
  cablePass(find('facade'), [], [[0, py - (20 + (H - 20 - T) / 2), 60, 30]]);
  return { panels, motions, mechanisms: on(p, 'maintenance') ? [{ id: 'maintenance', label: 'Maintenance', open: 'Ouvrir la maintenance', close: 'Fermer la maintenance', members: ['maintenance'] }] : [] };
}

function distributeur(p: ProductSpec, T: number): ProductModel {
  const { width: W, height: H, depth: D } = p;
  const panels: Panel[] = [];
  const motions: Motion[] = [];
  const add: Add = (x) => panels.push(x);
  const base = 80;
  add({ id: 'socle', label: 'Socle', size: [W, base, D], at: [0, base / 2, 0], look: 'noir', sheet: { bends: 4, returns: 40 } });
  carcass(add, W, D - T, base, H, T);
  // Plateaux et produits, visibles derrière la vitre.
  const gw = W * 0.68;
  const gx = -W / 2 + gw / 2;
  const n = Math.max(2, Math.round(num(p, 'etages')));
  const sel = Math.max(2, Math.round(num(p, 'selections')));
  const y0 = base + 480;
  const lh = (H - 160 - y0) / n;
  const colors = [0xef4444, 0xf59e0b, 0x22c55e, 0x3b82f6, 0xa855f7, 0xec4899, 0x14b8a6, 0xf97316];
  for (let i = 0; i < n; i++) {
    const y = y0 + i * lh;
    add({ id: `plateau-${i}`, label: `Plateau ${i + 1}`, size: [gw - 40, T, D * 0.7], at: [gx, y, -D * 0.05], look: 'galva', sheet: { bends: 3, returns: 30 },
      holes: Array.from({ length: sel }, (_, k) => [-(gw - 60) / 2 + ((gw - 60) / sel) * (k + 0.5), D * 0.3, 12] as [number, number, number]) });
    // Rail moteurs des spirales, à l'arrière du plateau (un trou d'arbre par sélection).
    add({ id: `rail-moteurs-${i}`, label: `Rail moteurs plateau ${i + 1}`, size: [gw - 40, 70, 3], at: [gx, y + T / 2 + 35, -D * 0.4 - 1.5], look: 'galva', sheet: { bends: 2, returns: 25 },
      holes: Array.from({ length: sel }, (_, k) => [-(gw - 60) / 2 + ((gw - 60) / sel) * (k + 0.5), 0, 14] as [number, number, number]) });
    for (let k = 0; k < sel; k++) {
      const cw = (gw - 60) / sel;
      add({ id: `produit-${i}-${k}`, label: 'Produit', size: [cw * 0.7, lh * 0.55, D * 0.5], at: [gx - (gw - 60) / 2 + cw * (k + 0.5), y + T + lh * 0.28, -D * 0.05], look: 'boite', color: colors[(i * 3 + k) % colors.length] });
    }
  }
  add({ id: 'eclairage', label: 'Éclairage intérieur', size: [gw - 60, 10, D * 0.4], at: [gx, H - T - 5, 0], look: 'led', color: 0xf8fafc, glow: { color: 0xffffff, mode: 'steady' } });
  // Porte : vitrine à gauche, colonne de paiement à droite ; trappe de retrait en bas, portée par la porte.
  const zf = D / 2 - T / 2;
  const dh = H - base;
  motions.push({ id: 'porte', label: 'Porte', type: 'hinge', axis: 'y', pivot: [-W / 2, base + dh / 2, D / 2], angle: -100 });
  glazed(add, 'porte', 'Porte', [gx, base + 300 + (dh - 300) / 2, zf], gw, dh - 300, T, 'porte', 70);
  add({ id: 'porte-bas', label: 'Porte : bas de vitrine', size: [gw, 300, T], at: [gx, base + 150, zf], look: 'tole', sheet: { bends: 4, returns: 20 }, motion: 'porte' });
  const kw = W - gw;
  const kx = W / 2 - kw / 2;
  add({ id: 'porte-colonne', label: 'Porte : colonne de paiement', size: [kw, dh, T], at: [kx, base + dh / 2, zf], look: 'tole', sheet: { bends: 4, returns: 25 }, motion: 'porte' });
  add({ id: 'afficheur', label: 'Afficheur', size: [kw - 80, 110, 6], at: [kx, H - 420, zf + 5], look: 'ecran', glow: { color: 0x86efac, mode: 'steady' }, motion: 'porte' });
  add({ id: 'clavier', label: 'Clavier de sélection', size: [kw - 100, 220, 12], at: [kx, H - 640, zf + 8], look: 'galva', glow: { color: 0x60a5fa, mode: 'pulse' }, motion: 'porte' });
  if (on(p, 'monnayeur')) add({ id: 'monnayeur', label: 'Monnayeur', size: [60, 90, 14], at: [kx - kw * 0.2, H - 860, zf + 8], look: 'noir', glow: { color: 0x22c55e, mode: 'pulse' }, motion: 'porte' });
  add({ id: 'tpe', label: 'Lecteur sans contact', size: [kw * 0.35, 90, 30], at: [kx + kw * 0.15, H - 860, zf + 15], look: 'noir', motion: 'porte' });
  motions.push({ id: 'trappe', label: 'Trappe de retrait', type: 'hinge', axis: 'x', pivot: [gx, base + 250, zf], angle: 60, parent: 'porte' });
  add({ id: 'trappe', label: 'Trappe de retrait', size: [gw * 0.7, 190, 4], at: [gx, base + 155, zf + 4], look: 'noir', motion: 'trappe' });
  if (on(p, 'refrigere')) {
    add({ id: 'groupe', label: 'Groupe froid (composant)', size: [W * 0.6, 220, D * 0.4], at: [0, base + 140, -D * 0.2], look: 'galva' });
    add({ id: 'groupe-chassis', label: 'Châssis du groupe froid', size: [W * 0.66, 4, D * 0.46], at: [0, base + 28, -D * 0.2], look: 'galva', sheet: { bends: 2, returns: 40 },
      holes: [[-W * 0.3, -D * 0.2, 8.5], [W * 0.3, -D * 0.2, 8.5], [-W * 0.3, D * 0.2, 8.5], [W * 0.3, D * 0.2, 8.5]] });
    add({ id: 'groupe-ventilo', label: 'Ventilateur du groupe', size: [200, 30, 6], at: [0, base + 140, -D / 2 + T + 6], look: 'noir', spin: 'z' });
  }
  return {
    panels,
    motions,
    mechanisms: [
      { id: 'porte', label: 'Porte', open: 'Ouvrir la porte', close: 'Fermer la porte', members: ['porte'] },
      { id: 'trappe', label: 'Trappe', open: 'Ouvrir la trappe', close: 'Fermer la trappe', members: ['trappe'] },
    ],
  };
}

function recharge(p: ProductSpec, T: number): ProductModel {
  const { width: W, height: H, depth: D } = p;
  const panels: Panel[] = [];
  const motions: Motion[] = [];
  const add: Add = (x) => panels.push(x);
  const base = 60;
  const cap = 80;
  add({ id: 'socle', label: 'Socle', size: [W + 40, base, D + 40], at: [0, base / 2, 0], look: 'noir', sheet: { bends: 4, returns: 40 } });
  carcass(add, W, D, base, H - cap, T);
  add({ id: 'chapeau', label: 'Chapeau', size: [W + 30, cap, D + 30], at: [0, H - cap / 2, 0], look: 'tole', sheet: { bends: 4, returns: cap } });
  const zf = D / 2 - T / 2;
  const mh = on(p, 'maintenance') ? (H - base - cap) * 0.32 : 0;
  const fh = H - base - cap - mh;
  add({ id: 'facade', label: 'Façade', size: [W - 2 * T, fh, T], at: [0, base + mh + fh / 2, zf], look: 'tole', sheet: { bends: 4, returns: 25 } });
  if (mh) {
    motions.push({ id: 'maintenance', label: 'Porte de maintenance', type: 'hinge', axis: 'y', pivot: [-W / 2 + T, base + mh / 2, D / 2], angle: -100 });
    add({ id: 'maintenance', label: 'Porte de maintenance', size: [W - 2 * T - 4, mh - 4, T], at: [0, base + mh / 2, zf + T], look: 'tole', sheet: { bends: 4, returns: 20 }, motion: 'maintenance' });
    add({ id: 'maintenance-serrure', label: 'Serrure', size: [30, 30, 12], at: [W / 2 - 50, base + mh * 0.7, zf + T + 6], look: 'noir', motion: 'maintenance' });
  }
  add({ id: 'led', label: 'Barre lumineuse d’état', size: [W - 60, 24, 8], at: [0, H - cap - 60, zf + 6], look: 'led', color: 0x22c55e, glow: { color: 0x22c55e, mode: 'pulse' } });
  if (on(p, 'ecran')) add({ id: 'ecran', label: 'Écran', size: [W * 0.6, W * 0.42, 6], at: [0, H * 0.72, zf + 5], look: 'ecran', glow: { color: 0x93c5fd, mode: 'steady' } });
  add({ id: 'rfid', label: 'Lecteur de badge', size: [W * 0.4, 60, 10], at: [0, H * 0.72 - W * 0.21 - 70, zf + 6], look: 'noir', glow: { color: 0x3b82f6, mode: 'pulse' } });
  const n = Math.max(1, Math.min(2, Math.round(num(p, 'prises'))));
  const flaps: string[] = [];
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? 0 : (i ? 1 : -1) * W * 0.22;
    const y = base + mh + fh * 0.32;
    const id = `clapet-${i}`;
    flaps.push(id);
    add({ id: `prise-${i}`, label: `Prise ${i + 1}`, size: [90, 90, 30], at: [x, y, zf + 15], look: 'noir' });
    motions.push({ id, label: `Clapet ${i + 1}`, type: 'hinge', axis: 'x', pivot: [x, y + 60, zf + 32], angle: -100 });
    add({ id, label: `Clapet de prise ${i + 1}`, size: [120, 120, 6], at: [x, y, zf + 35], look: 'tole', sheet: { bends: 2, returns: 10 }, motion: id });
    if (on(p, 'supportCable')) {
      const sx = (n === 1 ? 1 : i ? 1 : -1) * (W / 2 + 35);
      add({ id: `support-${i}`, label: `Support de câble ${i + 1}`, size: [60, 160, 60], at: [sx, H * 0.55, 0], look: 'galva', sheet: { bends: 3, returns: 20 } });
      add({ id: `cable-${i}`, label: `Câble ${i + 1}`, size: [40, H * 0.4, 40], at: [sx, H * 0.55 - H * 0.2, 25], look: 'noir' });
    }
  }
  const mechanisms: Mechanism[] = [{ id: 'clapets', label: 'Prises', open: n > 1 ? 'Ouvrir les clapets' : 'Ouvrir le clapet', close: n > 1 ? 'Fermer les clapets' : 'Fermer le clapet', members: flaps }];
  if (mh) mechanisms.push({ id: 'maintenance', label: 'Maintenance', open: 'Ouvrir la maintenance', close: 'Fermer la maintenance', members: ['maintenance'] });
  return { panels, motions, mechanisms };
}

function boites(p: ProductSpec, T: number): ProductModel {
  const { width: W, height: H, depth: D } = p;
  const panels: Panel[] = [];
  const motions: Motion[] = [];
  const add: Add = (x) => panels.push(x);
  const y0 = on(p, 'pied') ? Math.min(600, H * 0.35) : 0;
  if (y0) for (const sx of [-1, 1]) add({ id: `pied-${sx}`, label: 'Pied', size: [60, y0, 60], at: [sx * (W / 2 - 80), y0 / 2, -D * 0.1], look: 'galva', sheet: { bends: 3, returns: 20 } });
  carcass(add, W, D, y0, H, T);
  add({ id: 'auvent', label: 'Auvent', size: [W + 20, T, D + 40], at: [0, H + T / 2, 20], look: 'tole', sheet: { bends: 3, returns: 25 } });
  const ip = on(p, 'interphone') ? 220 : 0;
  const bw = W - ip;
  const c = Math.max(1, Math.round(num(p, 'colonnes')));
  const r = Math.max(1, Math.round(num(p, 'rangees')));
  const cw = bw / c;
  const rh = (H - y0 - 2 * T) / r;
  const zf = D / 2;
  const doors: string[] = [];
  for (let i = 0; i < c; i++) {
    for (let j = 0; j < r; j++) {
      const x0 = -W / 2 + i * cw;
      const yc = H - T - (j + 0.5) * rh;
      const id = `boite-${i}-${j}`;
      doors.push(id);
      if (j > 0) add({ id: `${id}-sep`, label: 'Séparation', size: [cw - T, T, D - T], at: [x0 + cw / 2, yc + rh / 2, 0], look: 'interieur', sheet: { bends: 2, returns: 15 } });
      motions.push({ id, label: `Boîte ${letter(i)}${j + 1}`, type: 'hinge', axis: 'y', pivot: [x0 + 1.5, yc, zf], angle: -105 });
      add({ id, label: `Porte boîte ${letter(i)}${j + 1}`, size: [cw - 3, rh - 3, T], at: [x0 + cw / 2, yc, zf + T / 2], look: 'tole', sheet: { bends: 4, returns: 12 }, motion: id });
      add({ id: `${id}-fente`, label: 'Fente', size: [cw * 0.6, 12, 4], at: [x0 + cw / 2, yc + rh * 0.3, zf + T + 2], look: 'noir', motion: id });
      add({ id: `${id}-etiquette`, label: 'Porte-étiquette', size: [cw * 0.4, 24, 3], at: [x0 + cw / 2, yc + rh * 0.08, zf + T + 2], look: 'led', color: 0xf8fafc, glow: { color: 0xfffbeb, mode: 'steady' }, motion: id });
      add({ id: `${id}-serrure`, label: 'Serrure', size: [18, 18, 8], at: [x0 + cw - 25, yc - rh * 0.15, zf + T + 4], look: 'galva', motion: id });
    }
    if (i > 0) add({ id: `sep-v-${i}`, label: 'Séparation verticale', size: [T, H - y0 - 2 * T, D - T], at: [-W / 2 + i * cw, y0 + (H - y0) / 2, 0], look: 'interieur', sheet: { bends: 2, returns: 15 } });
  }
  if (ip) {
    const x = W / 2 - ip / 2;
    add({ id: 'platine', label: 'Platine d’interphone', size: [ip - 4, H - y0 - 2 * T, T], at: [x, y0 + (H - y0) / 2, zf + T / 2], look: 'tole', sheet: { bends: 4, returns: 20 } });
    add({ id: 'visio', label: 'Écran visiophone', size: [ip * 0.6, ip * 0.45, 6], at: [x, H - 200, zf + T + 3], look: 'ecran', glow: { color: 0x93c5fd, mode: 'steady' } });
    add({ id: 'camera', label: 'Caméra', size: [40, 40, 20], at: [x, H - 90, zf + T + 10], look: 'noir', glow: { color: 0xef4444, mode: 'blink' } });
    add({ id: 'clavier', label: 'Clavier à code', size: [ip * 0.55, 160, 10], at: [x, H - 400, zf + T + 5], look: 'galva', glow: { color: 0x60a5fa, mode: 'pulse' } });
  }
  return {
    panels,
    motions,
    mechanisms: [
      { id: 'toutes', label: 'Boîtes', open: 'Ouvrir toutes les boîtes', close: 'Fermer les boîtes', members: doors },
      { id: 'une', label: 'Une boîte', open: 'Ouvrir une boîte', close: 'Refermer la boîte', members: doors.slice(0, 1) },
    ],
  };
}

function baie(p: ProductSpec, T: number): ProductModel {
  const { width: W, height: H, depth: D } = p;
  const panels: Panel[] = [];
  const motions: Motion[] = [];
  const add: Add = (x) => panels.push(x);
  const base = 100;
  const h = H - base;
  const yc = base + h / 2;
  add({ id: 'plinthe', label: 'Plinthe', size: [W, base, D], at: [0, base / 2, 0], look: 'noir', sheet: { bends: 4, returns: 40 } });
  add({ id: 'cote-g', label: 'Panneau latéral gauche', size: [T, h - T, D - 40], at: [-W / 2 + T / 2, yc - T / 2, 0], look: 'tole', sheet: { bends: 4, returns: 25 } });
  add({ id: 'cote-d', label: 'Panneau latéral droit', size: [T, h - T, D - 40], at: [W / 2 - T / 2, yc - T / 2, 0], look: 'tole', sheet: { bends: 4, returns: 25 } });
  add({ id: 'toit', label: 'Toit', size: [W, T, D], at: [0, H - T / 2, 0], look: 'tole', sheet: { bends: 4, returns: 25 } });
  // Montants 19" (482,6 mm entre axes de fixation).
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add({ id: `montant-${sx}-${sz}`, label: 'Montant 19"', size: [20, h - T, 40], at: [sx * 251, yc - T / 2, sz * (D / 2 - 90)], look: 'galva', sheet: { bends: 3, returns: 15 } });
  const u = 44.45;
  const nmax = Math.floor((h - 60) / (2 * u));
  const n = Math.min(Math.max(0, Math.round(num(p, 'serveurs'))), nmax);
  for (let i = 0; i < n; i++) {
    const y = base + 30 + u + i * 2 * u;
    add({ id: `serveur-${i}`, label: `Serveur 2U n° ${i + 1}`, size: [482, 2 * u - 3, D - 220], at: [0, y, 0], look: 'noir' });
    add({ id: `serveur-${i}-led`, label: 'Voyant d’activité', size: [10, 10, 4], at: [-200, y, (D - 220) / 2 + 2], look: 'led', color: 0x22c55e, glow: { color: 0x22c55e, mode: i % 2 ? 'blink' : 'pulse' } });
    add({ id: `serveur-${i}-led2`, label: 'Voyant réseau', size: [10, 10, 4], at: [-180, y, (D - 220) / 2 + 2], look: 'led', color: 0x3b82f6, glow: { color: 0x3b82f6, mode: i % 3 ? 'pulse' : 'blink' } });
  }
  motions.push({ id: 'avant', label: 'Porte avant', type: 'hinge', axis: 'y', pivot: [-W / 2, yc, D / 2], angle: -110 });
  if (on(p, 'vitree')) glazed(add, 'avant', 'Porte avant', [0, yc - T / 2, D / 2 - T / 2], W - 4, h - T - 4, T, 'avant', 60);
  else add({ id: 'avant', label: 'Porte avant perforée', size: [W - 4, h - T - 4, T], at: [0, yc - T / 2, D / 2 - T / 2], look: 'tole', sheet: { bends: 4, returns: 22 }, motion: 'avant' });
  add({ id: 'avant-poignee', label: 'Poignée', size: [24, 160, 30], at: [W / 2 - 40, base + h * 0.5, D / 2 + 14], look: 'galva', motion: 'avant' });
  const mechanisms: Mechanism[] = [{ id: 'avant', label: 'Porte avant', open: 'Ouvrir la porte avant', close: 'Fermer la porte avant', members: ['avant'] }];
  if (on(p, 'porteArriere')) {
    motions.push({ id: 'arriere', label: 'Porte arrière', type: 'hinge', axis: 'y', pivot: [-W / 2, yc, -D / 2], angle: 110 });
    add({ id: 'arriere', label: 'Porte arrière perforée', size: [W - 4, h - T - 4, T], at: [0, yc - T / 2, -D / 2 + T / 2], look: 'tole', sheet: { bends: 4, returns: 22 }, motion: 'arriere' });
    mechanisms.push({ id: 'arriere', label: 'Porte arrière', open: 'Ouvrir la porte arrière', close: 'Fermer la porte arrière', members: ['arriere'] });
  } else add({ id: 'fond', label: 'Panneau arrière', size: [W - 2 * T, h - T, T], at: [0, yc - T / 2, -D / 2 + T / 2], look: 'tole', sheet: { bends: 4, returns: 20 } });
  if (on(p, 'ventilation')) for (const sz of [-1, 1]) {
    add({ id: `ventilo-${sz}`, label: 'Ventilateur de toit', size: [150, 20, 150], at: [0, H + 10, sz * D * 0.22], look: 'noir' });
    add({ id: `helice-${sz}`, label: 'Hélice', size: [130, 6, 22], at: [0, H + 23, sz * D * 0.22], look: 'galva', spin: 'y' });
  }
  return { panels, motions, mechanisms };
}

function horodateur(p: ProductSpec, T: number): ProductModel {
  const { width: W, height: H, depth: D } = p;
  const panels: Panel[] = [];
  const motions: Motion[] = [];
  const add: Add = (x) => panels.push(x);
  add({ id: 'platine', label: 'Platine de scellement', size: [W + 100, 15, D + 100], at: [0, 7.5, 0], look: 'galva', sheet: { bends: 0, returns: 0 } });
  const fh = H * 0.42;
  add({ id: 'fut', label: 'Fût', size: [W * 0.55, fh, D * 0.65], at: [0, 15 + fh / 2, 0], look: 'tole', sheet: { bends: 4, returns: 20 } });
  // Tête : caisse, façade équipée, porte de maintenance arrière.
  const y0 = 15 + fh;
  const top = on(p, 'solaire') ? H - 120 : H;
  carcass(add, W, D, y0, top, T, false);
  const hh = top - y0;
  const zf = D / 2 - T / 2;
  add({ id: 'facade', label: 'Façade', size: [W - 2 * T, hh - T, T], at: [0, y0 + (hh - T) / 2, zf], look: 'tole', sheet: { bends: 4, returns: 25 } });
  motions.push({ id: 'maintenance', label: 'Porte de maintenance', type: 'hinge', axis: 'y', pivot: [-W / 2, y0 + hh / 2, -D / 2], angle: 105 });
  add({ id: 'maintenance', label: 'Porte de maintenance', size: [W - 2 * T, hh - T, T], at: [0, y0 + (hh - T) / 2, -D / 2 + T / 2], look: 'tole', sheet: { bends: 4, returns: 22 }, motion: 'maintenance' });
  add({ id: 'maintenance-serrure', label: 'Serrure', size: [36, 36, 14], at: [W / 2 - 50, y0 + hh * 0.5, -D / 2 - 7], look: 'noir', motion: 'maintenance' });
  add({ id: 'visiere', label: 'Visière', size: [W + 30, T, 90], at: [0, top - 40, D / 2 + 45], look: 'tole', sheet: { bends: 2, returns: 20 } });
  if (on(p, 'ecran')) add({ id: 'ecran', label: 'Écran', size: [W * 0.62, W * 0.42, 6], at: [0, top - 90 - W * 0.21, zf + 5], look: 'ecran', glow: { color: 0x86efac, mode: 'steady' } });
  if (on(p, 'clavier')) add({ id: 'clavier', label: 'Clavier', size: [W * 0.5, 130, 14], at: [0, y0 + hh * 0.42, zf + 8], look: 'galva', glow: { color: 0x60a5fa, mode: 'pulse' } });
  if (on(p, 'monnayeur')) add({ id: 'monnayeur', label: 'Monnayeur', size: [40, 70, 12], at: [W * 0.3, y0 + hh * 0.42, zf + 7], look: 'noir', glow: { color: 0x22c55e, mode: 'pulse' } });
  add({ id: 'tpe', label: 'Lecteur sans contact', size: [W * 0.4, 70, 20], at: [0, y0 + hh * 0.26, zf + 10], look: 'noir', glow: { color: 0x3b82f6, mode: 'pulse' } });
  if (on(p, 'imprimante')) {
    add({ id: 'sortie', label: 'Sortie tickets', size: [W * 0.4, 20, 25], at: [0, y0 + hh * 0.12, zf + 12], look: 'noir' });
    add({ id: 'imprimante-support', label: 'Support d’imprimante', size: [W - 2 * T, 3, D * 0.6], at: [0, y0 + hh * 0.12 - 40, 0], look: 'galva', sheet: { bends: 2, returns: 30 }, holes: [[-W * 0.22, -D * 0.2, 5], [W * 0.22, -D * 0.2, 5], [-W * 0.22, D * 0.2, 5], [W * 0.22, D * 0.2, 5]] });
    motions.push({ id: 'ticket', label: 'Impression', type: 'slide', move: [0, -110, 0], auto: true, hold: true });
    add({ id: 'ticket', label: 'Ticket', size: [60, 110, 2], at: [0, y0 + hh * 0.12 + 10, zf + 20], look: 'blanc', motion: 'ticket' });
  }
  if (on(p, 'solaire')) {
    add({ id: 'support-solaire', label: 'Support du panneau', size: [W * 0.3, 120, D * 0.3], at: [0, H - 60, 0], look: 'tole', sheet: { bends: 4, returns: 20 } });
    add({ id: 'solaire', label: 'Panneau solaire', size: [W + 60, 12, D + 120], at: [0, H - 6, 0], look: 'solaire', rot: [22, 0, 0] });
  }
  return { panels, motions, mechanisms: [{ id: 'maintenance', label: 'Maintenance', open: 'Ouvrir la maintenance', close: 'Fermer la maintenance', members: ['maintenance'] }] };
}

function carter(p: ProductSpec, T: number): ProductModel {
  const { width: W, height: H, depth: D } = p;
  const panels: Panel[] = [];
  const motions: Motion[] = [];
  const add: Add = (x) => panels.push(x);
  const base = 100;
  const h = H - base;
  const yc = base + h / 2;
  add({ id: 'socle', label: 'Socle', size: [W, base, D], at: [0, base / 2, 0], look: 'noir', sheet: { bends: 4, returns: 40 } });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add({ id: `poteau-${sx}-${sz}`, label: 'Poteau d’ossature', size: [50, h, 50], at: [sx * (W / 2 - 25), yc, sz * (D / 2 - 25)], look: 'galva', sheet: { bends: 3, returns: 25 } });
  add({ id: 'toit', label: 'Toit', size: [W, T, D], at: [0, H - T / 2, 0], look: 'tole', sheet: { bends: 4, returns: 30 } });
  // Côtés et fond : panneaux pleins, ou vitrés pour la visite.
  const sideD = D - 100;
  for (const [side, x] of [['gauche', -W / 2 + T / 2], ['droit', W / 2 - T / 2]] as const) {
    // Côté vitré : dessiné à plat (largeur = profondeur du carter), puis tourné d'un quart de tour sur le côté.
    if (on(p, 'hublots')) glazed((q) => add({ ...q, size: [q.size[2], q.size[1], q.size[0]], at: [x, q.at[1], q.at[0]] }), `cote-${side}`, `Côté ${side}`, [0, yc, 0], sideD, h - 20, T);
    else add({ id: `cote-${side}`, label: `Côté ${side}`, size: [T, h - 20, sideD], at: [x, yc, 0], look: 'tole', sheet: { bends: 4, returns: 25 } });
  }
  add({ id: 'fond', label: 'Panneau arrière', size: [W - 100, h - 20, T], at: [0, yc, -D / 2 + T / 2], look: 'tole', sheet: { bends: 4, returns: 25 } });
  // Façade : portes d'accès (par paires : charnière à gauche puis à droite).
  const n = Math.max(0, Math.min(4, Math.round(num(p, 'portes'))));
  const fw = W - 100;
  const zf = D / 2 - T / 2;
  const doors: string[] = [];
  if (!n) {
    if (on(p, 'hublots')) glazed(add, 'facade', 'Façade', [0, yc, zf], fw, h - 20, T);
    else add({ id: 'facade', label: 'Façade', size: [fw, h - 20, T], at: [0, yc, zf], look: 'tole', sheet: { bends: 4, returns: 25 } });
  }
  for (let i = 0; i < n; i++) {
    const dw = fw / n;
    const cx = -fw / 2 + dw * (i + 0.5);
    const left = i % 2 === 0;
    const id = `porte-${i}`;
    doors.push(id);
    motions.push({ id, label: `Porte ${i + 1}`, type: 'hinge', axis: 'y', pivot: [left ? cx - dw / 2 : cx + dw / 2, yc, D / 2], angle: left ? -105 : 105 });
    if (on(p, 'hublots')) glazed(add, id, `Porte ${i + 1}`, [cx, yc, zf], dw - 4, h - 24, T, id, 80);
    else add({ id, label: `Porte ${i + 1}`, size: [dw - 4, h - 24, T], at: [cx, yc, zf], look: 'tole', sheet: { bends: 4, returns: 22 }, motion: id });
    add({ id: `${id}-poignee`, label: 'Poignée', size: [24, 160, 30], at: [left ? cx + dw / 2 - 50 : cx - dw / 2 + 50, base + h * 0.5, zf + 16], look: 'noir', motion: id });
  }
  // La machine à l'intérieur (pour situer le carter) : bâti, broche qui tourne en marche, éclairage.
  add({ id: 'machine', label: 'Machine (bâti)', size: [W * 0.55, h * 0.4, D * 0.5], at: [0, base + h * 0.2, -D * 0.05], look: 'noir' });
  add({ id: 'broche', label: 'Broche', size: [90, h * 0.25, 90], at: [0, base + h * 0.55, -D * 0.05], look: 'galva', spin: 'y' });
  motorMount(add, 'moteur-broche', 'Support moteur de broche', [0, base + h * 0.68, -D * 0.05], 200, 160, 90, undefined, 60);
  add({ id: 'chassis-machine', label: 'Châssis mécano-soudé', size: [W * 0.62, 6, D * 0.56], at: [0, base + 3, -D * 0.05], look: 'galva', sheet: { bends: 4, returns: 60 },
    holes: [[-W * 0.28, -D * 0.25, 14], [W * 0.28, -D * 0.25, 14], [-W * 0.28, D * 0.25, 14], [W * 0.28, D * 0.25, 14]] });
  add({ id: 'outil', label: 'Outil', size: [260, 20, 30], at: [0, base + h * 0.42, -D * 0.05], look: 'galva', spin: 'y' });
  add({ id: 'eclairage', label: 'Éclairage intérieur', size: [W * 0.5, 10, D * 0.3], at: [0, H - T - 8, 0], look: 'led', color: 0xf8fafc, glow: { color: 0xffffff, mode: 'steady' } });
  if (on(p, 'pupitre')) {
    add({ id: 'pupitre-bras', label: 'Bras de pupitre', size: [380, 40, 40], at: [W / 2 + 190, base + h * 0.7, D * 0.3], look: 'galva', sheet: { bends: 3, returns: 20 } });
    add({ id: 'pupitre', label: 'Pupitre de commande', size: [420, 320, 140], at: [W / 2 + 380, base + h * 0.7, D * 0.3], look: 'tole', sheet: { bends: 4, returns: 30 } });
    add({ id: 'pupitre-ecran', label: 'Écran de commande', size: [300, 200, 6], at: [W / 2 + 380, base + h * 0.7 + 30, D * 0.3 + 72], look: 'ecran', glow: { color: 0x93c5fd, mode: 'steady' } });
    add({ id: 'arret-urgence', label: 'Arrêt d’urgence', size: [50, 50, 30], at: [W / 2 + 500, base + h * 0.7 - 110, D * 0.3 + 80], look: 'led', color: 0xdc2626 });
  }
  if (on(p, 'gyrophare')) {
    ([[0x22c55e, 'steady'], [0xf59e0b, 'blink'], [0xef4444, 'pulse']] as const).forEach(([color, mode], i) => {
      add({ id: `colonne-${i}`, label: 'Colonne lumineuse', size: [70, 60, 70], at: [W / 2 - 80, H + 40 + i * 62, -D / 2 + 80], look: 'led', color, glow: { color, mode } });
    });
  }
  if (on(p, 'ventilation')) {
    add({ id: 'extraction', label: 'Caisson d’extraction', size: [300, 160, 300], at: [-W * 0.25, H + 80, 0], look: 'tole', sheet: { bends: 4, returns: 25 } });
    add({ id: 'extraction-helice', label: 'Hélice', size: [240, 6, 30], at: [-W * 0.25, H + 164, 0], look: 'galva', spin: 'y' });
  }
  return { panels, motions, mechanisms: n ? [{ id: 'portes', label: 'Portes', open: n > 1 ? 'Ouvrir les portes' : 'Ouvrir la porte', close: n > 1 ? 'Fermer les portes' : 'Fermer la porte', members: doors }] : [] };
}

// --- Usinage : trous, ouvertures, supports moteur, tiroirs ---------------------------------------

/**
 * Repère des trous d'un panneau (u, v depuis son centre, mm) : panneau de face (z mince) u = x, v = y ;
 * dessus / dessous (y mince) u = x, v = vers l'arrière ; côté (x mince) u = vers l'avant (z), v = y.
 */
export function panelAxes(size: V3): { thin: 0 | 1 | 2; u: number; v: number } {
  const thin = size.indexOf(Math.min(...size)) as 0 | 1 | 2;
  return thin === 0 ? { thin, u: size[2], v: size[1] } : thin === 1 ? { thin, u: size[0], v: size[2] } : { thin, u: size[0], v: size[1] };
}

/** Grille de perforations (u, v, Ø) remplissant le panneau avec une marge ; plafonnée pour rester affichable. */
function perforations(w: number, h: number, d: number, pitch: number, margin = 30, max = 900): [number, number, number][] {
  let p = Math.max(pitch, d + 2);
  while (Math.floor((w - 2 * margin) / p) * Math.floor((h - 2 * margin) / p) > max) p *= 1.15;
  const nx = Math.max(1, Math.floor((w - 2 * margin) / p));
  const ny = Math.max(1, Math.floor((h - 2 * margin) / p));
  const out: [number, number, number][] = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) out.push([(i - (nx - 1) / 2) * p, (j - (ny - 1) / 2) * p, d]);
  return out;
}

/** Découpe dans `host` l'empreinte de `target` (écran, trappe, tiroir…) moins un recouvrement : la tôle est vraiment ouverte. */
function openingFor(host: Panel | undefined, target: Panel | undefined, overlap = 10) {
  if (!host || !target) return;
  const { thin } = panelAxes(host.size);
  const d = [0, 1, 2].map((i) => target.at[i] - host.at[i]);
  const s = target.size;
  const [u, v, w, h] = thin === 2 ? [d[0], d[1], s[0], s[1]] : thin === 1 ? [d[0], -d[2], s[0], s[2]] : [d[2], d[1], s[2], s[1]];
  (host.cutouts ??= []).push([u, v, Math.max(8, w - 2 * overlap), Math.max(8, h - 2 * overlap)]);
}

/** Passages de câbles (le câblage n'est pas dessiné) : trous Ø ou lumières rectangulaires sur un panneau. */
function cablePass(host: Panel | undefined, holes: [number, number, number][] = [], slots: [number, number, number, number][] = []) {
  if (!host) return;
  (host.holes ??= []).push(...holes);
  (host.cutouts ??= []).push(...slots);
}

/**
 * Support moteur en tôle pliée (équerre en U) : semelle percée de 4 trous de fixation Ø6,5 et d'un passage d'arbre,
 * deux joues percées pour la reprise ; le moteur lui-même est un composant acheté.
 */
function motorMount(add: Add, id: string, label: string, [x, y, z]: V3, w = 140, d = 110, h = 70, motion?: string, shaft = 24, motor = true) {
  const T = 3;
  add({ id: `${id}-semelle`, label: `${label} : semelle`, size: [w, T, d], at: [x, y, z], look: 'galva', sheet: { bends: 2, returns: h }, motion,
    holes: [[-w / 2 + 14, -d / 2 + 14, 6.5], [w / 2 - 14, -d / 2 + 14, 6.5], [-w / 2 + 14, d / 2 - 14, 6.5], [w / 2 - 14, d / 2 - 14, 6.5], [0, 0, shaft]] });
  for (const s of [-1, 1]) add({ id: `${id}-joue${s}`, label: `${label} : joue`, size: [T, h, d], at: [x + s * (w / 2 - T / 2), y + h / 2, z], look: 'galva', motion, holes: [[-d / 4, 0, 9], [d / 4, 0, 9]] });
  if (motor) add({ id: `${id}-moteur`, label: 'Moteur (composant)', size: [w * 0.55, h * 0.8, d * 0.6], at: [x, y + T + h * 0.4, z], look: 'noir', motion });
}

/** Tiroir creux : façade, fond percé (fixation des séparateurs), côtés et dos, tous entraînés par `motion`. */
function drawer(add: Add, id: string, label: string, motion: string, [x, y, z]: V3, w: number, h: number, depth: number, T: number, handle = true) {
  const bh = h * 0.8;
  add({ id, label: `${label} : façade`, size: [w, h, T + 2], at: [x, y, z], look: 'tole', sheet: { bends: 4, returns: 15 }, motion });
  const zb = z - T - depth / 2;
  add({ id: `${id}-fond`, label: `${label} : fond`, size: [w - 20, T, depth], at: [x, y - h / 2 + 10 + T / 2, zb], look: 'interieur', sheet: { bends: 4, returns: bh }, motion,
    holes: perforations(w - 20, depth, 6, 60, 40, 60) });
  for (const s of [-1, 1]) add({ id: `${id}-cote${s}`, label: `${label} : côté`, size: [T, bh, depth], at: [x + s * (w / 2 - 10 - T / 2), y - h / 2 + 10 + bh / 2, zb], look: 'interieur', motion, holes: [[-depth / 2 + 30, 0, 5], [depth / 2 - 30, 0, 5]] });
  add({ id: `${id}-dos`, label: `${label} : dos`, size: [w - 20, bh, T], at: [x, y - h / 2 + 10 + bh / 2, zb - depth / 2], look: 'interieur', motion });
  if (handle) add({ id: `${id}-poignee`, label: 'Poignée', size: [Math.min(160, w * 0.5), 18, 26], at: [x, y + h * 0.25, z + T + 12], look: 'galva', motion });
}

/** Tiroirs empilés dans une façade (ouverture découpée pour chacun) : renvoie les mouvements créés. */
function drawerStack(add: Add, motions: Motion[], host: () => Panel | undefined, prefix: string, label: string, [x, y0, z]: V3, w: number, h: number, n: number, depth: number, T: number, travel: number) {
  const ids: string[] = [];
  const dh = (h - (n - 1) * 6) / n;
  for (let i = 0; i < n; i++) {
    const id = `${prefix}-${i}`;
    const y = y0 + h - dh / 2 - i * (dh + 6);
    motions.push({ id, label: `${label} ${i + 1}`, type: 'slide', move: [0, 0, travel] });
    drawer(add, id, `${label} ${i + 1}`, id, [x, y, z], w, dh, depth, T);
    ids.push(id);
    openingFor(host(), { id, label, size: [w, dh, T], at: [x, y, z], look: 'tole' }, 6);
  }
  return ids;
}

/** Plateau bois ou tôle. */
const top = (bois: boolean): Look => (bois ? 'bois' : 'tole');

function comptoir(p: ProductSpec, T: number, bar: boolean): ProductModel {
  const { width: W, height: H, depth: D } = p;
  const panels: Panel[] = [];
  const motions: Motion[] = [];
  const add: Add = (x) => panels.push(x);
  const find = (id: string) => panels.find((x) => x.id === id);
  const desk = bar ? H - 40 : 740;
  const pmr = !bar && on(p, 'pmr') ? Math.min(1000, W * 0.35) : 0;
  const zf = D / 2 - T / 2;
  const fw = W - pmr;
  const fx = -W / 2 + fw / 2;
  add({ id: 'facade', label: 'Façade', size: [fw, H, T], at: [fx, H / 2, zf], look: 'tole', sheet: { bends: 4, returns: 40 },
    holes: on(p, 'perfore') ? perforations(fw, H, 12, 30, 80) : undefined });
  if (pmr) add({ id: 'facade-pmr', label: 'Façade partie PMR', size: [pmr, 760, T], at: [W / 2 - pmr / 2, 380, zf], look: 'tole', sheet: { bends: 4, returns: 40 } });
  for (const s of [-1, 1]) add({ id: `joue${s}`, label: s < 0 ? 'Joue gauche' : 'Joue droite', size: [T, s > 0 && pmr ? 760 : H, D], at: [s * (W / 2 - T / 2), (s > 0 && pmr ? 760 : H) / 2, 0], look: 'tole', sheet: { bends: 3, returns: 40 } });
  add({ id: 'voile', label: 'Voile de fond (pieds)', size: [W - 2 * T, 400, T], at: [0, 200, D / 2 - 120], look: 'tole', sheet: { bends: 2, returns: 20 } });
  add({ id: 'plan', label: 'Plan de travail', size: [W - 2 * T, 25, D - 60], at: [0, desk, -30], look: top(on(p, 'bois')),
    holes: on(p, 'passeCables') ? [[-W / 4, -(D - 60) / 2 + 80, 80], [W / 4, -(D - 60) / 2 + 80, 80]] : undefined });
  if (!bar && on(p, 'rehausse')) {
    add({ id: 'rehausse', label: 'Tablette haute', size: [fw + 20, 25, 320], at: [fx, H + 12, zf - 140], look: top(on(p, 'bois')) });
    if (on(p, 'led')) add({ id: 'led', label: 'Bandeau LED', size: [fw - 40, 10, 14], at: [fx, H - 6, zf - 20], look: 'led', color: 0xfef9c3, glow: { color: 0xfff1b8, mode: 'steady' } });
  }
  if (bar) {
    add({ id: 'comptoir', label: 'Dessus de comptoir', size: [W + 40, 40, 420], at: [0, H + 20, zf - 160], look: top(on(p, 'bois')) });
    if (on(p, 'led')) add({ id: 'led', label: 'Bandeau LED', size: [W - 60, 10, 14], at: [0, H - 6, zf + 12], look: 'led', color: 0xfef9c3, glow: { color: 0xfff1b8, mode: 'steady' } });
    if (on(p, 'reposePieds')) {
      add({ id: 'repose', label: 'Repose-pieds', size: [W - 100, 40, 40], at: [0, 220, zf + 120], look: 'galva', sheet: { bends: 3, returns: 20 } });
      for (const s of [-1, 1]) add({ id: `repose-patte${s}`, label: 'Patte de repose-pieds', size: [30, 30, 100], at: [s * (W / 2 - 200), 220, zf + 50], look: 'galva', sheet: { bends: 2, returns: 15 } });
    }
    if (on(p, 'etagereArriere')) for (let i = 0; i < 2; i++) add({ id: `etagere-ar-${i}`, label: `Étagère arrière ${i + 1}`, size: [W - 2 * T, 20, 250], at: [0, 350 + i * 300, -D / 2 + 140], look: 'tole', sheet: { bends: 3, returns: 20 } });
  }
  cablePass(find('voile'), [], [[-W / 4, -120, 160, 60], [W / 4, -120, 160, 60]]);
  // Caissons à tiroirs sous le plan, côté opérateur (tiroirs vers l'arrière).
  const n = Math.max(0, Math.round(num(p, 'caissons')));
  const ids: string[] = [];
  for (let c = 0; c < n; c++) {
    const cx = -W / 2 + 300 + c * Math.max(500, (W - 600) / Math.max(1, n));
    const cz = -D / 2 + 300;
    const hh = desk - 60;
    add({ id: `caisson-${c}`, label: `Caisson ${c + 1}`, size: [420, hh, 500], at: [cx, 30 + hh / 2, cz], look: 'tole', sheet: { bends: 4, returns: 25 } });
    const host = `caisson-${c}-face`;
    add({ id: host, label: `Caisson ${c + 1} : façade`, size: [420, hh, T], at: [cx, 30 + hh / 2, -D / 2 + 50], look: 'tole' });
    // Tiroirs ouvrant vers l'arrière (côté hôtesse) : rotation des repères évitée en les traitant comme glissant vers z−.
    for (let i = 0; i < 3; i++) {
      const id = `tiroir-${c}-${i}`;
      const dh = (hh - 12) / 3;
      const y = 30 + hh - dh / 2 - i * (dh + 6);
      motions.push({ id, label: `Tiroir ${c + 1}.${i + 1}`, type: 'slide', move: [0, 0, -360] });
      add({ id, label: `Tiroir ${c + 1}.${i + 1} : façade`, size: [400, dh, T + 2], at: [cx, y, -D / 2 + 48], look: 'tole', sheet: { bends: 4, returns: 15 }, motion: id });
      add({ id: `${id}-fond`, label: `Tiroir ${c + 1}.${i + 1} : caisson`, size: [380, T, 420], at: [cx, y - dh / 2 + 10, -D / 2 + 260], look: 'interieur', motion: id, holes: perforations(380, 420, 6, 60, 40, 30) });
      for (const s of [-1, 1]) add({ id: `${id}-cote${s}`, label: 'Côté de tiroir', size: [T, dh * 0.8, 420], at: [cx + s * 185, y - dh / 2 + 10 + dh * 0.4, -D / 2 + 260], look: 'interieur', motion: id });
      openingFor(find(host), { id, label: '', size: [400, dh, T], at: [cx, y, -D / 2 + 50], look: 'tole' }, 6);
      ids.push(id);
    }
  }
  if (on(p, 'angle') && !bar) {
    const R = num(p, 'retour');
    add({ id: 'retour-facade', label: 'Façade du retour', size: [T, H, R], at: [-W / 2 + T / 2, H / 2, -D / 2 - R / 2], look: 'tole', sheet: { bends: 4, returns: 40 } });
    add({ id: 'retour-joue', label: 'Joue du retour', size: [D, H, T], at: [-W / 2 + D / 2, H / 2, -D / 2 - R + T / 2], look: 'tole', sheet: { bends: 3, returns: 40 } });
    add({ id: 'retour-plan', label: 'Plan du retour', size: [D - 60, 25, R], at: [-W / 2 + D / 2 + 30, desk, -D / 2 - R / 2], look: top(on(p, 'bois')), holes: on(p, 'passeCables') ? [[0, 0, 80]] : undefined });
    if (on(p, 'rehausse')) add({ id: 'retour-rehausse', label: 'Tablette haute du retour', size: [320, 25, R], at: [-W / 2 + 140, H + 12, -D / 2 - R / 2], look: top(on(p, 'bois')) });
  }
  return { panels, motions, mechanisms: ids.length ? [{ id: 'tiroirs', label: 'Tiroirs', open: 'Ouvrir les tiroirs', close: 'Fermer les tiroirs', members: ids }] : [] };
}

function etagere(p: ProductSpec, T: number): ProductModel {
  const { width: W, height: H, depth: D } = p;
  const panels: Panel[] = [];
  const add: Add = (x) => panels.push(x);
  const n = Math.max(1, Math.round(num(p, 'travees')));
  const lv = Math.max(2, Math.round(num(p, 'niveaux')));
  const tw = W / n;
  for (let i = 0; i <= n; i++) for (const s of [-1, 1]) add({ id: `montant-${i}-${s}`, label: 'Montant', size: [40, H, 40], at: [-W / 2 + i * tw + (i === 0 ? 20 : i === n ? -20 : 0), H / 2, s * (D / 2 - 20)], look: 'tole', sheet: { bends: 3, returns: 20 },
    holes: undefined });
  for (let i = 0; i < n; i++) {
    // Tablette entre les faces des montants (posée sur taquets), sans les traverser.
    const left = i === 0 ? -W / 2 + 40 : -W / 2 + i * tw + 20;
    const right = i === n - 1 ? W / 2 - 40 : -W / 2 + (i + 1) * tw - 20;
    const cx = (left + right) / 2;
    const sw = right - left;
    for (let j = 0; j < lv; j++) {
      const y = 60 + ((H - 120) * j) / (lv - 1);
      add({ id: `tablette-${i}-${j}`, label: 'Tablette', size: [sw, on(p, 'bois') ? 25 : T, D - 20], at: [cx, y, 0], look: top(on(p, 'bois')), sheet: on(p, 'bois') ? undefined : { bends: 4, returns: 25 } });
    }
    if (on(p, 'fond')) add({ id: `fond-${i}`, label: 'Fond perforé', size: [sw, H - 100, T], at: [cx, H / 2, -D / 2 + 25], look: 'tole', sheet: { bends: 2, returns: 15 }, holes: perforations(tw - 44, H - 100, 10, 40, 40) });
  }
  return { panels, motions: [], mechanisms: [] };
}

function meubleTiroirs(p: ProductSpec, T: number): ProductModel {
  const { width: W, height: H, depth: D } = p;
  const panels: Panel[] = [];
  const motions: Motion[] = [];
  const add: Add = (x) => panels.push(x);
  const find = (id: string) => panels.find((x) => x.id === id);
  const y0 = on(p, 'roulettes') ? 110 : 60;
  if (on(p, 'roulettes')) for (const sx of [-1, 1]) for (const sz of [-1, 1]) add({ id: `roulette-${sx}-${sz}`, label: 'Roulette', size: [60, y0, 60], at: [sx * (W / 2 - 50), y0 / 2, sz * (D / 2 - 50)], look: 'noir' });
  else add({ id: 'socle', label: 'Socle', size: [W - 40, y0, D - 60], at: [0, y0 / 2, -10], look: 'noir', sheet: { bends: 4, returns: 30 } });
  carcass(add, W, D, y0, H, T);
  if (on(p, 'bois')) add({ id: 'plateau', label: 'Plateau bois', size: [W + 20, 25, D + 20], at: [0, H + 12, 0], look: 'bois' });
  add({ id: 'facade', label: 'Cadre de façade', size: [W - 2 * T, H - y0 - T, T], at: [0, y0 + (H - y0 - T) / 2, D / 2 - T / 2], look: 'tole', sheet: { bends: 4, returns: 20 } });
  cablePass(find('fond'), [[0, -(H - y0) / 2 + 60, 30]]);
  const c = Math.max(1, Math.round(num(p, 'colonnes')));
  const n = Math.max(1, Math.round(num(p, 'tiroirs')));
  const cw = (W - 2 * T) / c;
  const all: string[] = [];
  for (let i = 0; i < c; i++) {
    if (i > 0) add({ id: `sep-${i}`, label: 'Séparation', size: [T, H - y0 - 2 * T, D - 2 * T], at: [-W / 2 + T + i * cw, y0 + (H - y0) / 2, 0], look: 'interieur', sheet: { bends: 2, returns: 15 } });
    all.push(...drawerStack(add, motions, () => find('facade'), `tiroir-${i}`, `Tiroir ${letter(i)}`, [-W / 2 + T + cw * (i + 0.5), y0 + T + 10, D / 2 + T], cw - 12, H - y0 - 2 * T - 20, n, D - 80, T, D * 0.6));
  }
  if (on(p, 'serrure')) add({ id: 'serrure', label: 'Serrure centralisée', size: [24, 24, 14], at: [W / 2 - 40, H - 60, D / 2 + 8], look: 'galva' });
  return { panels, motions, mechanisms: [
    { id: 'tiroirs', label: 'Tiroirs', open: 'Ouvrir tous les tiroirs', close: 'Fermer les tiroirs', members: all },
    { id: 'un', label: 'Un tiroir', open: 'Ouvrir un tiroir', close: 'Refermer le tiroir', members: all.slice(0, 1) },
  ] };
}

function vitrine(p: ProductSpec, T: number): ProductModel {
  const { width: W, height: H, depth: D } = p;
  const panels: Panel[] = [];
  const motions: Motion[] = [];
  const add: Add = (x) => panels.push(x);
  const s = Math.min(num(p, 'socle'), H * 0.6);
  carcass(add, W, D, 0, s, T);
  add({ id: 'socle-face', label: 'Façade du socle', size: [W - 2 * T, s - T, T], at: [0, (s - T) / 2, D / 2 - T / 2], look: 'tole', sheet: { bends: 4, returns: 20 } });
  cablePass(panels.find((x) => x.id === 'dessus'), [[W / 2 - 60, D / 2 - 60, 25]]);
  const gh = H - s - 40;
  const yc = s + gh / 2;
  for (const sx of [-1, 1]) add({ id: `verre-cote${sx}`, label: 'Verre latéral', size: [8, gh, D - 40], at: [sx * (W / 2 - 4), yc, 0], look: 'verre' });
  add({ id: 'verre-fond', label: 'Verre du fond', size: [W - 20, gh, 8], at: [0, yc, -D / 2 + 4], look: 'verre' });
  add({ id: 'chapeau', label: 'Chapeau', size: [W, 40, D], at: [0, H - 20, 0], look: 'tole', sheet: { bends: 4, returns: 40 }, holes: [[W / 2 - 60, 0, 12]] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add({ id: `angle-${sx}-${sz}`, label: 'Montant d’angle', size: [20, gh, 20], at: [sx * (W / 2 - 10), yc, sz * (D / 2 - 10)], look: 'tole', sheet: { bends: 1, returns: 20 } });
  const n = Math.round(num(p, 'etageres'));
  for (let i = 0; i < n; i++) add({ id: `etagere-${i}`, label: `Étagère verre ${i + 1}`, size: [W - 17, 8, D - 60], at: [0, s + (gh * (i + 1)) / (n + 1), 0], look: 'verre' });
  if (on(p, 'porte')) {
    motions.push({ id: 'porte', label: 'Porte vitrée', type: 'hinge', axis: 'y', pivot: [-W / 2 + 10, yc, D / 2], angle: -95 });
    add({ id: 'porte', label: 'Porte vitrée', size: [W - 24, gh - 4, 8], at: [0, yc, D / 2 - 4], look: 'verre', motion: 'porte' });
    if (on(p, 'serrure')) add({ id: 'serrure', label: 'Serrure', size: [30, 50, 14], at: [W / 2 - 40, s + 60, D / 2 + 6], look: 'galva', motion: 'porte' });
  } else add({ id: 'verre-face', label: 'Verre de face', size: [W - 20, gh, 8], at: [0, yc, D / 2 - 4], look: 'verre' });
  if (on(p, 'eclairage')) add({ id: 'led', label: 'Éclairage LED', size: [W - 60, 8, 20], at: [0, H - 46, 0], look: 'led', color: 0xf8fafc, glow: { color: 0xffffff, mode: 'steady' } });
  return { panels, motions, mechanisms: on(p, 'porte') ? [{ id: 'porte', label: 'Porte', open: 'Ouvrir la vitrine', close: 'Fermer la vitrine', members: ['porte'] }] : [] };
}

function table(p: ProductSpec, T: number): ProductModel {
  const { width: W, height: H, depth: D } = p;
  const panels: Panel[] = [];
  const add: Add = (x) => panels.push(x);
  const th = 30;
  // Plateau tôle : caisson plié de 30 mm (bords tombés + contre-plis), comme le plateau bois.
  add({ id: 'plateau', label: 'Plateau', size: [W, th, D], at: [0, H - th / 2, 0], look: top(on(p, 'bois')), sheet: on(p, 'bois') ? undefined : { bends: 4, returns: th, hems: 4 } });
  const lh = H - th;
  if (on(p, 'origami')) {
    // Pieds en tôle pliée en V (deux facettes par extrémité, jointives au pli central).
    // Les deux facettes d'un pied partent du même pli (arête verticale) et s'ouvrent en V vers l'intérieur.
    const wz = D * 0.42;
    const t25 = (25 * Math.PI) / 180;
    for (const sx of [-1, 1]) for (const k of [-1, 1]) add({ id: `pied-${sx}-${k}`, label: 'Pied origami (facette)', size: [T * 2, lh, wz], at: [sx * (W / 2 - 80) - sx * Math.sin(t25) * (wz / 2), lh / 2, k * Math.cos(t25) * (wz / 2)], look: 'tole', sheet: { bends: 1, returns: 0 }, rot: [0, -k * sx * 25, 0] });
  } else for (const sx of [-1, 1]) for (const sz of [-1, 1]) add({ id: `pied-${sx}-${sz}`, label: 'Pied', size: [40, lh, 40], at: [sx * (W / 2 - 40), lh / 2, sz * (D / 2 - 40)], look: 'tole', sheet: { bends: 3, returns: 20 } });
  if (on(p, 'etagere')) add({ id: 'tablette', label: 'Tablette basse', size: [W - 200, T, D - 120], at: [0, H * 0.25, 0], look: 'tole', sheet: { bends: 4, returns: 20 } });
  return { panels, motions: [], mechanisms: [] };
}

function salleAttente(p: ProductSpec, T: number): ProductModel {
  const { width: W, height: H, depth: D } = p;
  const panels: Panel[] = [];
  const add: Add = (x) => panels.push(x);
  const n = Math.max(1, Math.round(num(p, 'places')));
  const tab = on(p, 'tablette') ? 450 : 0;
  const pw = (W - tab) / n;
  // Piètement → poutre → assises : chaque étage repose sur le précédent.
  add({ id: 'poutre', label: 'Poutre', size: [W, 60, 80], at: [0, 420, -60], look: 'tole', sheet: { bends: 3, returns: 30 } });
  for (const sx of [-1, 1]) add({ id: `pied-${sx}`, label: 'Piètement', size: [60, 390, D * 0.8], at: [sx * (W / 2 - 120), 195, 0], look: 'tole', sheet: { bends: 2, returns: 40 } });
  const ys = 450 + T;
  for (let i = 0; i < n; i++) {
    const x = -W / 2 + pw * (i + 0.5);
    add({ id: `assise-${i}`, label: `Assise ${i + 1}`, size: [pw - 30, T * 2, D * 0.7], at: [x, ys, 0], look: 'tole', sheet: { bends: 2, returns: 30 }, holes: on(p, 'perfore') ? perforations(pw - 30, D * 0.7, 8, 22, 40, 300) : undefined });
    add({ id: `dossier-${i}`, label: `Dossier ${i + 1}`, size: [pw - 30, H - ys, T * 2], at: [x, ys + (H - ys) / 2, -D * 0.35 - T], look: 'tole', sheet: { bends: 2, returns: 30 }, holes: on(p, 'perfore') ? perforations(pw - 30, H - 470, 8, 22, 40, 300) : undefined });
    if (on(p, 'accoudoirs') && i > 0) add({ id: `accoudoir-${i}`, label: 'Accoudoir', size: [40, 220, D * 0.6], at: [-W / 2 + pw * i, 560, 0], look: 'tole', sheet: { bends: 2, returns: 20 } });
  }
  if (tab) add({ id: 'tablette', label: 'Tablette', size: [tab - 30, T * 2, D * 0.7], at: [W / 2 - tab / 2, ys, 0], look: 'tole', sheet: { bends: 4, returns: 30 } });
  return { panels, motions: [], mechanisms: [] };
}

function bacFleurs(p: ProductSpec, T: number): ProductModel {
  const { width: W, height: H, depth: D } = p;
  const panels: Panel[] = [];
  const add: Add = (x) => panels.push(x);
  const y0 = on(p, 'roulettes') ? 90 : 0;
  if (y0) for (const sx of [-1, 1]) for (const sz of [-1, 1]) add({ id: `roulette-${sx}-${sz}`, label: 'Roulette', size: [50, y0, 50], at: [sx * (W / 2 - 50), y0 / 2, sz * (D / 2 - 50)], look: 'noir' });
  carcass(add, W, D, y0, H, T);
  panels.splice(panels.findIndex((x) => x.id === 'dessus'), 1);
  add({ id: 'face', label: 'Face avant', size: [W - 2 * T, H - y0, T], at: [0, y0 + (H - y0) / 2, D / 2 - T / 2], look: 'tole', sheet: { bends: 4, returns: 20 } });
  add({ id: 'rebord', label: 'Rebord', size: [W + 20, T, 40], at: [0, H, D / 2], look: 'tole', sheet: { bends: 2, returns: 20 } });
  const bottom = panels.find((x) => x.id === 'dessous');
  if (bottom && on(p, 'drainage')) bottom.holes = perforations(W - 2 * T, D - 2 * T, 10, 100, 60, 60);
  if (on(p, 'doubleFond')) add({ id: 'double-fond', label: 'Double fond perforé', size: [W - 4 * T, T, D - 4 * T], at: [0, y0 + 80, 0], look: 'galva', holes: perforations(W - 4 * T, D - 4 * T, 8, 40, 30, 200) });
  if (on(p, 'bois')) {
    const n = Math.max(2, Math.floor((H - y0) / 110));
    for (let i = 0; i < n; i++) add({ id: `lame-${i}`, label: 'Lame bois', size: [W + 10, (H - y0) / n - 10, 22], at: [0, y0 + ((H - y0) * (i + 0.5)) / n, D / 2 + 12], look: 'bois' });
  }
  return { panels, motions: [], mechanisms: [] };
}

function pergola(p: ProductSpec, _T: number): ProductModel {
  const { width: W, height: H, depth: D } = p;
  const panels: Panel[] = [];
  const motions: Motion[] = [];
  const add: Add = (x) => panels.push(x);
  const np = Math.max(2, Math.round(num(p, 'poteaux')));
  const per = np / 2;
  for (let i = 0; i < per; i++) for (const sz of [-1, 1]) {
    const x = per === 1 ? -W / 2 + 60 : -W / 2 + 60 + ((W - 120) * i) / (per - 1);
    add({ id: `poteau-${i}-${sz}`, label: 'Poteau', size: [120, H, 120], at: [x, H / 2, sz * (D / 2 - 60)], look: 'tole', sheet: { bends: 3, returns: 120 },
      holes: undefined, cutouts: i === 0 && sz > 0 ? [[0, -H / 2 + 300, 40, 80]] : undefined });
    add({ id: `platine-${i}-${sz}`, label: 'Platine de pied', size: [200, 10, 200], at: [x, 5, sz * (D / 2 - 60)], look: 'galva', holes: [[-70, -70, 14], [70, -70, 14], [-70, 70, 14], [70, 70, 14]] });
  }
  for (const sz of [-1, 1]) add({ id: `poutre-${sz}`, label: 'Poutre', size: [W, 200, 120], at: [0, H + 100, sz * (D / 2 - 60)], look: 'tole', sheet: { bends: 3, returns: 120 } });
  for (const sx of [-1, 1]) add({ id: `traverse-${sx}`, label: 'Traverse', size: [120, 200, D - 240], at: [sx * (W / 2 - 60), H + 100, 0], look: 'tole', sheet: { bends: 3, returns: 120 } });
  const n = Math.max(4, Math.floor((D - 240) / 180));
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const z = -D / 2 + 120 + ((D - 240) * (i + 0.5)) / n;
    const id = `lame-${i}`;
    if (on(p, 'lames')) { motions.push({ id, label: `Lame ${i + 1}`, type: 'hinge', axis: 'x', pivot: [0, H + 120, z], angle: 85 }); ids.push(id); }
    add({ id, label: `Lame ${i + 1}`, size: [W - 240, 22, 170], at: [0, H + 120, z], look: 'tole', sheet: { bends: 2, returns: 15 }, motion: on(p, 'lames') ? id : undefined });
  }
  if (on(p, 'lames') && on(p, 'moteur')) motorMount(add, 'moteur', 'Support du moteur des lames', [W / 2 - 300, H + 30, D / 2 - 200], 160, 120, 70);
  if (on(p, 'led')) for (const sz of [-1, 1]) add({ id: `led-${sz}`, label: 'Bandeau LED', size: [W - 300, 10, 14], at: [0, H + 4, sz * (D / 2 - 130)], look: 'led', color: 0xfef9c3, glow: { color: 0xfff1b8, mode: 'steady' } });
  return { panels, motions, mechanisms: ids.length ? [{ id: 'lames', label: 'Lames', open: 'Ouvrir les lames', close: 'Fermer les lames', members: ids }] : [] };
}

function porte(p: ProductSpec, T: number): ProductModel {
  const { width: W, height: H, depth: D } = p;
  const panels: Panel[] = [];
  const motions: Motion[] = [];
  const add: Add = (x) => panels.push(x);
  const f = 60;
  const imp = on(p, 'imposte') ? 400 : 0;
  const hh = H - f - imp;
  add({ id: 'dormant-haut', label: 'Dormant haut', size: [W, f, D], at: [0, H - f / 2, 0], look: 'tole', sheet: { bends: 3, returns: D } });
  for (const s of [-1, 1]) add({ id: `dormant${s}`, label: 'Dormant latéral', size: [f, H, D], at: [s * (W / 2 - f / 2), H / 2, 0], look: 'tole', sheet: { bends: 3, returns: D }, holes: [[0, -H / 4, 10], [0, 0, 10], [0, H / 4, 10]] });
  if (imp) add({ id: 'imposte', label: 'Imposte', size: [W - 2 * f, imp - 20, 10], at: [0, hh + imp / 2, 0], look: 'verre' });
  const n = Math.max(1, Math.min(2, Math.round(num(p, 'vantaux'))));
  const vw = (W - 2 * f) / n;
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const left = i === 0;
    const cx = -W / 2 + f + vw * (i + 0.5);
    const id = `vantail-${i}`;
    ids.push(id);
    motions.push({ id, label: `Vantail ${i + 1}`, type: 'hinge', axis: 'y', pivot: [left ? -W / 2 + f : W / 2 - f, hh / 2, D / 2], angle: left ? -95 : 95 });
    if (on(p, 'vitree')) glazed(add, id, `Vantail ${i + 1}`, [cx, hh / 2, D / 2 - T], vw - 6, hh - 6, T * 2, id, 120);
    else add({ id, label: `Vantail ${i + 1}`, size: [vw - 6, hh - 6, D * 0.6], at: [cx, hh / 2, 0], look: 'tole', sheet: { bends: 4, returns: D * 0.6 }, motion: id });
    const front = on(p, 'vitree') ? D / 2 : D * 0.3;
    if (on(p, 'serrure') || i === 0) add({ id: `${id}-serrure`, label: 'Serrure', size: [30, 260, 40], at: [left ? cx + vw / 2 - 60 : cx - vw / 2 + 60, 1050, front + 20], look: 'galva', motion: id });
  }
  return { panels, motions, mechanisms: [{ id: 'porte', label: 'Porte', open: n > 1 ? 'Ouvrir les vantaux' : 'Ouvrir la porte', close: 'Fermer', members: ids }] };
}

function borneSonore(p: ProductSpec, T: number): ProductModel {
  const { width: W, height: H, depth: D } = p;
  const panels: Panel[] = [];
  const motions: Motion[] = [];
  const add: Add = (x) => panels.push(x);
  const find = (id: string) => panels.find((x) => x.id === id);
  add({ id: 'platine', label: 'Platine', size: [W + 120, 15, D + 120], at: [0, 7.5, 0], look: 'galva', holes: [[-(W + 120) / 2 + 30, -(D + 120) / 2 + 30, 14], [(W + 120) / 2 - 30, (D + 120) / 2 - 30, 14]] });
  carcass(add, W, D, 15, H, T, !on(p, 'maintenance'));
  cablePass(find('dessous'), [[0, 0, 50]]);
  const n = Math.max(1, Math.round(num(p, 'hautParleurs')));
  const zone = Math.min(H * 0.4, n * 260);
  const fy = H - 120 - zone / 2;
  add({ id: 'facade', label: 'Façade', size: [W - 2 * T, H - 15 - T, T], at: [0, 15 + (H - 15 - T) / 2, D / 2 - T / 2], look: 'tole', sheet: { bends: 4, returns: 25 },
    holes: perforations(W - 80, zone, 5, 9, 0, 900).map(([u, v, d]) => [u, v + fy - (15 + (H - 15 - T) / 2), d] as [number, number, number]) });
  for (let i = 0; i < n; i++) {
    const y = fy + zone / 2 - (zone * (i + 0.5)) / n;
    add({ id: `hp-${i}`, label: `Haut-parleur ${i + 1}`, size: [W * 0.5, W * 0.5, 80], at: [0, y, D / 2 - T - 40], look: 'noir', glow: { color: 0x60a5fa, mode: 'pulse' } });
    add({ id: `hp-${i}-support`, label: `Support haut-parleur ${i + 1}`, size: [W - 2 * T, W * 0.6, 3], at: [0, y, D / 2 - T - 81.5], look: 'galva', sheet: { bends: 2, returns: 20 }, holes: [[0, 0, W * 0.4], [-W * 0.28, W * 0.22, 6], [W * 0.28, W * 0.22, 6], [-W * 0.28, -W * 0.22, 6], [W * 0.28, -W * 0.22, 6]] });
  }
  add({ id: 'ampli-support', label: 'Support d’amplificateur', size: [W - 2 * T, 3, D * 0.6], at: [0, H * 0.3, 0], look: 'galva', sheet: { bends: 2, returns: 25 }, holes: [[-60, -40, 5], [60, -40, 5], [-60, 40, 5], [60, 40, 5], [0, 0, 30]] });
  if (on(p, 'bouton')) {
    add({ id: 'bouton', label: 'Bouton d’appel', size: [70, 70, 20], at: [0, fy - zone / 2 - 120, D / 2 + 8], look: 'led', color: 0x22c55e, glow: { color: 0x22c55e, mode: 'pulse' } });
    openingFor(find('facade'), find('bouton'), 10);
  }
  if (on(p, 'ecran')) {
    add({ id: 'ecran', label: 'Écran', size: [W * 0.7, W * 0.45, 8], at: [0, fy - zone / 2 - 330, D / 2 + 4], look: 'ecran', glow: { color: 0x93c5fd, mode: 'steady' } });
    openingFor(find('facade'), find('ecran'), 12);
  }
  if (on(p, 'maintenance')) {
    motions.push({ id: 'maintenance', label: 'Trappe de maintenance', type: 'hinge', axis: 'y', pivot: [-W / 2, H / 2, -D / 2], angle: 100 });
    add({ id: 'maintenance', label: 'Trappe de maintenance', size: [W - 2 * T, H - 15 - T, T], at: [0, 15 + (H - 15 - T) / 2, -D / 2 + T / 2], look: 'tole', sheet: { bends: 4, returns: 22 }, motion: 'maintenance' });
  }
  return { panels, motions, mechanisms: on(p, 'maintenance') ? [{ id: 'maintenance', label: 'Maintenance', open: 'Ouvrir la maintenance', close: 'Fermer la maintenance', members: ['maintenance'] }] : [] };
}

function gel(p: ProductSpec, _T: number): ProductModel {
  const { width: W, height: H, depth: D } = p;
  const panels: Panel[] = [];
  const motions: Motion[] = [];
  const add: Add = (x) => panels.push(x);
  add({ id: 'socle', label: 'Socle', size: [W, 12, D], at: [0, 6, 0], look: 'tole', sheet: { bends: 4, returns: 15 } });
  add({ id: 'colonne', label: 'Colonne', size: [80, H - 260, 80], at: [0, 12 + (H - 260) / 2, -D / 2 + 60], look: 'tole', sheet: { bends: 3, returns: 80 } });
  add({ id: 'tete', label: 'Tête (support flacon)', size: [W * 0.8, 240, D * 0.7], at: [0, H - 120, -D * 0.05], look: 'tole', sheet: { bends: 4, returns: 25 }, holes: [[0, 0, 40]] });
  add({ id: 'flacon', label: 'Flacon (composant)', size: [90, 180, 90], at: [0, H - 120, -D * 0.05], look: 'blanc' });
  const mech: string[] = [];
  if (on(p, 'pedale')) {
    motions.push({ id: 'pedale', label: 'Pédale', type: 'hinge', axis: 'x', pivot: [0, 30, -D / 2 + 110], angle: 12 });
    add({ id: 'pedale', label: 'Pédale', size: [120, 12, 160], at: [0, 30, -D / 2 + 180], look: 'tole', sheet: { bends: 2, returns: 15 }, motion: 'pedale', holes: perforations(120, 160, 5, 14, 10, 60) });
    motions.push({ id: 'tige', label: 'Tige de commande', type: 'slide', move: [0, -18, 0] });
    add({ id: 'tige', label: 'Tige de commande (dans la colonne)', size: [10, H - 320, 10], at: [0, 40 + (H - 320) / 2, -D / 2 + 60], look: 'galva', motion: 'tige' });
    mech.push('pedale', 'tige');
  }
  if (on(p, 'bac')) add({ id: 'bac', label: 'Bac récupérateur', size: [W * 0.5, 30, 120], at: [0, H - 255, D * 0.1], look: 'tole', sheet: { bends: 4, returns: 30 } });
  if (on(p, 'affiche')) add({ id: 'affiche', label: 'Porte-affiche A4', size: [220, 310, 4], at: [0, H * 0.5, -D / 2 + 102], look: 'blanc' });
  return { panels, motions, mechanisms: mech.length ? [{ id: 'pedale', label: 'Pédale', open: 'Appuyer sur la pédale', close: 'Relâcher', members: mech }] : [] };
}

function tri(p: ProductSpec, T: number): ProductModel {
  const { width: W, height: H, depth: D } = p;
  const panels: Panel[] = [];
  const add: Add = (x) => panels.push(x);
  const legs = 850;
  const y0 = on(p, 'roulettes') ? 100 : 0;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add({ id: `pied-${sx}-${sz}`, label: on(p, 'roulettes') ? 'Pied sur roulette' : 'Pied', size: [40, legs - y0, 40], at: [sx * (W / 2 - 20), y0 + (legs - y0) / 2, sz * (D / 2 - 20)], look: 'tole', sheet: { bends: 3, returns: 20 } });
  if (y0) for (const sx of [-1, 1]) for (const sz of [-1, 1]) add({ id: `roulette-${sx}-${sz}`, label: 'Roulette', size: [50, y0, 50], at: [sx * (W / 2 - 20), y0 / 2, sz * (D / 2 - 20)], look: 'noir' });
  if (on(p, 'plan')) add({ id: 'plan', label: 'Plan de travail', size: [W, 25, D + 150], at: [0, legs, 75], look: 'tole', sheet: { bends: 4, returns: 30 } });
  const c = Math.max(2, Math.round(num(p, 'colonnes')));
  const r = Math.max(2, Math.round(num(p, 'rangees')));
  const y1 = legs + (on(p, 'plan') ? 12.5 : 0);
  const hh = H - y1;
  for (let i = 0; i <= c; i++) add({ id: `sep-v-${i}`, label: i === 0 || i === c ? 'Joue' : 'Séparation verticale', size: [T, hh, D], at: [-W / 2 + (W * i) / c + (i === 0 ? T / 2 : i === c ? -T / 2 : 0), y1 + hh / 2, 0], look: 'tole', sheet: { bends: 2, returns: 15 } });
  for (let j = 0; j <= r; j++) add({ id: `sep-h-${j}`, label: j === 0 ? 'Fond de casier' : j === r ? 'Dessus' : 'Tablette', size: [W, T, D], at: [0, y1 + (hh * j) / r, 0], look: 'tole', sheet: { bends: 2, returns: 15 },
    cutouts: j > 0 && j < r ? Array.from({ length: c }, (_, i) => [-W / 2 + (W * (i + 0.5)) / c, -D / 2 + 20, 60, 10] as [number, number, number, number]) : undefined });
  add({ id: 'fond', label: 'Fond', size: [W, hh, T], at: [0, y1 + hh / 2, -D / 2 + T / 2], look: 'tole', sheet: { bends: 2, returns: 15 } });
  return { panels, motions: [], mechanisms: [] };
}

function caveVin(p: ProductSpec, T: number): ProductModel {
  const { width: W, height: H, depth: D } = p;
  const panels: Panel[] = [];
  const add: Add = (x) => panels.push(x);
  const c = Math.max(2, Math.round(num(p, 'colonnes')));
  const r = Math.max(2, Math.round(num(p, 'rangees')));
  const big: [number, number, number][] = [];
  const small: [number, number, number][] = [];
  const pu = (W - 80) / c;
  const pv = (H - 120) / r;
  const d = Math.min(92, pu - 8, pv - 8);
  for (let i = 0; i < c; i++) for (let j = 0; j < r; j++) {
    const u = -W / 2 + 40 + pu * (i + 0.5);
    const v = -H / 2 + 60 + pv * (j + 0.5);
    big.push([u, v, d]);
    small.push([u, v, Math.min(34, d * 0.4)]);
  }
  for (const s of [-1, 1]) add({ id: `montant${s}`, label: on(p, 'bois') ? 'Montant bois' : 'Montant', size: [50, H, D], at: [s * (W / 2 + 25), H / 2, 0], look: on(p, 'bois') ? 'bois' : 'tole', sheet: on(p, 'bois') ? undefined : { bends: 2, returns: 30 } });
  add({ id: 'face', label: 'Plaque avant (corps de bouteille)', size: [W, H, T], at: [0, H / 2, D / 2 - T / 2], look: 'tole', sheet: { bends: 2, returns: 20 }, holes: big });
  add({ id: 'arriere', label: 'Plaque arrière (goulots)', size: [W, H, T], at: [0, H / 2, -D / 2 + T / 2], look: 'tole', sheet: { bends: 2, returns: 20 }, holes: small });
  if (on(p, 'bouteilles')) big.filter((_, k) => k % 3 !== 1).slice(0, 60).forEach(([u, v], k) => add({ id: `bouteille-${k}`, label: 'Bouteille', size: [d * 0.85, d * 0.85, D + 60], at: [u, H / 2 + v, 20], look: 'boite', color: k % 4 ? 0x14532d : 0x7f1d1d }));
  return { panels, motions: [], mechanisms: [] };
}

function lampe(p: ProductSpec, T: number): ProductModel {
  const { width: W, height: H, depth: D } = p;
  const panels: Panel[] = [];
  const add: Add = (x) => panels.push(x);
  const d = num(p, 'trou');
  const base = on(p, 'suspension') ? 0 : 60;
  if (base) add({ id: 'socle', label: on(p, 'bois') ? 'Socle bois' : 'Socle', size: [W, base, D], at: [0, base / 2, 0], look: on(p, 'bois') ? 'bois' : 'tole' });
  const hh = H - base;
  const y = base + hh / 2;
  add({ id: 'face-av', label: 'Abat-jour avant', size: [W, hh, T], at: [0, y, D / 2 - T / 2], look: 'tole', sheet: { bends: 2, returns: 15 }, holes: perforations(W, hh, d, d * 2.2, 15, 500) });
  add({ id: 'face-ar', label: 'Abat-jour arrière', size: [W, hh, T], at: [0, y, -D / 2 + T / 2], look: 'tole', sheet: { bends: 2, returns: 15 }, holes: perforations(W, hh, d, d * 2.2, 15, 500) });
  for (const s of [-1, 1]) add({ id: `cote${s}`, label: 'Abat-jour latéral', size: [T, hh, D - 2 * T], at: [s * (W / 2 - T / 2), y, 0], look: 'tole', holes: perforations(D - 2 * T, hh, d, d * 2.2, 15, 500) });
  // Support de douille entre les quatre faces, ampoule posée dessus.
  add({ id: 'douille', label: 'Support de douille', size: [W - 2 * T, T, D - 2 * T], at: [0, y - 60, 0], look: 'galva', sheet: { bends: 0, returns: 0 }, holes: [[0, 0, 28]] });
  add({ id: 'ampoule', label: 'Ampoule', size: [60, 90, 60], at: [0, y - 60 + T / 2 + 45, 0], look: 'led', color: 0xfff7e6, glow: { color: 0xffd58a, mode: 'steady' } });
  return { panels, motions: [], mechanisms: [] };
}

function supportMenu(p: ProductSpec, T: number): ProductModel {
  const { width: W, height: H, depth: D } = p;
  const panels: Panel[] = [];
  const add: Add = (x) => panels.push(x);
  add({ id: 'socle', label: 'Socle', size: [W * 0.8, 10, D], at: [0, 5, 0], look: 'tole', sheet: { bends: 0, returns: 0 } });
  add({ id: 'mat', label: 'Mât', size: [50, H - 200, 50], at: [0, 10 + (H - 200) / 2, 0], look: 'tole', sheet: { bends: 3, returns: 50 } });
  const a = num(p, 'inclinaison');
  add({ id: 'pupitre', label: 'Pupitre', size: [W, 330, T * 2], at: [0, H - 120, 40], look: 'tole', sheet: { bends: 3, returns: 25 }, rot: [-a, 0, 0] });
  add({ id: 'menu', label: 'Menu (A4)', size: [210, 297, 2], at: [0, H - 120, 40 + T * 1.5], look: 'blanc', rot: [-a, 0, 0] });
  if (on(p, 'eclairage')) {
    // Col de cygne fixé sur le bord haut du pupitre, réglette au bout.
    const ra = (a * Math.PI) / 180;
    const ty = H - 120 + 165 * Math.cos(ra);
    const tz = 40 - 165 * Math.sin(ra);
    add({ id: 'col', label: 'Col de cygne', size: [12, 150, 12], at: [0, ty + 75, tz], look: 'galva' });
    add({ id: 'lampe', label: 'Éclairage', size: [W * 0.6, 14, 60], at: [0, ty + 157, tz + 24], look: 'led', color: 0xfff7e6, glow: { color: 0xffd58a, mode: 'steady' } });
  }
  return { panels, motions: [], mechanisms: [] };
}

function chariot(p: ProductSpec, T: number): ProductModel {
  const { width: W, height: H, depth: D } = p;
  const panels: Panel[] = [];
  const add: Add = (x) => panels.push(x);
  const y0 = 120;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    add({ id: `roulette-${sx}-${sz}`, label: on(p, 'freins') ? 'Roulette à frein' : 'Roulette', size: [60, y0, 60], at: [sx * (W / 2 - 30), y0 / 2, sz * (D / 2 - 30)], look: 'noir' });
    add({ id: `tube-${sx}-${sz}`, label: 'Tube vertical 30×30', size: [30, H - y0, 30], at: [sx * (W / 2 - 30), y0 + (H - y0) / 2, sz * (D / 2 - 30)], look: 'tole', sheet: { bends: 0, returns: 0 } });
    add({ id: `platine-${sx}-${sz}`, label: 'Platine de roulette', size: [80, 4, 80], at: [sx * (W / 2 - 30), y0, sz * (D / 2 - 30)], look: 'galva', holes: [[-28, -28, 8], [28, -28, 8], [-28, 28, 8], [28, 28, 8]] });
  }
  const n = Math.max(1, Math.round(num(p, 'niveaux')));
  // Plateaux encochés aux quatre angles autour des tubes (soudés dans l'encoche).
  const notch: [number, number, number, number][] = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => [sx * (W / 2 - 30), -sz * (D / 2 - 30), 32, 32] as [number, number, number, number]));
  for (let i = 0; i < n; i++) add({ id: `plateau-${i}`, label: `Plateau ${i + 1}`, size: [W - 20, T, D - 20], at: [0, y0 + 60 + ((H - y0 - 80) * i) / Math.max(1, n - 1 || 1), 0], look: 'tole', sheet: { bends: 4, returns: 30 }, cutouts: notch });
  if (on(p, 'poignee')) {
    for (const sz of [-1, 1]) add({ id: `poignee-montant${sz}`, label: 'Montant de poignée', size: [30, 150, 30], at: [W / 2 - 30, H + 75, sz * (D / 2 - 30)], look: 'galva' });
    add({ id: 'poignee', label: 'Poignée de poussée', size: [30, 30, D - 30], at: [W / 2 - 30, H + 165, 0], look: 'galva' });
  }
  return { panels, motions: [], mechanisms: [] };
}

function grille(p: ProductSpec, T: number): ProductModel {
  const { width: W, height: H, depth: D } = p;
  const panels: Panel[] = [];
  const add: Add = (x) => panels.push(x);
  // Les persiennes ont toujours leurs joues latérales (les lames y sont soudées).
  if (!on(p, 'cadre') && on(p, 'persiennes')) for (const s of [-1, 1]) add({ id: `joue${s}`, label: 'Joue', size: [30, H, D], at: [s * (W / 2 - 15), H / 2, 0], look: 'tole', sheet: { bends: 2, returns: D } });
  if (on(p, 'cadre')) {
    add({ id: 'cadre-h', label: 'Cadre haut', size: [W, 30, D], at: [0, H - 15, 0], look: 'tole', sheet: { bends: 2, returns: D }, holes: [[-W / 2 + 40, 0, 6], [W / 2 - 40, 0, 6]] });
    add({ id: 'cadre-b', label: 'Cadre bas', size: [W, 30, D], at: [0, 15, 0], look: 'tole', sheet: { bends: 2, returns: D }, holes: [[-W / 2 + 40, 0, 6], [W / 2 - 40, 0, 6]] });
    for (const s of [-1, 1]) add({ id: `cadre${s}`, label: 'Cadre latéral', size: [30, H - 60, D], at: [s * (W / 2 - 15), H / 2, 0], look: 'tole', sheet: { bends: 2, returns: D } });
  }
  if (on(p, 'persiennes')) {
    const n = Math.max(3, Math.round(num(p, 'lames')));
    const ph = (H - 60) / n;
    for (let i = 0; i < n; i++) add({ id: `lame-${i}`, label: `Lame ${i + 1}`, size: [W - 60, ph * 1.1, T], at: [0, 30 + ph * (i + 0.5), 0], look: 'tole', sheet: { bends: 2, returns: 10 }, rot: [-40, 0, 0] });
  } else add({ id: 'grille', label: 'Tôle perforée', size: [W - 60, H - 60, T], at: [0, H / 2, 0], look: 'tole', holes: perforations(W - 60, H - 60, 6, 10, 10, 900) });
  return { panels, motions: [], mechanisms: [] };
}

function tremie(p: ProductSpec, T: number): ProductModel {
  const { width: W, height: H, depth: D } = p;
  const panels: Panel[] = [];
  const motions: Motion[] = [];
  const add: Add = (x) => panels.push(x);
  // Hauteurs : goulotte (sous le cône), cône, caisse droite. Le cône va des bords de la caisse à la goulotte.
  const spout = 120;
  const legs = on(p, 'pieds') ? Math.max(spout + 60, H * 0.3) : spout + 20;
  const coneH = (H - legs) * 0.45;
  const boxH = H - legs - coneH;
  const yb = legs + coneH;
  const out = Math.max(80, Math.min(W, D) * 0.25);
  // Caisse droite : deux joues pleines largeur, deux faces entre elles (pas de recouvrement aux angles), ourlet en haut.
  for (const s of [-1, 1]) add({ id: `paroi-x${s}`, label: 'Paroi latérale', size: [T, boxH, D], at: [s * (W / 2 - T / 2), yb + boxH / 2, 0], look: 'tole', sheet: { bends: 2, returns: 30, hems: 1 } });
  for (const s of [-1, 1]) add({ id: `paroi-z${s}`, label: s > 0 ? 'Paroi avant' : 'Paroi arrière', size: [W - 2 * T, boxH, T], at: [0, yb + boxH / 2, s * (D / 2 - T / 2)], look: 'tole', sheet: { bends: 2, returns: 30, hems: 1 } });
  // Cône : quatre trapèzes dont les arêtes se rejoignent exactement (des angles de la caisse aux angles de la goulotte).
  const lz = Math.hypot(coneH, (D - out) / 2);
  const lx = Math.hypot(coneH, (W - out) / 2);
  const az = (Math.atan2((D - out) / 2, coneH) * 180) / Math.PI;
  const ax = (Math.atan2((W - out) / 2, coneH) * 180) / Math.PI;
  const yc = legs + coneH / 2;
  for (const s of [-1, 1]) add({ id: `cone-z${s}`, label: s > 0 ? 'Cône : face avant' : 'Cône : face arrière', size: [W, lz, T], at: [0, yc, (s * (D + out)) / 4], look: 'tole', sheet: { bends: 2, returns: 20 },
    rot: [s * az, 0, 0], poly: [[-out / 2, -lz / 2], [out / 2, -lz / 2], [W / 2, lz / 2], [-W / 2, lz / 2]] });
  for (const s of [-1, 1]) add({ id: `cone-x${s}`, label: s > 0 ? 'Cône : face droite' : 'Cône : face gauche', size: [T, lx, D], at: [(s * (W + out)) / 4, yc, 0], look: 'tole', sheet: { bends: 2, returns: 20 },
    rot: [0, 0, -s * ax], poly: [[-out / 2, -lx / 2], [out / 2, -lx / 2], [D / 2, lx / 2], [-D / 2, lx / 2]] });
  // Goulotte carrée creuse sous le cône, puis bride percée (vanne ou raccord dessous).
  for (const s of [-1, 1]) add({ id: `goulotte-x${s}`, label: 'Goulotte', size: [T, spout, out], at: [s * (out / 2 - T / 2), legs - spout / 2, 0], look: 'tole', sheet: { bends: 1, returns: 0 } });
  for (const s of [-1, 1]) add({ id: `goulotte-z${s}`, label: 'Goulotte', size: [out - 2 * T, spout, T], at: [0, legs - spout / 2, s * (out / 2 - T / 2)], look: 'tole', sheet: { bends: 1, returns: 0 } });
  const yf = legs - spout - 5;
  add({ id: 'bride', label: 'Bride de sortie', size: [out + 80, 10, out + 80], at: [0, yf, 0], look: 'galva', sheet: { bends: 0, returns: 0 },
    holes: [[-out / 2 - 20, -out / 2 - 20, 12], [out / 2 + 20, -out / 2 - 20, 12], [-out / 2 - 20, out / 2 + 20, 12], [out / 2 + 20, out / 2 + 20, 12]], cutouts: [[0, 0, out - 2 * T, out - 2 * T]] });
  // Pieds soudés sur les joues (à l'extérieur), du sol jusqu'au tiers de la caisse.
  if (on(p, 'pieds')) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const top = yb + boxH * 0.35;
    add({ id: `pied-${sx}-${sz}`, label: 'Pied', size: [50, top, 50], at: [sx * (W / 2 + 25), top / 2, sz * (D / 2 - 40)], look: 'tole', sheet: { bends: 3, returns: 50 } });
    add({ id: `semelle-${sx}-${sz}`, label: 'Platine de pied', size: [100, 8, 100], at: [sx * (W / 2 + 25), 4, sz * (D / 2 - 40)], look: 'galva', holes: [[-30, -30, 12], [30, 30, 12]] });
  }
  const mech: Mechanism[] = [];
  if (on(p, 'vanne')) {
    // Lame de guillotine glissée sous la bride, guidée par deux rails.
    motions.push({ id: 'vanne', label: 'Vanne guillotine', type: 'slide', move: [out + 40, 0, 0] });
    add({ id: 'vanne', label: 'Lame de vanne', size: [out + 20, 6, out + 20], at: [0, yf - 8, 0], look: 'galva', sheet: { bends: 0, returns: 0 }, motion: 'vanne' });
    for (const s of [-1, 1]) add({ id: `vanne-rail${s}`, label: 'Rail de vanne', size: [out * 2 + 80, 12, 20], at: [out / 2, yf - 11, s * (out / 2 + 30)], look: 'galva', sheet: { bends: 2, returns: 10 } });
    mech.push({ id: 'vanne', label: 'Vanne', open: 'Ouvrir la vanne', close: 'Fermer la vanne', members: ['vanne'] });
  }
  if (on(p, 'couvercle')) {
    motions.push({ id: 'couvercle', label: 'Couvercle', type: 'hinge', axis: 'x', pivot: [0, H, -D / 2], angle: -100 });
    add({ id: 'couvercle', label: 'Couvercle', size: [W + 20, T, D + 20], at: [0, H + T / 2, 0], look: 'tole', sheet: { bends: 4, returns: 30 }, motion: 'couvercle' });
    mech.push({ id: 'couvercle', label: 'Couvercle', open: 'Ouvrir le couvercle', close: 'Fermer le couvercle', members: ['couvercle'] });
  }
  if (on(p, 'vibreur')) {
    // Console soudée sur la joue droite, support du vibreur boulonné dessus.
    const y = yb + boxH * 0.45;
    add({ id: 'console', label: 'Console du vibreur', size: [160, 6, 180], at: [W / 2 + 80, y, 0], look: 'galva', sheet: { bends: 2, returns: 40 } });
    motorMount(add, 'vibreur', 'Support de vibreur', [W / 2 + 80, y + 4.5, 0], 120, 100, 60);
    motions.push({ id: 'vibration', label: 'Vibration', type: 'slide', move: [0, 3, 0], auto: true });
  }
  return { panels, motions, mechanisms: mech };
}

function marche(p: ProductSpec, T: number): ProductModel {
  const { width: W, height: H, depth: D } = p;
  const panels: Panel[] = [];
  const add: Add = (x) => panels.push(x);
  const n = Math.max(1, Math.round(num(p, 'marches')));
  const rise = n > 1 ? H / n : 0;
  const run = n > 1 ? D / n : D;
  const g = Math.min(run + 30, 300);
  for (let i = 0; i < n; i++) {
    const y = n > 1 ? rise * (i + 1) : 40;
    const z = D / 2 - run * (i + 0.5);
    add({ id: `marche-${i}`, label: `Marche ${i + 1}`, size: [W, T, g], at: [0, y, z], look: 'tole', sheet: { bends: 2, returns: 40 }, holes: on(p, 'perforations') ? perforations(W - 80, g - 40, 7, 28, 0, 400) : undefined });
    add({ id: `nez-${i}`, label: `Nez de marche ${i + 1}`, size: [W, 40, T], at: [0, y - 20, z + g / 2], look: 'tole' });
  }
  if (on(p, 'limons') && n > 1) {
    const a = (Math.atan2(H, D) * 180) / Math.PI;
    const L = Math.hypot(H, D);
    for (const s of [-1, 1]) add({ id: `limon${s}`, label: 'Limon', size: [8, 220, L], at: [s * (W / 2 + 4), H / 2, 0], look: 'tole', sheet: { bends: 2, returns: 50 }, rot: [a, 0, 0] });
  }
  return { panels, motions: [], mechanisms: [] };
}

function tolePerforee(p: ProductSpec, T: number): ProductModel {
  const { width: W, height: H } = p;
  const panels: Panel[] = [];
  const add: Add = (x) => panels.push(x);
  add({ id: 'tole', label: 'Tôle perforée', size: [W, H, T], at: [0, H / 2, 0], look: 'tole', sheet: { bends: on(p, 'cadre') ? 4 : 0, returns: on(p, 'cadre') ? 20 : 0 }, holes: perforations(W, H, num(p, 'trou'), num(p, 'pas'), 20, 1500) });
  if (on(p, 'cadre')) for (const [id, size, at] of [['bord-h', [W, 20, T], [0, H, -10]], ['bord-b', [W, 20, T], [0, 0, -10]]] as [string, V3, V3][]) add({ id, label: 'Bord plié', size: [size[0], T, 20], at, look: 'tole' });
  return { panels, motions: [], mechanisms: [] };
}

function cassette(p: ProductSpec, T: number): ProductModel {
  const { width: W, height: H, depth: D } = p;
  const panels: Panel[] = [];
  const add: Add = (x) => panels.push(x);
  const c = Math.max(1, Math.round(num(p, 'colonnes')));
  const r = Math.max(1, Math.round(num(p, 'rangees')));
  const j = num(p, 'joint');
  const cw = W / c;
  const rh = H / r;
  for (let i = 0; i < c; i++) for (let k = 0; k < r; k++) {
    add({ id: `cassette-${i}-${k}`, label: `Cassette ${letter(i)}${k + 1}`, size: [cw - j, rh - j, T * 2], at: [-W / 2 + cw * (i + 0.5), rh * (k + 0.5), D / 2], look: 'tole', sheet: { bends: 4, returns: D },
      holes: on(p, 'perfore') ? perforations(cw - j, rh - j, 12, 30, 40, 250) : undefined });
    for (const s of [-1, 1]) add({ id: `cassette-${i}-${k}-retour${s}`, label: 'Retour de cassette (accroche)', size: [T, rh - j, D], at: [-W / 2 + cw * (i + 0.5) + s * ((cw - j) / 2 - T / 2), rh * (k + 0.5), 0], look: 'tole', holes: [[0, (rh - j) / 2 - 30, 8], [0, -(rh - j) / 2 + 30, 8]] });
  }
  for (let i = 0; i <= c; i++) add({ id: `rail-${i}`, label: 'Ossature (oméga)', size: [40, H, 30], at: [-W / 2 + cw * i, H / 2, -D / 2 - 15], look: 'galva', sheet: { bends: 4, returns: 20 } });
  return { panels, motions: [], mechanisms: [] };
}

/**
 * Bande de tôle pliée suivant un profil (vue de côté, points (z, y) en mm) : un panneau par segment,
 * chaque pli partagé exactement avec le segment suivant — c'est la pièce « origami » d'un seul tenant.
 */
function foldedStrip(add: Add, id: string, label: string, pts: [number, number][], W: number, T: number, x = 0) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [z0, y0] = pts[i];
    const [z1, y1] = pts[i + 1];
    const len = Math.hypot(z1 - z0, y1 - y0);
    const th = (Math.atan2(z1 - z0, y1 - y0) * 180) / Math.PI;
    add({ id: `${id}-${i}`, label: `${label} : facette ${i + 1}`, size: [W, len, T], at: [x, (y0 + y1) / 2, (z0 + z1) / 2], look: 'tole', rot: [th, 0, 0],
      sheet: { bends: i === 0 || i === pts.length - 2 ? 1 : 2, returns: 0, hems: i === 0 || i === pts.length - 2 ? 1 : 0 } });
  }
}

function fauteuil(p: ProductSpec, T: number): ProductModel {
  const { width: W, height: H, depth: D } = p;
  const panels: Panel[] = [];
  const add: Add = (x) => panels.push(x);
  const t = Math.max(T, 2);
  // Profil de côté (avant = z+) : pied avant, assise, dossier, pied arrière — une seule tôle pliée.
  const pts: [number, number][] = on(p, 'allonge')
    ? [[D / 2, 0], [D / 2 - 90, 330], [D / 2 - D * 0.36, 400], [-D / 2 + D * 0.3, 360], [-D / 2 + 140, H], [-D / 2, 0]]
    : [[D / 2, 0], [D / 2 - 60, 420], [-D / 2 + D * 0.3, 380], [-D / 2 + 90, H], [-D / 2, 0]];
  foldedStrip(add, 'coque', 'Coque pliée', pts, W, t);
  // Accoudoirs : deux joues pliées en V de chaque côté, posées sur la coque.
  if (on(p, 'accoudoirs')) {
    const [za, ya] = pts[on(p, 'allonge') ? 3 : 2];
    const [zb, yb] = pts[1];
    for (const s of [-1, 1]) foldedStrip(add, `accoudoir${s}`, s < 0 ? 'Accoudoir gauche' : 'Accoudoir droit', [[za, ya], [(za + zb) / 2, Math.max(ya, yb) + 230], [zb, yb]], 60, t, s * (W / 2 + 30));
  }
  if (on(p, 'coussin')) {
    const i = on(p, 'allonge') ? 3 : 2;
    const [z0, y0] = pts[i - 1];
    const [z1, y1] = pts[i];
    const len = Math.hypot(z1 - z0, y1 - y0);
    const th = (Math.atan2(z1 - z0, y1 - y0) * 180) / Math.PI;
    add({ id: 'coussin', label: 'Coussin d’assise', size: [W - 60, len - 40, 60], at: [0, (y0 + y1) / 2 + 30, (z0 + z1) / 2], look: 'rideau', rot: [th, 0, 0] });
  }
  // Patins sous les pieds.
  for (const [z] of [pts[0], pts[pts.length - 1]]) add({ id: `patin${z}`, label: 'Patin', size: [W - 40, 8, 40], at: [0, 4, z - Math.sign(z) * 20], look: 'noir' });
  return { panels, motions: [], mechanisms: [] };
}

/** Objet sur mesure décrit panneau par panneau (par l'IA) : les panneaux tels quels, puis l'usinage automatique. */
function libre(p: ProductSpec): ProductModel {
  return { panels: (p.custom?.panels ?? []).map((x, i) => ({ ...x, id: x.id || `p${i}` })), motions: [], mechanisms: [] };
}

// --- Fabrication et chiffrage --------------------------------------------------------------------

export interface SheetPart {
  id: string;
  label: string;
  /** Développé : les deux grandes cotes + bords tombés, déduction de pli (facteur K) et ourlets compris. */
  a: number;
  b: number;
  bends: number;
  /** Contre-plis (ourlets à 180°). */
  hems: number;
  /** Surface développée (trous déduits), mm². */
  area: number;
  /** Longueur de découpe (contour, trous, ouvertures), mm. */
  cut: number;
  pierces: number;
}

/** Tôles à fabriquer (une ligne par panneau) ; les composants achetés sont exclus. */
/**
 * Contre-plis (ourlets à 180°, plis écrasés) d'un panneau : ceux déclarés, sinon par usage — bord visible ou
 * coupant d'une tablette, d'un plateau, d'un nez de marche ; double retour des portes et façades de tiroir.
 */
export function hemsOf(p: Panel): number {
  if (p.sheet?.hems !== undefined) return p.sheet.hems;
  if (!p.sheet || p.sheet.bends === 0) return 0;
  if (/porte|vantail|trappe|façade tiroir|tiroir .*façade/i.test(p.label)) return 2;
  if (/tablette|étagère|plateau|rebord|nez|cassette|comptoir|plan de travail|repose|pupitre|lame/i.test(p.label)) return 1;
  return 0;
}

/** Longueur développée d'un côté : cotes extérieures moins la déduction de chaque pli, plus les ourlets. */
function developed(outer: number, bends: number, hems: number, T: number, K: number): number {
  const R = T; // rayon intérieur = épaisseur (outillage standard)
  const BA = (Math.PI / 2) * (R + K * T);
  const BD = 2 * (R + T) - BA;
  const hem = Math.max(8, 4 * T); // longueur d'ourlet rabattu
  return outer - bends * BD + hems * (hem - 0.5 * T);
}

export function sheetParts(spec: PartSpec): SheetPart[] {
  if (!spec.product) return [];
  const T = spec.thickness;
  const K = MATERIALS[spec.material].kFactor;
  return productModel(spec.product, spec.thickness).panels.flatMap((p) => {
    if (!p.sheet) return [];
    const [a, b] = [...p.size].sort((x, y) => y - x);
    const r = p.sheet.returns;
    const hems = hemsOf(p);
    // Plis répartis : 1-2 sur la grande dimension, 3-4 sur les deux ; idem pour les contre-plis.
    const na = Math.min(2, p.sheet.bends);
    const nb = Math.max(0, p.sheet.bends - 2);
    const ha = Math.min(2, hems);
    const hb = Math.max(0, hems - 2);
    const ea = developed(a + na * r, na, ha, T, K);
    const eb = developed(b + nb * r, nb, hb, T, K);
    // Découpe : contour + chaque trou (π·Ø) + chaque ouverture (périmètre) ; un amorçage par trou ou ouverture.
    const holeCut = (p.holes ?? []).reduce((t, h) => t + Math.PI * h[2], 0) + (p.cutouts ?? []).reduce((t, c) => t + 2 * (c[2] + c[3]), 0);
    const holeArea = (p.holes ?? []).reduce((t, h) => t + (Math.PI * h[2] * h[2]) / 4, 0) + (p.cutouts ?? []).reduce((t, c) => t + c[2] * c[3], 0);
    const polyArea = p.poly ? Math.abs(p.poly.reduce((t, q, i) => { const n = p.poly![(i + 1) % p.poly!.length]; return t + q[0] * n[1] - n[0] * q[1]; }, 0)) / 2 : 0;
    return [{ id: p.id, label: p.label, a: Math.round(ea), b: Math.round(eb), bends: p.sheet.bends, hems, area: (polyArea || ea * eb) - holeArea, cut: 2 * (ea + eb) + holeCut, pierces: 1 + (p.holes?.length ?? 0) + (p.cutouts?.length ?? 0) }];
  });
}

/** Rappel global au format FlatPattern (masse, surfaces, plis) pour les écrans qui l'attendent. */
export function productFlat(spec: PartSpec): FlatPattern {
  const parts = sheetParts(spec);
  const mat = MATERIALS[spec.material];
  const area = parts.reduce((s, x) => s + x.area, 0);
  const big = parts.reduce((m, x) => (x.area > m.area ? x : m), parts[0] ?? { a: spec.width, b: spec.depth, area: 0 });
  const bends = parts.reduce((s, x) => s + x.bends, 0);
  return {
    outline: [[0, 0], [big.a, 0], [big.a, big.b], [0, big.b]],
    faces: [],
    seams: [],
    holes: [],
    bendLines: Array.from({ length: bends }, () => ({ x1: 0, y1: 0, x2: 0, y2: 0, edge: 'nord' as const, angle: 90, innerRadius: spec.thickness, bendAllowance: 0, bendDeduction: 0 })),
    blankWidth: big.a,
    blankHeight: big.b,
    area,
    cutLength: parts.reduce((s, x) => s + x.cut, 0),
    pierces: parts.reduce((s, x) => s + x.pierces, 0),
    mass: (area * spec.thickness * mat.density) / 1e6,
    notes: parts.map((x) => `${x.label} : ${x.a} × ${x.b} mm, ${x.bends} pli${x.bends > 1 ? 's' : ''}`),
  };
}

const eur = (v: number) => Math.round(v * 100) / 100;
const fr = (v: number, d = 1) => v.toLocaleString('fr-FR', { maximumFractionDigits: d });
/** Assemblage (soudure, rivetage, montage des portes) : taux horaire atelier. */
const ASSEMBLY_RATE_PER_HOUR = 58;
/** Quincaillerie par mouvement : charnières + fermeture, coulisses, vérin. */
const HARDWARE_PER_MOTION: Record<Motion['type'], number> = { hinge: 16, slide: 24, fold: 35 };

function laserSpeed(t: number): number {
  const table = LASER_SPEED_STEEL;
  for (let i = 1; i < table.length; i++) if (t <= table[i][0]) {
    const [t0, v0] = table[i - 1];
    const [t1, v1] = table[i];
    return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
  }
  return table[table.length - 1][1];
}

function productLot(spec: PartSpec, qty: number): PriceLine[] {
  const p = spec.product!;
  const model = productModel(p, spec.thickness);
  const parts = sheetParts(spec);
  const mat = MATERIALS[spec.material];
  const fin = FINISHES[spec.finish];
  const area = parts.reduce((s, x) => s + x.area, 0);
  const mass = (area * spec.thickness * mat.density) / 1e6;
  const bends = parts.reduce((s, x) => s + x.bends, 0);
  const hems = parts.reduce((s, x) => s + x.hems, 0);
  const cut = parts.reduce((s, x) => s + x.cut, 0);
  let coef = 1;
  for (const s of SERIES_COEFFICIENTS) if (qty >= s.minQty) coef = s.coef;
  const laserH = (cut / (laserSpeed(spec.thickness) / mat.cutFactor) + (parts.reduce((t, x) => t + x.pierces, 0) * PIERCE_TIME_BASE_S) / 60) / 60;
  const assemblyH = 1.5 + parts.length * 0.12 + model.motions.filter((m) => !m.auto).length * 0.2;
  const hw = model.motions.filter((m) => !m.auto).reduce((s, m) => s + HARDWARE_PER_MOTION[m.type], 0);
  const lines: PriceLine[] = [
    { id: 'matiere', label: 'Matière', detail: `${mat.label}, ép. ${fr(spec.thickness)} mm · ${fr(mass)} kg par ${PRODUCTS[p.kind].label.toLowerCase()} (${parts.length} tôles)`, amount: eur(mass * qty * mat.pricePerKg * (1 + TECHNICAL_SCRAP_RATE)) },
    { id: 'cao', label: 'Programmation FAO', detail: `Programmes laser et plieuse des ${parts.length} tôles`, amount: eur((1.5 + parts.length * 0.06) * CAD_RATE_PER_HOUR) },
    { id: 'laser', label: 'Découpe laser', detail: `${fr(cut / 1000)} m de coupe par ensemble`, amount: eur(laserH * qty * LASER_RATE_PER_HOUR * coef) },
    // Un contre-pli = deux coups de presse (pli aigu puis écrasement).
    { id: 'pliage', label: 'Pliage', detail: `${bends} plis${hems ? ` et ${hems} contre-plis` : ''} par ensemble`, amount: eur(((BEND_SETUP_MIN * (hems ? 4 : 3)) / 60 + ((bends + 2 * hems) * qty * BEND_TIME_S) / 3600) * PRESS_BRAKE_RATE_PER_HOUR) },
    { id: 'assemblage', label: 'Assemblage et soudure', detail: `${fr(assemblyH)} h par ensemble : soudure, rivetage, montage`, amount: eur(assemblyH * qty * ASSEMBLY_RATE_PER_HOUR * coef) },
  ];
  if (hw) lines.push({ id: 'quincaillerie', label: 'Quincaillerie', detail: 'Charnières, fermetures, coulisses (électronique non comprise)', amount: eur(hw * qty) });
  lines.push({ id: 'finition', label: 'Finition', detail: `${fin.label}${spec.ral ? ` RAL ${spec.ral}` : ''} · ${fr((area * 2) / 1e6)} m² par ensemble`, amount: eur(fin.setup + ((area * 2) / 1e6) * fin.pricePerM2 * qty) });
  lines.push({ id: 'controle', label: 'Contrôle et essais', detail: 'Contrôle dimensionnel, essai des ouvrants', amount: eur(QC_SETUP + (QC_PER_PART * 20 + 15) * qty) });
  return lines;
}

/** Devis d'un produit assemblé, même forme que celui d'une pièce simple. */
export function productQuote(spec: PartSpec, quantity?: number, delivery?: Delivery): Quote {
  const qty = Math.max(1, Math.round(quantity ?? spec.quantity));
  const flat = productFlat(spec);
  const mass = flat.mass;
  const cad = cadLines(spec, flat);
  const lot = (q: number) => {
    const lines = [...productLot(spec, q), ...cad, deliveryLine(mass, q, delivery)];
    return { lines, subtotal: eur(lines.reduce((s, l) => s + l.amount, 0)) };
  };
  const { lines, subtotal } = lot(qty);
  const vat = eur(subtotal * VAT_RATE);
  return {
    quantity: qty,
    lines,
    subtotal,
    vat,
    total: eur(subtotal + vat),
    unitPrice: eur(subtotal / qty),
    tiers: TIER_QUANTITIES.map((q) => {
      const total = q === qty ? subtotal : lot(q).subtotal;
      return { quantity: q, unitPrice: eur(total / q), total };
    }),
    leadTimeDays: Math.min(25, 12 + LEAD_TIME_FINISH_DAYS[spec.finish] + (qty > 5 ? 3 : 0)),
  };
}

/** Nomenclature des tôles d'un produit, pour l'atelier (CSV, séparateur « ; »). */
export function nomenclatureCsv(spec: PartSpec): string {
  const rows = [['Repère', 'Désignation', 'Développé (mm)', 'Plis', 'Contre-plis', 'Trous / amorçages', 'Matière', 'Épaisseur (mm)']];
  for (const x of sheetParts(spec)) rows.push([x.id, x.label, `${x.a} x ${x.b}`, String(x.bends), String(x.hems), String(x.pierces - 1), MATERIALS[spec.material].label, String(spec.thickness)]);
  return '﻿' + rows.map((r) => r.join(';')).join('\n');
}

/** Résumé court, ex. « Locker à casiers 1600 × 1900 × 550 mm, 4 colonnes × 5 casiers, borne écran ». */
export function productSummary(p: ProductSpec): string {
  const d = PRODUCTS[p.kind];
  const parts = [`${d.label} ${fr(p.width)} × ${fr(p.height)} × ${fr(p.depth)} mm (L × H × P)`];
  for (const prm of d.params) {
    if (prm.if && !on(p, prm.if)) continue;
    const v = p.options[prm.key];
    if (prm.type === 'choice') parts.push(`${prm.label.toLowerCase()} : ${prm.choices?.find((c) => c.value === v)?.label.toLowerCase() ?? v}`);
    else if (prm.type === 'bool') { if (v) parts.push(prm.label.toLowerCase()); }
    else if (v) parts.push(`${prm.label.toLowerCase()} : ${fr(Number(v))}${prm.unit ? ` ${prm.unit}` : ''}`);
  }
  return parts.join(', ');
}

/** Lignes du récapitulatif (carte du chat) propres au produit. */
export function productRecap(p: ProductSpec): { label: string; value: string }[] {
  const d = PRODUCTS[p.kind];
  const out = [{ label: 'Produit', value: p.custom?.label ?? d.label }, { label: 'Encombrement', value: `${fr(p.width)} × ${fr(p.height)} × ${fr(p.depth)} mm (L × H × P)` }];
  const opts: string[] = [];
  for (const prm of d.params) {
    if (prm.if && !on(p, prm.if)) continue;
    const v = p.options[prm.key];
    if (prm.type === 'choice') opts.push(`${prm.label} : ${prm.choices?.find((c) => c.value === v)?.label ?? v}`);
    else if (prm.type === 'bool') { if (v) opts.push(prm.label); }
    else opts.push(`${prm.label} ${fr(Number(v))}${prm.unit ? ` ${prm.unit}` : ''}`);
  }
  if (opts.length) out.push({ label: 'Équipement', value: opts.join(' · ') });
  return out;
}

// --- Compréhension du texte -----------------------------------------------------------------------

// Ordre important : du plus précis au plus général (« distributeur automatique de pharmacie » avant « distributeur »).
const KIND_RE: [ProductKind, RegExp][] = [
  ['fauteuil', /\b(fauteuils?|chaises? longues?|transats?|bains? de soleil|meridiennes?|chaises? (origami|en tole|pliees?)|lounge)\b/],
  ['gel', /\b(distributeurs? de (gel|savon|desinfectant)|gel hydro[- ]?alcoolique|bornes? de gel|totems? de gel)\b/],
  ['borneSonore', /\b(bornes? sonores?|bornes? audio|totems? sonores?|bornes? (d'ecoute|musicales?))\b/],
  ['tri', /\b(meubles? de tri|casiers? de tri|tri (du|de) courrier|cases? de tri|trieurs? (de|a) courrier)\b/],
  ['caveVin', /\b(caves? a vins?|casiers? a (bouteilles?|vins?)|range[- ]bouteilles?|porte[- ]bouteilles?)\b/],
  ['banque', /\b(banques? d'accueil|banques? accueil|comptoirs? d'accueil|bureaux? d'accueil|accueil de (cabinet|clinique|magasin))\b/],
  ['bar', /\b(bars? (d'hotel|de restaurant|chr|en metal)|comptoirs? (de bar|chr)|bar)\b/],
  ['meubleTiroirs', /\b(meubles? (a|de) (tiroirs|rangement)|caissons? a tiroirs|blocs? (a )?tiroirs|commodes?|chiffonniers?)\b/],
  ['vitrine', /\b(vitrines?|presentoirs? vitres?)\b/],
  ['salleAttente', /\b(salles? d'attente|sieges? (de salle d'attente|d'attente)|fauteuils? (de salle d'attente|d'attente)|banquettes?|chaises? (d'attente|de salle d'attente))\b/],
  ['bacFleurs', /\b(bacs? a (fleurs|plantes)|jardinieres?|pots? de fleurs?)\b/],
  ['pergola', /\b(pergolas?( bioclimatiques?)?|carports?|abris? de terrasse)\b/],
  ['porte', /\b(portes? (exterieures?|d'entree|metalliques?|de service|techniques?)|portails?)\b/],
  ['lampe', /\b(lampes?|luminaires?|suspensions? (en metal|perforees?))\b/],
  ['supportMenu', /\b(supports? (de )?menus?|porte[- ]menus?|lutrins?)\b/],
  ['chariot', /\b(chariots?|dessertes?|structures? (en )?tubes?( sur roulettes)?|structures? tubulaires?|structures? sur roulettes)\b/],
  ['grille', /\b(grilles? (d'aeration|de ventilation|de soufflage)|persiennes?|ventelles?)\b/],
  ['tremie', /\b(tremies?|bacs? etanches?|silos?|entonnoirs?)\b/],
  ['marche', /\b(marches? (d'escalier|anti[- ]?derapantes?|metalliques?)|escaliers?( metalliques?)?|caillebotis)\b/],
  ['tolePerforee', /\b(toles? perforees?|metal deploye|toles? (decoratives?|ajourees?))\b/],
  ['cassette', /\b(cassettes?( de facade)?|bardages?|habillages? de (facade|piano)|panneaux? de facade)\b/],
  ['etagere', /\b(etageres?( modulables?)?|rayonnages?|bibliotheques?)\b/],
  ['table', /\b(tables? basses?|tables?|pieds? de table)\b/],
  ['photomaton', /\b(photomatons?|cabines? (photo|de photo)|photo ?booth)\b/],
  ['pharmacie', /\b(automates? (de )?pharmacie|distributeurs? (de medicaments|automatiques? de pharmacie|pharmacie)|robots? de pharmacie|pharmacie automatique|borne de retrait (de )?medicaments?|pharmacie)\b/],
  ['distributeur', /\b(distributeurs? (automatiques?|de boissons?|de snacks?|de friandises|de cafe|de confiseries|de sandwichs?)|vending( machines?)?|machines? (a cafe|a snacks?|a boissons?|de vente))\b/],
  ['recharge', /\b(bornes? de (recharge|charge)|bornes? (electriques?|irve|ve)|wallbox|chargeurs? (de |pour )?(vehicules?|voitures?)|recharge (de |pour )?(vehicules?|voitures?))\b/],
  ['horodateur', /\b(horodateurs?|parcmetres?|bornes? de (paiement|stationnement|parking)|caisses? automatiques?( de parking)?)\b/],
  ['kiosque', /\b(bornes? (interactives?|tactiles?|de commande|d'accueil|d'information|de prise de commande|de check[- ]?in|libre[- ]service)|kiosques?( interactifs?)?|totems? (interactifs?|tactiles?|digitaux|numeriques?))\b/],
  ['cabine', /\b(cabines? (telephoniques?|acoustiques?|de telephone|insonorisees?|d'appel|de visio|de bureau)|phone ?box(es)?|cabines? telephone)\b/],
  ['boites', /\b(boites? (aux|a) lettres|blocs? de boites|ensembles? de boites|boites? postales?)\b/],
  ['baie', /\b(baies? (serveurs?|informatiques?|reseaux?|de brassage|19( pouces)?)|racks?( 19( pouces)?)?( serveurs?)?|armoires? (serveurs?|informatiques?|reseaux?|de brassage))\b/],
  ['locker', /\b(lockers?|casiers? (electroniques?|connectes?|a colis|consigne)|consignes?( automatiques?)?|armoires? a casiers|vestiaires?|casiers?)\b/],
  ['armoire', /\b(armoires? electriques?|armoires? (de commande|electrique|technique)|coffrets? electriques?|baies? electriques?|tableaux? electriques?)\b/],
  ['carter', /\b(carters?( de (machines?|protection))?|capotages?( de machines?)?|habillages? (de|pour) (machines?|robots?)|enceintes? de (machine|protection|robot)|cellules? robotisees?|cabines? de protection)\b/],
];

const WORDS: Record<string, number> = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10 };
const toN = (s: string) => WORDS[s] ?? parseFloat(s);
const NUM = '(\\d+(?:\\.\\d+)?|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)';

export interface ProductAnalysis {
  /** Le texte parle d'un produit (nouveau ou celui en cours). */
  matched: boolean;
  product?: ProductSpec;
  understood: string[];
  /** Texte restant, pour l'analyse classique (matière, épaisseur, finition, quantité). */
  rest: string;
  /** Couleur demandée pour toute la pièce (RAL). */
  ral?: string;
  /** Famille nommée dans le texte (même si c'est celle en cours). */
  named?: ProductKind;
  /** Nouveau produit : matière / finition de départ suggérées. */
  start?: ProductDef['start'];
}

/** Lit un texte déjà normalisé (minuscules, sans accents, « x » entre les cotes). */
/** Le mot trouvé en `index` est-il nié (« pas », « plus de », « sans », « enlève »…) dans le même membre de phrase ? */
function negated(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 40), index);
  return /\b(pas|plus|sans|ni|aucune?|non|enleve[rz]?|retire[rz]?|supprime[rz]?|oublie[rz]?)\b[^,.;!?]*$/.test(before) && !/\bmais\b[^,.;!?]*$/.test(before);
}

/** Couleurs courantes → RAL (thermolaquage). */
const COLORS: [string, string][] = [
  ['gris anthracite', '7016'], ['anthracite', '7016'], ['gris clair', '7035'], ['gris fonce', '7016'], ['gris', '7035'],
  ['bleu marine', '5010'], ['bleu fonce', '5002'], ['bleu ciel', '5015'], ['bleu', '5015'], ['vert fonce', '6005'], ['vert sapin', '6005'], ['vert', '6029'],
  ['rouge', '3020'], ['bordeaux', '3004'], ['orange', '2004'], ['jaune', '1023'], ['violet', '4005'], ['marron', '8017'], ['beige', '1015'],
  ['blanc casse', '9010'], ['blanc', '9016'], ['noir', '9005'], ['argent', '9006'], ['alu', '9006'],
];
const COLOR_RE = COLORS.map(([n]) => `${n}s?|${n}es?`).join('|');
/** Code RAL d'un nom de couleur ou d'un « RAL 3020 ». */
export function colorCode(t: string): string | undefined {
  const s = norm(t).trim();
  const ral = /ral\s*(\d{4})/.exec(s);
  if (ral) return ral[1];
  return COLORS.find(([n]) => s === n || s === `${n}s` || s === `${n}e` || s === `${n}es`)?.[1];
}
/** Couleur demandée dans un message (« en rouge », « couleur bleu marine ») ; le RAL explicite est lu ailleurs. */
export function colorInText(t: string): string | undefined {
  const m = new RegExp(`\\b(?:en|couleur|peinte?s?(?: en)?|thermolaquee?s? en)\\s+(${COLOR_RE})\\b`).exec(norm(t));
  return m ? colorCode(m[1]) : undefined;
}

/** Panneaux désignés par un mot du texte qui précède (« rideau », « porte », « toit »…) ; le dernier mot cité l'emporte. */
export function panelsNamed(m: ProductModel, text: string): { ids: string[]; word: string } {
  const t = norm(text);
  let best: { i: number; w: string } | null = null;
  for (const x of m.panels) for (const w of norm(x.label).split(/[^a-z]+/).filter((w) => w.length >= 4 && !STOP.has(w) && !/composant|droit|gauche|avant|arriere/.test(w))) {
    const i = t.lastIndexOf(w);
    if (i >= 0 && (!best || i > best.i)) best = { i, w };
  }
  if (!best) return { ids: [], word: '' };
  return { ids: m.panels.filter((x) => (x.look === 'tole' || x.look === 'rideau') && norm(x.label).includes(best!.w)).map((x) => x.id), word: best.w };
}

const STOP = new Set(['avec', 'sans', 'pour', 'des', 'les', 'une', 'par', 'sur', 'sous', 'plus', 'partie', 'type', 'zone', 'mm', 'du', 'de', 'la', 'le', 'en', 'et', 'ou', 'a', 'd']);
const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’`]/g, "'");
/** Mots-clés d'un réglage tirés de son libellé (« Bandeau LED » → bandeaux?|leds?). */
const paramWords = (label: string) =>
  [...new Set(norm(label).split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)).map((w) => `${w.replace(/s$/, '')}s?`))].join('|');

export function analyzeProduct(spec: PartSpec, s: string): ProductAnalysis {
  let rest = s;
  const understood: string[] = [];
  let kind: ProductKind | undefined;
  // Famille citée : on ignore celle qui est niée (« pas un locker en coin mais… ») et un mot qui n'est qu'un réglage
  // du produit en cours (« 6 étagères » sur un automate de pharmacie ne crée pas une étagère).
  const ownWords = spec.product ? PRODUCTS[spec.product.kind].params.flatMap((x) => [norm(x.label), ...(x.choices ?? []).map((c) => norm(c.label))]).join(' | ') : '';
  const found: { k: ProductKind; i: number; neg: boolean }[] = [];
  for (const [k, re] of KIND_RE) {
    const m = new RegExp(re.source, 'g');
    for (const x of rest.matchAll(m)) {
      if (k !== spec.product?.kind && ownWords && ownWords.includes(x[0].trim())) continue;
      found.push({ k, i: x.index ?? 0, neg: negated(rest, x.index ?? 0) });
    }
  }
  const pick = found.filter((f) => !f.neg).sort((a, b) => b.i - a.i)[0] ?? (found.length && spec.product ? found.find((f) => f.k === spec.product!.kind && !f.neg) : undefined);
  if (pick) kind = pick.k;
  for (const f of found) rest = rest.replace(new RegExp(KIND_RE.find(([k]) => k === f.k)![1].source), ' ');
  const fresh = kind && kind !== spec.product?.kind;
  let p: ProductSpec | undefined = fresh ? newProduct(kind!) : spec.product ? { ...spec.product, options: { ...spec.product.options } } : undefined;
  if (!p) return { matched: false, understood, rest, named: kind };
  if (fresh) understood.push(PRODUCTS[p.kind].label.toLowerCase());
  // Chaise longue : encombrement d'un transat, sauf cotes données.
  if (fresh && p.kind === 'fauteuil' && /\b(allonge|longue|transat|bain de soleil|meridienne)/.test(rest + s)) { p.options.allonge = true; p.width = 650; p.height = 850; p.depth = 1800; }
  const def = PRODUCTS[p.kind];
  const before = JSON.stringify(p);
  const take = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
    const m = re.exec(rest);
    if (!m) return false;
    fn(m);
    rest = rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length);
    return true;
  };
  const clamp = (v: number, [a, b]: [number, number]) => Math.min(b, Math.max(a, v));
  const mm = (v: string, unit?: string) => parseFloat(v) * (unit === 'm' ? 1000 : unit === 'cm' ? 10 : 1);
  // L × H × P (ou L × H).
  take(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)(?:\s*x\s*(\d+(?:\.\d+)?))?\s*(mm|cm|m)?\b/, (m) => {
    p!.width = clamp(mm(m[1], m[4]), def.limits.width);
    p!.height = clamp(mm(m[2], m[4]), def.limits.height);
    if (m[3]) p!.depth = clamp(mm(m[3], m[4]), def.limits.depth);
    understood.push(`${fr(p!.width)} × ${fr(p!.height)}${m[3] ? ` × ${fr(p!.depth)}` : ''} mm`);
  });
  const dim = (word: string, key: 'width' | 'height' | 'depth', label: string) =>
    take(new RegExp(`\\b${word}\\s*(?:de|a|:)?\\s*(\\d+(?:\\.\\d+)?)\\s*(mm|cm|m)?\\b`), (m) => {
      p![key] = clamp(mm(m[1], m[2]), def.limits[key]);
      understood.push(`${label} ${fr(p![key])} mm`);
    });
  dim('(?:largeur|large|longueur|long)', 'width', 'largeur');
  dim('(?:hauteur|haut|h)', 'height', 'hauteur');
  dim('(?:profondeur|profond|prof|p)', 'depth', 'profondeur');
  const touched = new Set<string>();
  let wholeRal: string | undefined;
  const set = (key: string, v: number | boolean | string, text: string) => {
    const prm = def.params.find((x) => x.key === key);
    if (!prm) return;
    touched.add(key);
    p!.options[key] = typeof v === 'number' ? Math.min(prm.max ?? v, Math.max(prm.min ?? v, Math.round(v))) : v;
    understood.push(text);
  };
  // Booléens : « avec / sans X ».
  const flag = (re: string, key: string, label: string) => {
    take(new RegExp(`\\bsans\\s+(?:l[ae']\\s*|d[eu']\\s*)?(?:${re})`), () => set(key, false, `sans ${label}`));
    take(new RegExp(`\\b(?:avec\\s+(?:une?\\s+|l[ae']\\s*|d[eu']\\s*)?)?(?:${re})`), (m) => {
      const off = negated(rest, m.index);
      set(key, !off, `${off ? 'sans' : 'avec'} ${label}`);
    });
  };
  // Réglages à choix (siège, mur, place) : la formulation la plus précise d'abord (« tabouret rond » avant « tabouret »).
  for (const prm of def.params) {
    if (prm.type !== 'choice' || touched.has(prm.key)) continue;
    // La correspondance la plus longue gagne (« tabouret rond » plutôt que « tabouret »). Sans retirer le texte :
    // « banquette collée à droite » sert au type de siège ET à sa place.
    let best: { c: NonNullable<ParamDef['choices']>[number]; len: number } | null = null;
    for (const c of prm.choices!) {
      const m = new RegExp(`\\b(?:${c.words})`).exec(rest);
      if (m && (!best || m[0].length > best.len)) best = { c, len: m[0].length };
    }
    if (best) set(prm.key, best.c.value, `${prm.label.toLowerCase()} : ${best.c.label.toLowerCase()}`);
  }
  // Couleurs : « le rideau en bleu », « porte RAL 3020 » → ce panneau ; « en rouge » seul → toute la pièce.
  const model = productModel(p, 1.5);
  const colorRe = new RegExp(`(?:\\b(?:en|couleur|peinte?s?(?: en)?)\\s+)?\\b(ral\\s*\\d{4}|${COLOR_RE})\\b`, 'g');
  const colorHits = [...rest.matchAll(colorRe)];
  for (const m of colorHits) {
    const ral = colorCode(m[1]);
    if (!ral) continue;
    const before = rest.slice(Math.max(0, (m.index ?? 0) - 40), m.index);
    const { ids, word } = panelsNamed(model, before);
    if (ids.length) {
      p.colors = { ...(p.colors ?? {}), ...Object.fromEntries(ids.map((id) => [id, ral])) };
      understood.push(`${word} en RAL ${ral}`);
    } else wholeRal = ral;
  }
  // Les mots de couleur sont lus : ils ne doivent pas être pris pour une matière (« noir » ≠ acier noir).
  if (colorHits.length) rest = rest.replace(colorRe, ' ');
  if (p.kind === 'armoire') {
    take(new RegExp(`\\b${NUM}\\s+portes?\\b`), (m) => set('portes', toN(m[1]), `${toN(m[1])} porte${toN(m[1]) > 1 ? 's' : ''}`));
    take(/\bsocle\s*(?:de)?\s*(\d+)\s*(mm|cm)?/, (m) => set('socle', mm(m[1], m[2]), `socle ${fr(mm(m[1], m[2]))} mm`));
    take(/\bsans socle\b/, () => set('socle', 0, 'sans socle'));
    take(new RegExp(`\\b${NUM}\\s+rails?( din)?\\b`), (m) => set('rails', toN(m[1]), `${toN(m[1])} rails DIN`));
    flag('ventilation|ventilateur|aeration', 'ventilation', 'ventilation');
    flag('plaque de montage|plaque de fond', 'plaque', 'plaque de montage');
    flag('passe[- ]cables?|presse[- ]etoupes?', 'passeCables', 'plaque passe-câbles');
  }
  if (p.kind === 'locker') {
    // Le retour d'abord : « retour de 2 colonnes » ne doit pas changer les colonnes principales.
    take(new RegExp(`\\bretour (?:de |a )?${NUM}\\s*colonnes?\\b`), (m) => { set('angle', true, 'en angle'); set('colonnesRetour', toN(m[1]), `retour de ${toN(m[1])} colonnes`); });
    take(new RegExp(`\\b${NUM}\\s*x\\s*${NUM}\\s+casiers?\\b`), (m) => {
      set('colonnes', toN(m[1]), `${toN(m[1])} colonnes`);
      set('rangees', toN(m[2]), `${toN(m[2])} casiers par colonne`);
    });
    take(new RegExp(`\\b${NUM}\\s+colonnes?\\b`), (m) => set('colonnes', toN(m[1]), `${toN(m[1])} colonnes`));
    take(new RegExp(`\\b${NUM}\\s+(?:rangees?|niveaux?|etages?|casiers? par colonne|lignes?)\\b`), (m) => set('rangees', toN(m[1]), `${toN(m[1])} casiers par colonne`));
    take(new RegExp(`\\b${NUM}\\s+casiers?\\b`), (m) => {
      const total = toN(m[1]);
      const rows = Number(p!.options.rangees) || 5;
      set('colonnes', Math.ceil(total / rows), `${total} casiers (${Math.ceil(total / rows)} colonnes de ${rows})`);
    });
    take(/\b(?:en ligne|droit|lineaire|sans angle|sans retour|de face|en facade|face a face|juste de face|simple face)\b/, () => set('angle', false, 'en ligne, de face'));
    take(/\b(?:en |d'|dans un |dans l')(?:coin|angle)\b|\ben l\b|\bd'angle\b/, (m) => { if (!touched.has('angle')) set('angle', !negated(rest, m.index), negated(rest, m.index) ? 'en ligne, de face' : 'en angle'); });
    flag('ecran|borne|ecran tactile', 'ecran', 'borne écran');
    take(/\bsocle\s*(?:de)?\s*(\d+)\s*(mm|cm)?/, (m) => set('socle', mm(m[1], m[2]), `socle ${fr(mm(m[1], m[2]))} mm`));
  }
  if (p.kind === 'photomaton') {
    flag('rideau', 'rideau', 'rideau');
    flag('tabouret|siege|assise', 'tabouret', 'tabouret');
    flag('ecran', 'ecran', 'écran');
    flag('imprimante|impression|sortie photos?', 'imprimante', 'imprimante');
    flag('enseigne|eclairage|lumiere', 'enseigne', 'enseigne lumineuse');
  }
  if (p.kind === 'fauteuil') {
    take(/\b(allonges?|longues?|transats?|bains? de soleil|meridiennes?|couche)\b/, () => { set('allonge', true, 'chaise longue'); if (p!.depth < 1500) p!.depth = 1800; });
    take(/\b(assis|droit|classique|pas allonges?)\b/, () => set('allonge', false, 'fauteuil assis'));
  }
  if (p.kind === 'cabine') {
    flag('vitree|vitrage|porte vitree|vitres?', 'vitree', 'porte et côtés vitrés');
    flag('tablette', 'tablette', 'tablette');
    flag('assise|siege|banc|tabouret', 'assise', 'assise');
    flag('telephone|combine|visio|poste', 'telephone', 'poste téléphonique');
    flag('ventilation|aeration|ventilateur', 'ventilation', 'ventilation');
    flag('eclairage|lumiere|enseigne', 'eclairage', 'éclairage');
  }
  if (p.kind === 'kiosque') {
    take(/\b(\d+)\s*(?:pouces|"|po)\b/, (m) => set('pouces', Number(m[1]), `écran ${m[1]} pouces`));
    flag('imprimante|tickets?', 'imprimante', 'imprimante');
    flag('lecteur (de )?(carte|cb)|tpe|paiement', 'lecteurCarte', 'lecteur de carte');
    flag('scanner|qr|badge', 'scanner', 'lecteur QR / badge');
    flag('maintenance|porte arriere', 'maintenance', 'porte de maintenance');
  }
  if (p.kind === 'distributeur') {
    take(new RegExp(`\\b${NUM}\\s+(?:plateaux|etages?|niveaux?|rangees?)\\b`), (m) => set('etages', toN(m[1]), `${toN(m[1])} plateaux`));
    take(new RegExp(`\\b${NUM}\\s+(?:selections?|spirales?|produits? par (?:plateau|etage)|colonnes?)\\b`), (m) => set('selections', toN(m[1]), `${toN(m[1])} sélections par plateau`));
    flag('monnayeur|pieces', 'monnayeur', 'monnayeur');
    flag('refrigere|refrigeration|froid|frigo', 'refrigere', 'groupe froid');
  }
  if (p.kind === 'recharge') {
    take(new RegExp(`\\b${NUM}\\s+(?:prises?|points? de charge|connecteurs?)\\b`), (m) => set('prises', toN(m[1]), `${toN(m[1])} point${toN(m[1]) > 1 ? 's' : ''} de charge`));
    flag('ecran', 'ecran', 'écran');
    flag('supports? (de |pour )?cables?|range[- ]cables?', 'supportCable', 'supports de câble');
    flag('maintenance', 'maintenance', 'porte de maintenance');
  }
  if (p.kind === 'boites') {
    take(new RegExp(`\\b${NUM}\\s*x\\s*${NUM}\\s+boites?\\b`), (m) => {
      set('colonnes', toN(m[1]), `${toN(m[1])} colonnes`);
      set('rangees', toN(m[2]), `${toN(m[2])} boîtes par colonne`);
    });
    take(new RegExp(`\\b${NUM}\\s+colonnes?\\b`), (m) => set('colonnes', toN(m[1]), `${toN(m[1])} colonnes`));
    take(new RegExp(`\\b${NUM}\\s+(?:rangees?|niveaux?|etages?|boites? par colonne|lignes?)\\b`), (m) => set('rangees', toN(m[1]), `${toN(m[1])} boîtes par colonne`));
    take(new RegExp(`\\b${NUM}\\s+(?:boites?|logements?|lots?)\\b`), (m) => {
      const total = toN(m[1]);
      const rows = Math.min(total, Number(p!.options.rangees) || 4);
      set('rangees', rows, `${rows} boîtes par colonne`);
      set('colonnes', Math.ceil(total / rows), `${total} boîtes`);
    });
    flag('interphone|visiophone|platine', 'interphone', 'platine d’interphone');
    flag('pied|pieds|sur pied', 'pied', 'pied');
  }
  if (p.kind === 'baie') {
    take(/\b(\d+)\s*u\b/, (m) => {
      p!.height = clamp(Math.round(Number(m[1]) * 44.45 + 150), def.limits.height);
      understood.push(`${m[1]} U (hauteur ${fr(p!.height)} mm)`);
    });
    take(new RegExp(`\\b${NUM}\\s+serveurs?\\b`), (m) => set('serveurs', toN(m[1]), `${toN(m[1])} serveurs`));
    flag('porte (avant )?vitree|vitree|vitre', 'vitree', 'porte avant vitrée');
    flag('porte arriere', 'porteArriere', 'porte arrière');
    flag('ventilation|ventilateurs?', 'ventilation', 'ventilateurs de toit');
  }
  if (p.kind === 'horodateur') {
    flag('ecran', 'ecran', 'écran');
    flag('clavier', 'clavier', 'clavier');
    flag('imprimante|tickets?', 'imprimante', 'imprimante de tickets');
    flag('monnayeur|pieces', 'monnayeur', 'monnayeur');
    flag('(panneau )?solaire', 'solaire', 'panneau solaire');
  }
  if (p.kind === 'carter') {
    take(new RegExp(`\\b${NUM}\\s+portes?\\b`), (m) => set('portes', toN(m[1]), `${toN(m[1])} porte${toN(m[1]) > 1 ? 's' : ''}`));
    flag('hublots?|vitrages?|fenetres?|vitre', 'hublots', 'vitrages de visite');
    flag('pupitre|ihm|ecran de commande', 'pupitre', 'pupitre de commande');
    flag('gyrophare|colonne lumineuse|feu', 'gyrophare', 'colonne lumineuse');
    flag('extraction|ventilation|aspiration', 'ventilation', 'extraction');
  }
  if (p.kind === 'pharmacie') {
    take(new RegExp(`\\b${NUM}\\s+tiroirs?\\b`), (m) => set('tiroirs', toN(m[1]), `${toN(m[1])} tiroirs`));
    take(new RegExp(`\\b${NUM}\\s+etageres?\\b`), (m) => set('etageres', toN(m[1]), `${toN(m[1])} étagères`));
    flag('ecran|ecran tactile', 'ecran', 'écran tactile');
    flag('trappe', 'trappe', 'trappe de délivrance');
    flag('maintenance|porte arriere', 'maintenance', 'porte de maintenance');
    flag('croix', 'croix', 'croix lumineuse');
  }
  // Forme en L / en angle, pour tout produit qui la propose (banque d'accueil…).
  if (def.params.some((x) => x.key === 'angle') && !touched.has('angle')) {
    take(/\b(?:en ligne|droite?|lineaire|sans angle|sans retour|de face|juste de face)\b/, () => set('angle', false, 'droit, sans retour'));
    take(/\ben l\b|\b(?:en |d')(?:angle|coin)\b|\bavec (?:un )?retour\b/, (m) => { if (!touched.has('angle')) set('angle', !negated(rest, m.index), negated(rest, m.index) ? 'droit, sans retour' : 'en L'); });
  }
  // Réglages non lus ci-dessus : mots-clés tirés des libellés (marche pour tous les produits, y compris les nouveaux).
  for (const prm of def.params) {
    if (touched.has(prm.key) || prm.type === 'choice') continue;
    const words = paramWords(prm.label);
    if (!words) continue;
    if (prm.type === 'number') take(new RegExp(`\\b${NUM}\\s+(?:${words})\\b`), (m) => set(prm.key, toN(m[1]), `${prm.label.toLowerCase()} : ${toN(m[1])}`));
    else flag(words, prm.key, prm.label.toLowerCase());
  }
  const changed = fresh || JSON.stringify(p) !== before;
  return { matched: changed || !!wholeRal, product: p, understood: [...new Set(understood)], rest, named: kind, start: fresh ? def.start : undefined, ral: wholeRal };
}
