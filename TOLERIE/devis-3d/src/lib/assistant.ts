// Assistant de devis « à règles » : comprend une description en français, produit un patch
// de PartSpec et pose la question suivante sous forme de bulles.
//
// Interface volontairement simple pour être remplacée plus tard par un vrai LLM :
//   respond(ctx, texte, pièces jointes) -> AssistantTurn { message, patch, missing }
//   answeredBy(ctx, texte, tour)        -> champs à ajouter à ctx.answered après ce tour
//
// Convention « réponse par défaut » : quand le client répond « ok », « c'est bon », « par défaut »…
// sans rien préciser d'autre, le champ demandé par le dernier message assistant (`asks`) est
// considéré comme confirmé. `respond` renvoie alors un patch vide ; c'est l'APPELANT qui ajoute
// les champs retournés par `answeredBy` à `answered` (respond en tient déjà compte pour `missing`).
//
// Valeurs spéciales de bulles : "__preview__" (voir la preview) et "__detail__" (ajouter un détail).
//
// Toutes les fonctions sont pures, à l'exception de crypto.randomUUID() pour les ids.

import type {
  AssistantTurn,
  Attachment,
  ChatMessage,
  Choice,
  Edge,
  FinishId,
  Flange,
  Hole,
  MaterialId,
  MissingField,
  PartSpec,
  ProductKind,
} from './types';
import { analyzeProduct, colorInText, PRODUCTS, productModel, productSummary } from './products';

export interface AssistantContext {
  spec: PartSpec;
  history: ChatMessage[];
  answered: MissingField[];
}

export const FIELD_LABELS: Record<MissingField, string> = {
  shape: 'Forme',
  dimensions: 'Dimensions',
  material: 'Matière',
  thickness: 'Épaisseur',
  flanges: 'Ailes / bords',
  holes: 'Perçages',
  finish: 'Finition',
  quantity: 'Quantité',
};

const FIELD_ORDER: MissingField[] = ['shape', 'dimensions', 'material', 'thickness', 'flanges', 'holes', 'finish', 'quantity'];

// ---- Données en dur (indépendantes du catalogue) -------------------------

type Shape = 'plaque' | 'corniere' | 'u' | 'caisson';

const SHAPE_NAMES: Record<Shape, string> = {
  plaque: 'Plaque',
  corniere: 'Cornière',
  u: 'Profil U',
  caisson: 'Caisson',
};

const SHAPE_EDGES: Record<Shape, Edge[]> = {
  plaque: [],
  corniere: ['nord'],
  u: ['est', 'ouest'],
  caisson: ['nord', 'sud', 'est', 'ouest'],
};

const MATERIAL_LABELS: Record<MaterialId, string> = {
  acier: 'acier S235',
  galva: 'acier galvanisé',
  inox304: 'inox 304',
  inox316: 'inox 316L',
  alu5754: 'aluminium 5754',
};

const THICKNESSES: Record<MaterialId, number[]> = {
  acier: [1, 1.5, 2, 3, 4, 5, 6],
  galva: [1, 1.5, 2, 3],
  inox304: [1, 1.5, 2, 3, 4],
  inox316: [1, 1.5, 2, 3],
  alu5754: [1, 1.5, 2, 3, 4, 5],
};

const FINISH_LABELS: Record<FinishId, string> = {
  brut: 'brut',
  epoxy: 'peinture époxy',
  galvanisation: 'galvanisation à chaud',
  brossage: 'brossé',
  anodisation: 'anodisé',
};

const FINISH_COMPAT: Record<FinishId, MaterialId[]> = {
  brut: ['acier', 'galva', 'inox304', 'inox316', 'alu5754'],
  epoxy: ['acier', 'galva', 'inox304', 'inox316', 'alu5754'],
  galvanisation: ['acier'],
  brossage: ['inox304', 'inox316', 'alu5754'],
  anodisation: ['alu5754'],
};

const DEFAULT_FLANGE_HEIGHT = 40;
const DEFAULT_HOLE_DIAMETER = 10;
const HOLE_MARGIN = 20;

// ---- API publique ---------------------------------------------------------

export function initialSpec(): PartSpec {
  return {
    name: 'Plaque plane',
    material: 'acier',
    thickness: 2,
    width: 200,
    depth: 100,
    flanges: [],
    holes: [],
    finish: 'brut',
    quantity: 1,
  };
}

/** Prénom de la personne qui répond dans le chat (assistant IA présenté comme une conseillère de l'atelier). */
export const ASSISTANT_NAME = 'Camille';

/** Exemples de réalisations proposés par paquets (« Voir plus » charge les suivants). */
export const EXAMPLES_STEP = 6;
export function examplesTurn(from: number): ChatMessage {
  const all = productChoices();
  const slice = all.slice(from, from + EXAMPLES_STEP);
  const more = from + EXAMPLES_STEP < all.length;
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    text: from === 0
      ? 'Voici quelques exemples de ce que nous fabriquons déjà à l’atelier. Touchez-en un, ou décrivez-moi le vôtre.'
      : 'D’autres exemples :',
    choices: [...slice, ...(more ? [{ label: 'Voir plus…', value: `__examples__:${from + EXAMPLES_STEP}` }] : [])],
    allowCustom: true,
    asks: 'shape',
  };
}

export function welcomeMessage(): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    text:
      `Bonjour, je suis ${ASSISTANT_NAME}, de Tôlerie Rémond ! Décrivez-moi votre pièce comme vous le feriez au téléphone ` +
      '(forme, dimensions, matière, épaisseur, perçages, finition, quantité) : la 3D se met à jour au fil de la discussion. ' +
      'Écrivez ou parlez au micro, et joignez si besoin une photo, un croquis ou un fichier DXF/STEP. Pour commencer, quelle forme de pièce vous faut-il ?',
    choices: shapeChoices(),
    allowCustom: true,
    asks: 'shape',
  };
}

export function missingFields(spec: PartSpec, answered: MissingField[]): MissingField[] {
  return FIELD_ORDER.filter((f) => {
    // Produit assemblé : ailes et perçages se règlent panneau par panneau avec le technicien.
    if (spec.product && (f === 'flanges' || f === 'holes')) return false;
    if (f === 'flanges' && spec.flanges.length === 0) return false;
    if (f === 'finish' && spec.finish === 'epoxy' && !spec.ral) return true;
    return !answered.includes(f);
  });
}

export function answeredBy(ctx: AssistantContext, userText: string, _turn?: AssistantTurn): MissingField[] {
  // `_turn` est réservé à une future implémentation LLM qui pourrait y porter ses propres métadonnées.
  const special = userText.trim();
  if (special === '__preview__' || special === '__detail__' || special.startsWith('__examples__')) return [];
  const a = analyzeAll(ctx.spec, userText);
  const fields = [...a.fields];
  if (fields.length === 0 && a.confirm) {
    const asked = lastAsked(ctx.history);
    if (asked) fields.push(asked);
  }
  return uniq(fields);
}

export function respond(ctx: AssistantContext, userText: string, attachments?: Attachment[]): AssistantTurn {
  const text = userText.trim();
  const atts = attachments ?? [];

  if (text === '__preview__') {
    const missing = missingFields(ctx.spec, ctx.answered);
    return turn(
      'Voici la preview de votre pièce avec sa mise à plat et le chiffrage. Le prix reste indicatif : un technicien le vérifiera avant validation. ' +
        "N'hésitez pas à me demander une modification à tout moment.",
      {},
      missing,
    );
  }
  if (text === '__detail__') {
    const missing = missingFields(ctx.spec, ctx.answered);
    return turn(
      'Bien sûr ! Dites-moi ce que vous souhaitez ajouter ou modifier, par exemple « ajoute un trou de 8 au centre », ' +
        '« mets les bords à 50 », « en inox » ou « plus épais ».',
      {},
      missing,
      { allowCustom: true },
    );
  }

  // Exemples de réalisations, par paquets ; ou « un produit / un ensemble » sans préciser lequel.
  const ex = /^__examples__(?::(\d+))?$/.exec(text);
  const vague = !ctx.spec.product && /\b(produit|ensemble|machine|meuble|assemblage|exemples?)s?\b/.test(normalize(text)) && !analyzeProduct(ctx.spec, normalize(text)).matched;
  if (ex || vague) return { message: examplesTurn(ex?.[1] ? Number(ex[1]) : 0), patch: {}, missing: missingFields(ctx.spec, ctx.answered) };

  const a = analyzeAll(ctx.spec, text);
  const asked = lastAsked(ctx.history);
  const confirmedField = a.fields.length === 0 && a.confirm ? asked : undefined;
  const nowAnswered = uniq([...ctx.answered, ...a.fields, ...(confirmedField ? [confirmedField] : [])]);
  const merged: PartSpec = { ...ctx.spec, ...a.patch };
  const missing = missingFields(merged, nowAnswered);

  const parts: string[] = [];
  const hasImage = atts.some((x) => x.kind === 'image' || x.kind === 'pdf');
  const hasCad = atts.some((x) => x.kind === 'cad' || /\.(dxf|dwg|step|stp|iges|igs)$/i.test(x.name));
  if (hasCad) {
    // Fichier CAO joint : la conception devient une simple reprise (prix revu à la baisse).
    a.patch.cad = { ...(ctx.spec.cad ?? {}), ...(a.patch.cad ?? {}), provided: true };
    parts.push(
      `Merci, j'ai bien reçu votre fichier ${namesOf(atts)}. Il sera repris tel quel par notre bureau d'études pour la fabrication ; ` +
        'en attendant, confirmez-moi les cotes principales pour que je puisse afficher une 3D et un prix indicatif.',
    );
  } else if (hasImage) {
    parts.push(
      `J'ai bien reçu votre croquis ${namesOf(atts)}, merci ! Un technicien l'analysera en détail ; ` +
        'en attendant, confirmez-moi les cotes principales pour que je mette la 3D à jour.',
    );
  } else if (atts.length > 0) {
    parts.push(`J'ai bien reçu votre pièce jointe (${atts.map((x) => x.name).join(', ')}) ; un technicien la consultera.`);
  }

  if (a.understood.length > 0) {
    parts.push(`Noté : ${a.understood.join(', ')}.`);
  } else if (confirmedField) {
    parts.push(`Parfait, je garde ${currentValue(merged, confirmedField)}.`);
  } else if (atts.length === 0) {
    // Objet hors catalogue : on le dit franchement, et on propose comment avancer.
    parts.push(
      "Je n'ai pas encore de modèle 3D tout prêt pour cela. Décrivez-le avec ses formes et ses cotes " +
        '(ex. « caisson en inox 400 x 300 x 60, 4 trous de 8 ») ou joignez un croquis : l’atelier le conçoit sur mesure. ' +
        'Avec l’IA générative activée, je le dessine directement à partir de votre description.',
    );
  }
  parts.push(...a.warnings);

  if (missing.length === 0) {
    parts.push(
      `Récapitulatif : ${summary(merged)}. Tout est renseigné ! Le chiffrage affiché est indicatif : il sera vérifié par un technicien, ` +
        "et il peut manquer des informations (tolérances, taraudages, marquage…) que nous verrons ensemble avant la commande.",
    );
    return turn(parts.join(' '), a.patch, missing, {
      choices: [
        { label: 'Voir la preview', value: '__preview__' },
        { label: 'Ajouter un détail', value: '__detail__' },
      ],
      allowCustom: true,
    });
  }

  const next = missing[0];
  const q = question(merged, next);
  parts.push(merged.product ? q.text.replace('la pièce', 'l’ensemble') : q.text);
  return turn(parts.join(' '), a.patch, missing, { choices: q.choices, allowCustom: true, asks: next });
}

// ---- Analyse du texte -------------------------------------------------------

/** Formes de pièce simple : les nommer quitte le produit assemblé en cours. */
const SIMPLE_SHAPE = /\b(?:une?|la|le|des)\s+(?:simples?\s+)?(?:plaques?|cornieres?|equerres?|profils?|caissons?|bacs?|capots?|pieces? simples?)\b(?! a fleurs| etanche| aux lettres)/;

/**
 * Analyse complète : d'abord le produit assemblé (famille, encombrement, options), puis le reste du texte
 * comme pour une pièce simple (matière, épaisseur, finition, quantité).
 */
/** Fichiers CAO : le client les a déjà (simple reprise) ou veut les recevoir (STEP, DXF, plans). */
function analyzeCad(spec: PartSpec, s: string): { cad?: PartSpec['cad']; understood: string[] } {
  const FILES = '(?:plans?|fichiers?|step|stp|dxf|dwg|iges|cao|cad|3d|modeles?|maquettes?)';
  const cad = { ...(spec.cad ?? {}) };
  const understood: string[] = [];
  // « Fichiers fournis » ne se déclare pas : c'est le fichier joint (STEP, DXF…) qui en décide, voir respond / l'import.
  void FILES;
  if (new RegExp(`\\b(?:livr\\w*|recevoir|recuperer|avoir|envoy\\w*|besoin|veux|voudrais|souhaite)\\b.{0,30}\\b(?:fichiers? (?:cao|cad|step|3d|sources?|dxf)|step|plans? (?:pdf|cotes?))\\b|\\bavec (?:les )?fichiers? (?:cao|cad|step|3d)\\b`).test(s)) {
    cad.deliver = true;
    understood.push('fichiers CAO à livrer (STEP, DXF, plans)');
  } else if (/\b(?:sans|pas besoin des?) (?:les )?fichiers? (?:cao|cad|step)\b/.test(s)) cad.deliver = false;
  return understood.length || JSON.stringify(cad) !== JSON.stringify(spec.cad ?? {}) ? { cad, understood } : { understood };
}

function analyzeAll(spec: PartSpec, raw: string): Analysis {
  let a = analyzeShape(spec, raw);
  // Une forme ou un produit nommé remplace le fichier importé.
  if (spec.imported && (a.patch.product || a.fields.includes('shape'))) a = { ...a, patch: { ...a.patch, imported: undefined } };
  const c = analyzeCad(spec, normalize(raw));
  if (!c.cad) return a;
  return { ...a, patch: { ...a.patch, cad: c.cad }, understood: [...a.understood, ...c.understood] };
}

/** Pièce simple décrite par l'IA : forme, base, ailes et perçages, construits comme par le moteur de règles. */
export function simplePatch(spec: PartSpec, s: { shape: Shape | null; width: number | null; depth: number | null; flangeHeight: number | null; flangeAngle: number | null; holeCount: number | null; holeDiameter: number | null }): Partial<PartSpec> {
  const patch: Partial<PartSpec> = { product: undefined, imported: undefined };
  const w = s.width && s.width > 0 ? Math.min(6000, s.width) : spec.width;
  const d = s.depth && s.depth > 0 ? Math.min(6000, s.depth) : spec.depth;
  if (s.width) patch.width = w;
  if (s.depth) patch.depth = d;
  const height = s.flangeHeight && s.flangeHeight > 0 ? Math.min(3000, s.flangeHeight) : undefined;
  const angle = s.flangeAngle && s.flangeAngle > 0 ? Math.min(179, s.flangeAngle) : undefined;
  if (s.shape) {
    patch.name = SHAPE_NAMES[s.shape];
    patch.flanges = SHAPE_EDGES[s.shape].map((edge) => ({ edge, height: height ?? spec.flanges[0]?.height ?? DEFAULT_FLANGE_HEIGHT, angle: angle ?? spec.flanges[0]?.angle ?? 90 }));
  } else if (height || angle) patch.flanges = spec.flanges.map((f) => ({ ...f, height: height ?? f.height, angle: angle ?? f.angle }));
  if (s.holeCount !== null && s.holeCount >= 0) {
    const diam = s.holeDiameter && s.holeDiameter > 0 ? s.holeDiameter : spec.holes[0]?.diameter ?? DEFAULT_HOLE_DIAMETER;
    patch.holes = s.holeCount === 0 ? [] : layoutHoles(Math.min(50, Math.round(s.holeCount)), diam, w, d);
  } else if (s.holeDiameter) patch.holes = spec.holes.map((h) => ({ ...h, diameter: s.holeDiameter! }));
  return patch;
}

function analyzeShape(spec: PartSpec, raw: string): Analysis {
  const s = normalize(raw);
  const pa = analyzeProduct(spec, s);
  const kindNamed = !!pa.named;
  if (spec.product && !kindNamed && SIMPLE_SHAPE.test(s)) {
    // Retour à une pièce simple : le produit est abandonné.
    const a = analyze({ ...spec, product: undefined }, raw);
    return { ...a, patch: { ...a.patch, product: undefined } };
  }
  if (!pa.matched || !pa.product) {
    // Pièce simple : « en rouge », « couleur bleu » → thermolaquage dans ce RAL.
    const a = analyze(spec, raw);
    const ral = !spec.product ? colorInText(raw) : undefined;
    return ral && !a.patch.ral ? { ...a, patch: { ...a.patch, finish: 'epoxy', ral }, fields: [...new Set([...a.fields, 'finish' as const])], understood: [...a.understood, `thermolaqué RAL ${ral}`] } : a;
  }
  const p = pa.product;
  const a = analyze({ ...spec, product: p }, pa.rest);
  const { name: _n, flanges: _f, width: _w, depth: _d, holes: _h, ...kept } = a.patch;
  const patch: Partial<PartSpec> = {
    ...(pa.start ?? {}),
    ...kept,
    ...(pa.ral ? { finish: 'epoxy' as const, ral: pa.ral } : {}),
    product: p,
    name: PRODUCTS[p.kind].label,
    width: p.width,
    depth: p.depth,
    flanges: [],
    holes: [],
    cuts: [],
    fillets: [],
  };
  const fields = new Set<MissingField>(a.fields.filter((f) => f !== 'shape' && f !== 'dimensions' && f !== 'flanges' && f !== 'holes'));
  if (pa.start) fields.add('shape');
  if (pa.understood.some((u) => / mm\b/.test(u))) fields.add('dimensions');
  const warnings = [...a.warnings];
  if (pa.start) {
    const m = productModel(p, patch.thickness ?? spec.thickness);
    // Ne citer que les boutons qui existent pour ce produit (un meuble n'a ni ouvrant ni mise en marche).
    const lively = m.panels.some((x) => x.glow || x.spin) || m.motions.some((x) => x.auto);
    const acts = [...m.mechanisms.map((x) => x.open), ...(lively ? [PRODUCTS[p.kind].activeLabel] : [])].map((x) => `« ${x} »`);
    if (acts.length)
      warnings.push(`Dans la 3D, essayez les boutons à gauche (${acts.join(', ')}) ou touchez directement un ouvrant ; la vue « Coupe » montre l’intérieur.`);
  }
  return { patch, fields: [...fields], understood: [...pa.understood, ...a.understood], warnings, confirm: a.confirm };
}

interface HoleRequest {
  count: number;
  diameter?: number;
  add: boolean;
  center: boolean;
}

interface Analysis {
  patch: Partial<PartSpec>;
  fields: MissingField[];
  understood: string[];
  warnings: string[];
  confirm: boolean;
}

function analyze(spec: PartSpec, raw: string): Analysis {
  let s = normalize(raw);
  const patch: Partial<PartSpec> = {};
  const fields = new Set<MissingField>();
  const warnings: string[] = [];

  /** Applique la regex, appelle fn pour chaque correspondance et efface le texte consommé. */
  // Les groupes non capturés valent undefined à l'exécution ; chaque appelant les teste.
  const take = (re: RegExp, fn: (m: string[]) => boolean | void): boolean => {
    let hit = false;
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    s = s.replace(g, (...args: unknown[]) => {
      const match = args[0] as string;
      // args = [match, p1..pn, offset, input] (pas de groupes nommés)
      const m = args.slice(0, -2) as string[];
      if (fn(m) === false) return match;
      hit = true;
      return ' '.repeat(match.length);
    });
    return hit;
  };

  // --- Finition (avant matière : « galvanisation » contient « galva ») ---
  let ral: string | undefined;
  take(/\bral\s*(\d{4})\b/, (m) => {
    ral = m[1];
  });
  let finish: FinishId | undefined;
  if (take(/\b(galvanisation|galvanise(?:e|es|s)? a chaud|galva a chaud)\b/, () => {})) finish = 'galvanisation';
  if (take(/\b(peinte?s?|peinture|epoxy|thermolaqu\w*|laquee?s?|laquage|poudre)\b/, () => {})) finish = 'epoxy';
  if (take(/\b(brosse(?:e|es|s)?|brossage|satine)\b/, () => {})) finish = 'brossage';
  if (take(/\b(anodis\w*)\b/, () => {})) finish = 'anodisation';
  if (take(/\b(brute?s?|sans finition|aucune finition|sans traitement|non traitee?)\b/, () => {})) finish = 'brut';
  if (ral && !finish) finish = 'epoxy';
  if (finish) {
    patch.finish = finish;
    patch.ral = finish === 'epoxy' ? (ral ?? spec.ral) : undefined;
    if (finish !== 'epoxy' || patch.ral) fields.add('finish');
  }

  // --- Perçages (avant les dimensions) ---
  let holeReq: HoleRequest | 'none' | undefined;
  if (
    take(
      /\b(?:sans|pas de|aucun|(?:enleve|enlever|supprime|supprimer|retire|retirer)(?:z)?\s+(?:tous\s+)?(?:les)?)\s*(?:trous?|percages?)\b/,
      () => {},
    )
  ) {
    holeReq = 'none';
  }
  const isAdd = /\b(ajoute|ajouter|rajoute|rajouter|ajoutez|rajoutez)\b/.test(s);
  take(
    new RegExp(
      `(?:\\b(\\d+|${NUMBER_WORDS_RE})\\s+)?\\b(?:trous?|percages?)\\b(?:\\s+(?:ronds?|traversants?|lisses?))?` +
        `(?:\\s*(?:de|d'un|du|en|diametre|diam\\.?|ø|phi|d)\\s*)*(${NUM})?\\s*(?:mm)?` +
        `(\\s+(?:au|en)\\s+(?:centre|milieu)|\\s+aux\\s+coins)?`,
    ),
    (m) => {
      const count = m[1] ? parseCount(m[1]) : 1;
      const d = m[2] ? toNum(m[2]) : undefined;
      if (count <= 0 || count > 200) return false;
      holeReq = { count, diameter: d, add: isAdd, center: !!m[3] && /centre|milieu/.test(m[3]) };
    },
  );
  if (!holeReq) {
    take(new RegExp(`(?:ø|\\bdiametre\\s*)\\s*(${NUM})`), (m) => {
      holeReq = { count: 1, diameter: toNum(m[1]), add: isAdd, center: false };
    });
  }

  // --- Quantité ---
  let qty: number | undefined;
  take(/\b(\d+)\s*(?:pieces?|pcs?|exemplaires?|unites?|ex)\b/, (m) => {
    qty = parseInt(m[1], 10);
  });
  take(/\b(?:quantite|qte|qty)\s*(?:de|:|=)?\s*(\d+)\b/, (m) => {
    qty = parseInt(m[1], 10);
  });
  take(/\b(?:une seule|1 seule|un seul|une piece|un exemplaire|prototypes?|proto)\b/, () => {
    qty = 1;
  });
  take(/\bune dizaine\b/, () => {
    qty = 10;
  });
  take(/\bune centaine\b/, () => {
    qty = 100;
  });
  take(/\b(\d+)\s*(?:de chaque|en serie)\b/, (m) => {
    qty = parseInt(m[1], 10);
  });

  // --- Angle ---
  let angle: number | undefined;
  take(new RegExp(`(${NUM})\\s*(?:°|deg\\b|degres?\\b)`), (m) => {
    const a = toNum(m[1]);
    if (a <= 0 || a >= 180) return false;
    angle = a;
  });

  // --- Épaisseur ---
  let thickness: number | undefined;
  take(/\b(\d{1,2})\s*\/\s*10(?:e|eme)?\b/, (m) => {
    thickness = parseInt(m[1], 10) / 10;
  });
  take(new RegExp(`\\b(?:ep|epaisseur|epais|epaiss)\\.?\\s*(?:de|=|:)?\\s*(${NUM})\\s*(?:mm)?`), (m) => {
    thickness = toNum(m[1]);
  });
  take(new RegExp(`(${NUM})\\s*(?:mm\\s*(?:d'|de\\s+)?\\s*(?:epaisseur|ep\\b)|(?:d'|de\\s+)\\s*epaisseur)`), (m) => {
    thickness = thickness ?? toNum(m[1]);
  });
  let thicknessStep = 0;
  if (take(/\b(plus epaiss?e?s?|plus solide|plus rigide)\b/, () => {})) thicknessStep = 1;
  if (take(/\b(moins epaiss?e?s?|plus fine?|plus mince|plus leger|plus legere)\b/, () => {})) thicknessStep = -1;

  // --- Matière ---
  let material: MaterialId | undefined;
  if (take(/\b(inox(?:ydable)?|acier inoxydable|316l?|304l?)\b(?!\s*(?:x|par|sur|\*|mm|cm))/, () => {})) {
    material = /\b316/.test(normalize(raw)) ? 'inox316' : 'inox304';
  } else if (take(/\b(galva\w*|zingue\w*|electrozingue\w*)\b/, () => {})) {
    material = 'galva';
  } else if (take(/\b(alu|aluminium|alu 5754|5754)\b/, () => {})) {
    material = 'alu5754';
  } else if (take(/\b(acier|s235|s355|dc01|fer|tole noire|noir)\b/, () => {})) {
    material = 'acier';
  }
  // « acier » résiduel après « acier inoxydable » / « acier galvanisé » : on l'efface.
  take(/\bacier\b/, () => {});

  // --- Forme ---
  let shape: Shape | undefined;
  take(/\b(caissons?|bacs?|boites?|capots?|coffrets?|plateaux?)\b/, () => {
    shape = shape ?? 'caisson';
  });
  take(/\b(goulottes?|profile?s?\s+(?:en\s+)?u|(?:^|\s)(?:en\s+)?u(?=\s|$|[,.;]))/, () => {
    shape = shape ?? 'u';
  });
  take(/\b(cornieres?|equerres?|profile?s?\s+(?:en\s+)?l|(?:^|\s)(?:en\s+)?l(?=\s|$|[,.;]))/, () => {
    shape = shape ?? 'corniere';
  });
  take(/\b(plaques?|platines?|flans?|toles? (?:plane|plate|lisse)s?|sans (?:pli|aile|rebord)s?)\b/, () => {
    shape = shape ?? 'plaque';
  });

  // --- Dimensions ---
  let width: number | undefined;
  let depth: number | undefined;
  let height: number | undefined;
  let third: number | undefined;
  const DIM = `(${NUM})\\s*(mm|cm|m)?\\b`;
  const SEP = `\\s*(?:x|\\*|par|sur)\\s*`;
  take(new RegExp(`${DIM}${SEP}${DIM}(?:${SEP}${DIM})?`), (m) => {
    const unitFallback = m[6] ?? m[4] ?? m[2];
    width = toMm(m[1], m[2] ?? unitFallback);
    depth = toMm(m[3], m[4] ?? m[6] ?? unitFallback);
    if (m[5]) third = toMm(m[5], m[6] ?? unitFallback);
  });
  take(/(?:^|\s)x\s*(\d+)\b/, (m) => {
    qty = parseInt(m[1], 10);
  });
  take(new RegExp(`\\b(?:longueur|long|lg)\\s*(?:de|=|:)?\\s*${DIM}`), (m) => {
    width = toMm(m[1], m[2]);
  });
  take(new RegExp(`${DIM}\\s*de\\s*(?:long|longueur)\\b`), (m) => {
    width = toMm(m[1], m[2]);
  });
  take(new RegExp(`\\b(?:largeur|large|profondeur|prof)\\s*(?:de|=|:)?\\s*${DIM}`), (m) => {
    depth = toMm(m[1], m[2]);
  });
  take(new RegExp(`${DIM}\\s*de\\s*(?:large|largeur|profondeur)\\b`), (m) => {
    depth = toMm(m[1], m[2]);
  });
  take(
    new RegExp(
      `\\b(?:hauteur|haut|ailes?|rebords?|bords?|retours?|plis?)\\b(?:\\s+(?:des?|du|d')?\\s*(?:bords?|ailes?|rebords?|retours?))?` +
        `(?:\\s+(?:nord|sud|est|ouest))?\\s*(?:de|a|=|:)?\\s*${DIM}`,
    ),
    (m) => {
      height = toMm(m[1], m[2]);
    },
  );
  take(new RegExp(`${DIM}\\s*de\\s*(?:haut|hauteur)\\b`), (m) => {
    height = toMm(m[1], m[2]);
  });
  // Reste « 2 mm » isolé : probablement l'épaisseur.
  if (thickness === undefined) {
    take(new RegExp(`(?:\\ben\\s+)?\\b(${NUM})\\s*mm\\b`), (m) => {
      const v = toNum(m[1]);
      if (v > 8) return false;
      thickness = v;
    });
  }

  // --- Confirmation ---
  const confirm =
    /\b(ok|okay|oki|c'est bon|cest bon|c bon|ca me va|ca va|ca marche|je valide|valide|oui|parfait|d'accord|daccord|par defaut|tres bien|nickel|exact|correct|go|garde|garder|on garde)\b/.test(
      normalize(raw),
    );

  // ---- Construction du patch ----
  const finalShape = shape;
  const curHeight = spec.flanges[0]?.height ?? DEFAULT_FLANGE_HEIGHT;
  const curAngle = spec.flanges[0]?.angle ?? 90;

  if (finalShape) {
    fields.add('shape');
    patch.name = SHAPE_NAMES[finalShape];
  }

  // Troisième cote : hauteur des ailes, ou épaisseur pour une plaque.
  const shapeHasFlanges = finalShape ? SHAPE_EDGES[finalShape].length > 0 : spec.flanges.length > 0;
  if (third !== undefined) {
    if (shapeHasFlanges) height = height ?? third;
    else if (third <= 10 && thickness === undefined) thickness = third;
  }

  if (width !== undefined && width > 0) patch.width = width;
  if (depth !== undefined && depth > 0) patch.depth = depth;
  if (width !== undefined || depth !== undefined) fields.add('dimensions');

  let flanges: Flange[] | undefined;
  if (finalShape) {
    flanges = SHAPE_EDGES[finalShape].map((edge) => ({ edge, height: height ?? curHeight, angle: angle ?? curAngle }));
  } else if (height !== undefined || angle !== undefined) {
    if (spec.flanges.length === 0) {
      flanges = [{ edge: 'nord', height: height ?? DEFAULT_FLANGE_HEIGHT, angle: angle ?? 90 }];
      patch.name = SHAPE_NAMES.corniere;
      fields.add('shape');
    } else {
      flanges = spec.flanges.map((f) => ({ ...f, height: height ?? f.height, angle: angle ?? f.angle }));
    }
  }
  if (flanges) patch.flanges = flanges;
  if (height !== undefined || angle !== undefined) fields.add('flanges');

  const mat = material ?? spec.material;
  if (material) {
    patch.material = material;
    fields.add('material');
  }
  if (thicknessStep !== 0) {
    const list = THICKNESSES[mat];
    const base = thickness ?? spec.thickness;
    const next =
      thicknessStep > 0 ? list.find((t) => t > base + 1e-9) : [...list].reverse().find((t) => t < base - 1e-9);
    if (next !== undefined) thickness = next;
    else warnings.push(`${capitalize(MATERIAL_LABELS[mat])} : ${fmt(base)} mm est déjà l'épaisseur ${thicknessStep > 0 ? 'maximale' : 'minimale'} que nous proposons.`);
  }
  if (thickness !== undefined && thickness > 0 && thickness <= 20) {
    patch.thickness = thickness;
    fields.add('thickness');
    if (!THICKNESSES[mat].includes(thickness)) {
      warnings.push(
        `L'épaisseur ${fmt(thickness)} mm n'est pas standard en ${MATERIAL_LABELS[mat]} (standards : ${THICKNESSES[mat].map(fmt).join(' / ')} mm) ; un technicien vérifiera.`,
      );
    }
  } else if (material && !THICKNESSES[material].includes(spec.thickness)) {
    const t = nearest(THICKNESSES[material], spec.thickness);
    patch.thickness = t;
    warnings.push(`J'ai ajusté l'épaisseur à ${fmt(t)} mm, disponible en ${MATERIAL_LABELS[material]}.`);
  }

  if (qty !== undefined && qty > 0) {
    patch.quantity = qty;
    fields.add('quantity');
  }

  // Perçages
  const w = patch.width ?? spec.width;
  const d = patch.depth ?? spec.depth;
  const curDiam = spec.holes[0]?.diameter ?? DEFAULT_HOLE_DIAMETER;
  const req = holeReq as HoleRequest | 'none' | undefined;
  if (req === 'none') {
    patch.holes = [];
    fields.add('holes');
  } else if (req) {
    const diam = req.diameter ?? curDiam;
    if (req.add) {
      const added = req.center || req.count === 1 ? [hole(w / 2, d / 2, diam)] : layoutHoles(req.count, diam, w, d);
      patch.holes = [...spec.holes, ...added];
    } else {
      patch.holes = req.center ? [hole(w / 2, d / 2, diam)] : layoutHoles(req.count, diam, w, d);
    }
    fields.add('holes');
    if (diam >= Math.min(w, d)) warnings.push(`Attention, un perçage Ø${fmt(diam)} est trop grand pour cette pièce ; merci de vérifier.`);
  } else if ((patch.width !== undefined || patch.depth !== undefined) && spec.holes.length > 0) {
    // Les dimensions changent : on replace les perçages existants de façon cohérente.
    patch.holes = layoutHoles(spec.holes.length, curDiam, w, d);
  }

  // Compatibilité finition / matière
  const fin = patch.finish ?? spec.finish;
  if ((patch.finish || patch.material) && !FINISH_COMPAT[fin].includes(mat)) {
    warnings.push(
      `Attention : la finition « ${FINISH_LABELS[fin]} » n'est normalement pas proposée en ${MATERIAL_LABELS[mat]} ; un technicien vous conseillera.`,
    );
  }

  const merged: PartSpec = { ...spec, ...patch };
  return { patch, fields: [...fields], understood: describeUnderstood(merged, fields, patch), warnings, confirm };
}

// ---- Rédaction ---------------------------------------------------------------

function describeUnderstood(spec: PartSpec, fields: Set<MissingField>, patch: Partial<PartSpec>): string[] {
  const out: string[] = [];
  const shapeName = lowerShape(shapeLabel(spec));
  if (fields.has('shape') && fields.has('dimensions')) out.push(`${shapeName} ${fmt(spec.width)} × ${fmt(spec.depth)} mm`);
  else if (fields.has('shape')) out.push(shapeName);
  else if (fields.has('dimensions')) out.push(`dimensions ${fmt(spec.width)} × ${fmt(spec.depth)} mm`);

  if (fields.has('flanges') && spec.flanges.length > 0) {
    const f = spec.flanges[0];
    const word = spec.flanges.length >= 3 ? 'bords' : spec.flanges.length === 2 ? 'ailes' : 'aile';
    const plie = spec.flanges.length >= 3 ? 'pliés' : spec.flanges.length === 2 ? 'pliées' : 'pliée';
    out.push(`${word} de ${fmt(f.height)} mm${f.angle !== 90 ? ` ${plie} à ${fmt(f.angle)}°` : ''}`);
  }

  if (fields.has('material') && fields.has('thickness')) out.push(`${MATERIAL_LABELS[spec.material]} ép. ${fmt(spec.thickness)} mm`);
  else if (fields.has('material')) out.push(MATERIAL_LABELS[spec.material]);
  else if (fields.has('thickness')) out.push(`épaisseur ${fmt(spec.thickness)} mm`);

  if (fields.has('holes')) out.push(describeHoles(spec.holes));
  if (patch.finish !== undefined) out.push(finishLabel(spec));
  if (fields.has('quantity')) out.push(spec.quantity === 1 ? '1 pièce' : `${spec.quantity} pièces`);
  return out;
}

function describeHoles(holes: Hole[]): string {
  if (holes.length === 0) return 'sans perçage';
  const diams = uniq(holes.map((h) => h.diameter));
  const dTxt = diams.map((x) => `Ø${fmt(x)}`).join(' / ');
  return holes.length === 1 ? `1 perçage ${dTxt}` : `${holes.length} perçages ${dTxt}`;
}

function finishLabel(spec: PartSpec): string {
  if (spec.finish === 'epoxy') return spec.ral ? `peinture époxy RAL ${spec.ral}` : 'peinture époxy (RAL à préciser)';
  return spec.finish === 'brut' ? 'finition brute' : FINISH_LABELS[spec.finish];
}

function shapeLabel(spec: PartSpec): string {
  const n = spec.flanges.length;
  if (n === 0) return 'Plaque';
  if (n === 1) return 'Cornière';
  if (n === 2) {
    const e = spec.flanges.map((f) => f.edge).sort().join(',');
    return e === 'est,ouest' || e === 'nord,sud' ? 'Profil U' : 'Pièce pliée';
  }
  return n === 4 ? 'Caisson' : 'Pièce pliée';
}

function summary(spec: PartSpec): string {
  if (spec.product) {
    return [productSummary(spec.product), `${MATERIAL_LABELS[spec.material]} ép. ${fmt(spec.thickness)} mm`, finishLabel(spec), spec.quantity === 1 ? '1 exemplaire' : `${spec.quantity} exemplaires`].join(', ');
  }
  const parts = [`${lowerShape(shapeLabel(spec))} ${fmt(spec.width)} × ${fmt(spec.depth)} mm`];
  if (spec.flanges.length > 0) {
    const f = spec.flanges[0];
    parts.push(`${spec.flanges.length >= 3 ? 'bords' : spec.flanges.length === 2 ? 'ailes' : 'aile'} de ${fmt(f.height)} mm à ${fmt(f.angle)}°`);
  }
  parts.push(`${MATERIAL_LABELS[spec.material]} ép. ${fmt(spec.thickness)} mm`);
  parts.push(describeHoles(spec.holes));
  parts.push(finishLabel(spec));
  parts.push(spec.quantity === 1 ? '1 pièce' : `${spec.quantity} pièces`);
  return parts.join(', ');
}

function currentValue(spec: PartSpec, field: MissingField): string {
  switch (field) {
    case 'shape':
      return spec.product ? PRODUCTS[spec.product.kind].article : `la forme ${lowerShape(shapeLabel(spec))}`;
    case 'dimensions':
      return spec.product
        ? `l'encombrement ${fmt(spec.product.width)} × ${fmt(spec.product.height)} × ${fmt(spec.product.depth)} mm`
        : `les dimensions ${fmt(spec.width)} × ${fmt(spec.depth)} mm`;
    case 'material':
      return `la matière ${MATERIAL_LABELS[spec.material]}`;
    case 'thickness':
      return `l'épaisseur de ${fmt(spec.thickness)} mm`;
    case 'flanges':
      return spec.flanges.length ? `des ailes de ${fmt(spec.flanges[0].height)} mm` : 'une pièce sans pli';
    case 'holes':
      return spec.holes.length ? describeHoles(spec.holes) : 'la pièce sans perçage';
    case 'finish':
      return `la finition : ${finishLabel(spec)}`;
    case 'quantity':
      return spec.quantity === 1 ? 'une seule pièce' : `${spec.quantity} pièces`;
  }
}

/** Revenir sur une information (étape cliquée) : la question correspondante, avec ses réponses rapides. */
export function fieldQuestion(spec: PartSpec, field: MissingField): ChatMessage {
  const q = question(spec, field);
  return { id: crypto.randomUUID(), role: 'assistant', text: `On revient sur « ${FIELD_LABELS[field].toLowerCase()} » (vous aviez ${currentValue(spec, field)}). ${q.text}`, choices: q.choices, allowCustom: true, asks: field };
}

function question(spec: PartSpec, field: MissingField): { text: string; choices: Choice[] } {
  const keep: Choice = { label: 'Garder par défaut', value: 'ok par défaut' };
  switch (field) {
    case 'shape':
      return { text: 'Quelle forme de pièce souhaitez-vous ?', choices: shapeChoices() };
    case 'dimensions':
      if (spec.product) {
        const p = spec.product;
        const d0 = PRODUCTS[p.kind].defaults;
        const sizes = PRODUCT_SIZES[p.kind] ?? [[d0.width, d0.height, d0.depth]];
        return {
          text: `Quel encombrement pour ${PRODUCTS[p.kind].article} (largeur × hauteur × profondeur en mm) ? Actuellement ${fmt(p.width)} × ${fmt(p.height)} × ${fmt(p.depth)} mm.`,
          choices: sizes.map(([w, h, d]) => ({ label: `${w} × ${h} × ${d}`, value: `${w} x ${h} x ${d} mm` })),
        };
      }
      return {
        text: `Quelles sont les dimensions extérieures de la base (longueur × largeur en mm) ? Actuellement ${fmt(spec.width)} × ${fmt(spec.depth)} mm.`,
        choices: [
          { label: '200 × 100 mm', value: 'dimensions 200 x 100 mm' },
          { label: '300 × 200 mm', value: 'dimensions 300 x 200 mm' },
          { label: '500 × 300 mm', value: 'dimensions 500 x 300 mm' },
          { label: '1000 × 500 mm', value: 'dimensions 1000 x 500 mm' },
        ],
      };
    case 'material':
      return {
        text: 'Dans quelle matière souhaitez-vous la pièce ?',
        choices: [
          { label: 'Acier S235', value: 'en acier' },
          { label: 'Acier galvanisé', value: 'en acier galvanisé' },
          { label: 'Inox 304', value: 'en inox 304' },
          { label: 'Inox 316L', value: 'en inox 316' },
          { label: 'Aluminium', value: 'en aluminium' },
        ],
      };
    case 'thickness': {
      const list = THICKNESSES[spec.material];
      const pick = pickAround(list, spec.thickness, 4);
      return {
        text: `Quelle épaisseur de tôle en ${MATERIAL_LABELS[spec.material]} ? Actuellement ${fmt(spec.thickness)} mm.`,
        choices: pick.map((t) => ({ label: `${fmt(t)} mm`, value: `épaisseur ${fmt(t)} mm` })),
      };
    }
    case 'flanges': {
      const word = spec.flanges.length >= 3 ? 'des bords' : spec.flanges.length === 2 ? 'des ailes' : "de l'aile";
      const h = spec.flanges[0]?.height ?? DEFAULT_FLANGE_HEIGHT;
      const opts = uniq([20, 40, 60, h].map((x) => Math.round(x))).sort((a, b) => a - b).slice(0, 4);
      return {
        text: `Quelle hauteur ${word} (cote extérieure) ? Actuellement ${fmt(h)} mm, pliage à ${fmt(spec.flanges[0]?.angle ?? 90)}°.`,
        choices: [...opts.map((x) => ({ label: `${x} mm`, value: `rebords de ${x} mm` })), { label: 'Pli à 135°', value: 'pli à 135°' }],
      };
    }
    case 'holes':
      return {
        text: `Faut-il des perçages ? Actuellement : ${describeHoles(spec.holes)}.`,
        choices: [
          { label: 'Sans perçage', value: 'sans trou' },
          { label: '1 trou Ø10 au centre', value: '1 trou de 10 au centre' },
          { label: '4 trous Ø8 aux coins', value: '4 trous de 8' },
          { label: '4 trous Ø10 aux coins', value: '4 trous de 10' },
          keep,
        ],
      };
    case 'finish': {
      if (spec.finish === 'epoxy' && !spec.ral) {
        return {
          text: 'Quelle teinte RAL pour la peinture époxy ?',
          choices: [
            { label: 'RAL 9005 noir', value: 'RAL 9005' },
            { label: 'RAL 7016 gris anthracite', value: 'RAL 7016' },
            { label: 'RAL 9010 blanc', value: 'RAL 9010' },
            { label: 'RAL 3020 rouge', value: 'RAL 3020' },
          ],
        };
      }
      const all: { id: FinishId; choice: Choice }[] = [
        { id: 'brut', choice: { label: 'Brut', value: 'finition brute' } },
        { id: 'epoxy', choice: { label: 'Peinture époxy', value: 'peinture époxy' } },
        { id: 'galvanisation', choice: { label: 'Galvanisation à chaud', value: 'galvanisation à chaud' } },
        { id: 'brossage', choice: { label: 'Brossé', value: 'brossé' } },
        { id: 'anodisation', choice: { label: 'Anodisé', value: 'anodisé' } },
      ];
      return {
        text: 'Quelle finition souhaitez-vous ?',
        choices: all.filter((x) => FINISH_COMPAT[x.id].includes(spec.material)).map((x) => x.choice),
      };
    }
    case 'quantity':
      return {
        text: 'Combien de pièces vous faut-il ? Le prix unitaire baisse avec la quantité.',
        choices: [
          { label: '1 (prototype)', value: 'prototype' },
          { label: '10 pièces', value: '10 pièces' },
          { label: '50 pièces', value: '50 pièces' },
          { label: '100 pièces', value: '100 pièces' },
        ],
      };
  }
}

function shapeChoices(): Choice[] {
  return [
    { label: 'Plaque plane', value: 'une plaque plane' },
    { label: 'Cornière (L)', value: 'une cornière' },
    { label: 'Profil U', value: 'un profil U' },
    { label: 'Caisson / bac', value: 'un caisson' },
    { label: 'Voir d’autres exemples…', value: '__examples__' },
  ];
}

function productChoices(): Choice[] {
  return [
    { label: 'Armoire électrique', value: 'une armoire électrique' },
    { label: 'Fauteuil origami', value: 'un fauteuil en tôle pliée' },
    { label: 'Locker à casiers', value: 'un locker à casiers' },
    { label: 'Locker en angle', value: 'un locker à casiers en angle' },
    { label: 'Cabine photomaton', value: 'une cabine photomaton' },
    { label: 'Automate de pharmacie', value: 'un automate de pharmacie' },
    { label: 'Cabine téléphonique', value: 'une cabine téléphonique' },
    { label: 'Borne interactive', value: 'une borne interactive' },
    { label: 'Distributeur automatique', value: 'un distributeur automatique' },
    { label: 'Borne de recharge', value: 'une borne de recharge' },
    { label: 'Boîtes aux lettres', value: 'des boîtes aux lettres collectives' },
    { label: 'Baie serveur 19"', value: 'une baie serveur 19 pouces' },
    { label: 'Horodateur', value: 'un horodateur' },
    { label: 'Carter de machine', value: 'un carter de machine' },
    { label: 'Banque d’accueil', value: 'une banque d’accueil' },
    { label: 'Bar / comptoir', value: 'un bar' },
    { label: 'Meuble à tiroirs', value: 'un meuble à tiroirs' },
    { label: 'Étagère', value: 'une étagère modulable' },
    { label: 'Vitrine', value: 'une vitrine' },
    { label: 'Sièges d’attente', value: 'des sièges de salle d’attente' },
    { label: 'Table basse', value: 'une table basse' },
    { label: 'Bac à fleurs', value: 'un bac à fleurs' },
    { label: 'Pergola', value: 'une pergola' },
    { label: 'Porte extérieure', value: 'une porte extérieure' },
    { label: 'Borne sonore', value: 'une borne sonore' },
    { label: 'Distributeur de gel', value: 'un distributeur de gel' },
    { label: 'Meuble de tri', value: 'un meuble de tri du courrier' },
    { label: 'Cave à vin', value: 'un casier à bouteilles' },
    { label: 'Lampe', value: 'une lampe en métal perforé' },
    { label: 'Support de menu', value: 'un support de menu' },
    { label: 'Chariot', value: 'une structure tube sur roulettes' },
    { label: 'Grille / persiennes', value: 'une grille d’aération' },
    { label: 'Trémie', value: 'une trémie' },
    { label: 'Marches', value: 'des marches antidérapantes' },
    { label: 'Tôle perforée', value: 'une tôle perforée' },
    { label: 'Cassettes de façade', value: 'des cassettes de façade' },
  ];
}

/** Encombrements courants proposés en réponse rapide (L × H × P). */
const PRODUCT_SIZES: Partial<Record<ProductKind, [number, number, number][]>> = {
  armoire: [[600, 1200, 300], [800, 2000, 400], [1000, 2000, 500], [1200, 2000, 600]],
  locker: [[1200, 1800, 500], [1600, 1900, 550], [2400, 1900, 550], [3200, 2000, 600]],
  photomaton: [[1300, 1900, 750], [1500, 2000, 800], [1800, 2100, 900]],
  pharmacie: [[900, 1900, 700], [1200, 2000, 800], [1800, 2200, 1000]],
  cabine: [[900, 2200, 900], [1000, 2300, 1000], [1600, 2300, 1200], [2200, 2400, 1600]],
  kiosque: [[500, 1600, 400], [600, 1750, 450], [800, 1900, 500]],
  distributeur: [[700, 1830, 750], [900, 1830, 850], [1200, 1900, 900]],
  recharge: [[300, 1300, 250], [400, 1500, 300], [600, 1700, 400]],
  boites: [[700, 900, 300], [1000, 1100, 300], [1400, 1400, 300], [2000, 1700, 300]],
  baie: [[600, 1200, 600], [600, 2000, 1000], [800, 2000, 1000], [800, 2200, 1200]],
  horodateur: [[350, 1600, 280], [400, 1750, 300], [500, 1900, 350]],
  carter: [[1000, 1500, 800], [1500, 1700, 1200], [2500, 2200, 1800], [4000, 2500, 3000]],
};

// ---- Utilitaires ---------------------------------------------------------------

const NUM = '\\d+(?:\\.\\d+)?';
const NUMBER_WORDS: Record<string, number> = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, douze: 12, seize: 16, vingt: 20,
};
const NUMBER_WORDS_RE = Object.keys(NUMBER_WORDS).join('|');

function normalize(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’`]/g, "'")
    .replace(/×/g, 'x')
    .replace(/⌀/g, 'ø')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/(\d)\s*x\s*(?=\d)/g, '$1 x ');
}

function toNum(s: string): number {
  return parseFloat(s);
}

function toMm(v: string, unit: string | undefined): number {
  const n = toNum(v);
  if (unit === 'cm') return Math.round(n * 10 * 100) / 100;
  if (unit === 'm') return Math.round(n * 1000 * 100) / 100;
  return n;
}

function parseCount(s: string): number {
  return NUMBER_WORDS[s] ?? parseInt(s, 10);
}

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100).replace('.', ',');
}

/** « Profil U » → « profil U » (garde la lettre de forme en majuscule). */
function lowerShape(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function uniq<T>(a: T[]): T[] {
  return [...new Set(a)];
}

function nearest(list: number[], v: number): number {
  return list.reduce((best, x) => (Math.abs(x - v) < Math.abs(best - v) ? x : best), list[0]);
}

function pickAround(list: number[], v: number, n: number): number[] {
  if (list.length <= n) return list;
  const i = list.indexOf(nearest(list, v));
  const start = Math.max(0, Math.min(list.length - n, i - 1));
  return list.slice(start, start + n);
}

function hole(x: number, y: number, diameter: number): Hole {
  return { id: crypto.randomUUID(), x: round1(x), y: round1(y), diameter };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Placement automatique : 1 = centre, 2-3 = alignés sur l'axe long, 4 = coins (marge 20 mm), plus = deux rangées. */
function layoutHoles(count: number, diameter: number, w: number, d: number): Hole[] {
  const m = Math.max(HOLE_MARGIN, diameter);
  const mx = w > 2 * m ? m : w / 4;
  const my = d > 2 * m ? m : d / 4;
  const line = (n: number, horizontal: boolean, at: number): Hole[] => {
    const len = horizontal ? w : d;
    const mm = horizontal ? mx : my;
    if (n === 1) return [horizontal ? hole(len / 2, at, diameter) : hole(at, len / 2, diameter)];
    return Array.from({ length: n }, (_, i) => {
      const p = mm + ((len - 2 * mm) * i) / (n - 1);
      return horizontal ? hole(p, at, diameter) : hole(at, p, diameter);
    });
  };
  if (count <= 0) return [];
  if (count === 1) return [hole(w / 2, d / 2, diameter)];
  if (count <= 3) return w >= d ? line(count, true, d / 2) : line(count, false, w / 2);
  if (count === 4) {
    return [hole(mx, my, diameter), hole(w - mx, my, diameter), hole(w - mx, d - my, diameter), hole(mx, d - my, diameter)];
  }
  const k = Math.ceil(count / 2);
  if (w >= d) return [...line(k, true, my), ...line(count - k, true, d - my)];
  return [...line(k, false, mx), ...line(count - k, false, w - mx)];
}

function lastAsked(history: ChatMessage[]): MissingField | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role === 'assistant') return m.asks;
  }
  return undefined;
}

function namesOf(atts: Attachment[]): string {
  const names = atts.map((a) => a.name).filter(Boolean);
  return names.length ? `(${names.join(', ')})` : '';
}

function turn(
  text: string,
  patch: Partial<PartSpec>,
  missing: MissingField[],
  extra: Pick<ChatMessage, 'choices' | 'allowCustom' | 'asks'> = {},
): AssistantTurn {
  return {
    message: { id: crypto.randomUUID(), role: 'assistant', text, ...extra },
    patch,
    missing,
  };
}
