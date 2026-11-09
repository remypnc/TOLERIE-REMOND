// Faces de la pièce (base, ailes) : contour après découpes, perçages conservés, conversions.
// Commun à la 3D, à la mise à plat et à l'interface.
import type { Cut, Face, Fillet, Hole, PartSpec } from './types';

export type Pt = [number, number];

export const FACE_LABEL: Record<Face, string> = {
  base: 'Base',
  nord: 'Aile arrière (nord)',
  sud: 'Aile avant (sud)',
  est: 'Aile droite (est)',
  ouest: 'Aile gauche (ouest)',
};

/** Libellés des deux axes d'une face, pour l'interface. */
export function faceAxes(face: Face): { x: string; y: string } {
  if (face === 'base') return { x: 'du bord gauche', y: 'du bord avant' };
  if (face === 'nord' || face === 'sud') return { x: 'du bord gauche', y: 'de hauteur' };
  return { x: 'du bord avant', y: 'de hauteur' };
}

/** Dimensions d'une face (largeur, hauteur) ; null si l'aile n'existe pas. */
export function faceSize(spec: PartSpec, face: Face): Pt | null {
  if (face === 'base') return [spec.width, spec.depth];
  const f = spec.flanges.find((x) => x.edge === face);
  if (!f) return null;
  return [face === 'nord' || face === 'sud' ? spec.width : spec.depth, f.height];
}

/** Distance signée à la ligne de découpe, positive du côté conservé. */
export function cutSide(cut: Cut, size: Pt): (x: number, y: number) => number {
  const dx = cut.x2 - cut.x1;
  const dy = cut.y2 - cut.y1;
  const len = Math.hypot(dx, dy) || 1;
  const raw = (x: number, y: number) => (dx * (y - cut.y1) - dy * (x - cut.x1)) / len;
  let sign = raw(size[0] / 2, size[1] / 2) < 0 ? -1 : 1;
  if (cut.flip) sign = -sign;
  return (x, y) => sign * raw(x, y);
}

/** Découpe d'un polygone par un demi-plan (Sutherland–Hodgman) ; `side(p) >= 0` est conservé. */
export function clipPolygon(poly: Pt[], side: (p: Pt) => number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const sa = side(a);
    const sb = side(b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) {
      const t = sa / (sa - sb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

export function polygonArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export const cutsOn = (spec: PartSpec, face: Face): Cut[] => (spec.cuts ?? []).filter((c) => (c.face ?? 'base') === face);
export const holesOn = (spec: PartSpec, face: Face): Hole[] => spec.holes.filter((h) => (h.face ?? 'base') === face);

/** Contour d'une face après ses découpes, sans les arrondis d'angle (repère de la face). */
export function cutPolygon(spec: PartSpec, face: Face, extra: Cut[] = []): Pt[] {
  const size = faceSize(spec, face);
  if (!size) return [];
  let poly: Pt[] = [[0, 0], [size[0], 0], [size[0], size[1]], [0, size[1]]];
  for (const c of [...cutsOn(spec, face), ...extra]) {
    const side = cutSide(c, size);
    poly = clipPolygon(poly, ([x, y]) => side(x, y));
  }
  return poly;
}

/** Contour d'une face après ses découpes et ses arrondis d'angle (repère de la face). */
export function facePolygon(spec: PartSpec, face: Face, extra: Cut[] = []): Pt[] {
  const poly = cutPolygon(spec, face, extra);
  const fillets = filletsOn(spec, face);
  if (!fillets.length || poly.length < 3) return poly;
  const size = faceSize(spec, face)!;
  const out: Pt[] = [];
  poly.forEach((b, i) => {
    const f = fillets.find((x) => samePoint(filletPoint(x, size), b));
    if (!f || !cornerAllowed(spec, face, b)) return out.push(b);
    out.push(...roundCorner(poly[(i - 1 + poly.length) % poly.length], b, poly[(i + 1) % poly.length], f.radius));
  });
  return out;
}

// --- Arrondis d'angle -------------------------------------------------------------------

export const filletsOn = (spec: PartSpec, face: Face): Fillet[] => (spec.fillets ?? []).filter((f) => (f.face ?? 'base') === face);

const samePoint = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1;

/** Position du coin d'un arrondi, dans le repère de sa face. */
export function filletPoint(f: Fillet, size: Pt): Pt {
  return [f.fromRight ? size[0] - f.x : f.x, f.fromTop ? size[1] - f.y : f.y];
}

/** Repère un coin depuis les bords les plus proches (voir `Fillet`). */
export function filletAnchor(size: Pt, [x, y]: Pt): Pick<Fillet, 'x' | 'y' | 'fromRight' | 'fromTop'> {
  const fromRight = x > size[0] / 2;
  const fromTop = y > size[1] / 2;
  return { x: fromRight ? size[0] - x : x, y: fromTop ? size[1] - y : y, fromRight, fromTop };
}

/** Un coin posé sur une ligne de pli ne s'arrondit pas (la matière continue dans le pli). */
function cornerAllowed(spec: PartSpec, face: Face, [x, y]: Pt): boolean {
  const eps = 1e-6;
  if (face !== 'base') return y > eps;
  const on = (e: string) => spec.flanges.some((f) => f.edge === e && f.height > 0);
  if (on('ouest') && x < eps) return false;
  if (on('est') && x > spec.width - eps) return false;
  if (on('sud') && y < eps) return false;
  if (on('nord') && y > spec.depth - eps) return false;
  return true;
}

/** Angles qu'on peut arrondir (saillants, hors lignes de pli), avec la direction vers l'intérieur de la matière. */
export function faceCorners(spec: PartSpec, face: Face): { x: number; y: number; inward: Pt }[] {
  const poly = cutPolygon(spec, face);
  const ccw = polygonArea(poly) > 0;
  const out: { x: number; y: number; inward: Pt }[] = [];
  poly.forEach((b, i) => {
    const a = poly[(i - 1 + poly.length) % poly.length];
    const c = poly[(i + 1) % poly.length];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if ((ccw ? cross : -cross) <= 1e-6 || !cornerAllowed(spec, face, b)) return;
    const u = unit([a[0] - b[0], a[1] - b[1]]);
    const w = unit([c[0] - b[0], c[1] - b[1]]);
    out.push({ x: b[0], y: b[1], inward: unit([u[0] + w[0], u[1] + w[1]]) });
  });
  return out;
}

const unit = ([x, y]: Pt): Pt => {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
};

/** Remplace le coin `b` par un arc tangent aux deux côtés ; le rayon est limité à la moitié des côtés. */
function roundCorner(a: Pt, b: Pt, c: Pt, radius: number): Pt[] {
  const la = Math.hypot(a[0] - b[0], a[1] - b[1]);
  const lc = Math.hypot(c[0] - b[0], c[1] - b[1]);
  const u = unit([a[0] - b[0], a[1] - b[1]]);
  const w = unit([c[0] - b[0], c[1] - b[1]]);
  const theta = Math.acos(Math.min(1, Math.max(-1, u[0] * w[0] + u[1] * w[1])));
  if (radius <= 0 || theta < 1e-3 || theta > Math.PI - 1e-3) return [b];
  const d = Math.min(radius / Math.tan(theta / 2), la / 2, lc / 2);
  const r = d * Math.tan(theta / 2);
  const bis = unit([u[0] + w[0], u[1] + w[1]]);
  const h = r / Math.sin(theta / 2);
  const center: Pt = [b[0] + bis[0] * h, b[1] + bis[1] * h];
  const p1: Pt = [b[0] + u[0] * d, b[1] + u[1] * d];
  const p2: Pt = [b[0] + w[0] * d, b[1] + w[1] * d];
  const a1 = Math.atan2(p1[1] - center[1], p1[0] - center[0]);
  let a2 = Math.atan2(p2[1] - center[1], p2[0] - center[0]);
  while (a2 - a1 > Math.PI) a2 -= Math.PI * 2;
  while (a2 - a1 < -Math.PI) a2 += Math.PI * 2;
  const n = Math.max(4, Math.ceil((Math.abs(a2 - a1) / (Math.PI / 2)) * 10));
  return Array.from({ length: n + 1 }, (_, k) => {
    const t = a1 + ((a2 - a1) * k) / n;
    return [center[0] + Math.cos(t) * r, center[1] + Math.sin(t) * r] as Pt;
  });
}

/** Zone retirée par une découpe (pour l'aperçu en rouge). */
export function removedPolygon(spec: PartSpec, cut: Cut): Pt[] {
  const face = cut.face ?? 'base';
  const size = faceSize(spec, face);
  if (!size) return [];
  const side = cutSide(cut, size);
  return clipPolygon(facePolygon(spec, face), ([x, y]) => -side(x, y));
}

/** Un perçage n'existe que s'il reste entièrement dans la matière de sa face. */
export function holeKept(spec: PartSpec, h: Hole): boolean {
  const face = h.face ?? 'base';
  const size = faceSize(spec, face);
  if (!size) return false;
  const r = h.diameter / 2;
  if (h.x - r <= 0 || h.y - r <= 0 || h.x + r >= size[0] || h.y + r >= size[1]) return false;
  return cutsOn(spec, face).every((c) => cutSide(c, size)(h.x, h.y) >= r);
}

/**
 * Repère de face → repère « canonique » de l'aile en 3D (u le long du bord dans le sens de construction,
 * v = hauteur). Le sens de construction est inversé pour les ailes sud et est.
 */
export function faceToCanonical(spec: PartSpec, face: Face, x: number, y: number): Pt {
  if (face === 'sud') return [spec.width - x, y];
  if (face === 'est') return [spec.depth - x, y];
  return [x, y];
}
export const canonicalToFace = faceToCanonical; // la conversion est sa propre inverse

/** Aimante un point sur le bord le plus proche de sa face s'il en est à moins de `snap` mm. */
export function snapToFace(spec: PartSpec, face: Face, x: number, y: number, snap = 8): Pt {
  const size = faceSize(spec, face) ?? [spec.width, spec.depth];
  const sx = x < snap ? 0 : x > size[0] - snap ? size[0] : x;
  const sy = y < snap ? 0 : y > size[1] - snap ? size[1] : y;
  return [Math.round(sx), Math.round(sy)];
}

/** Dégagement d'angle entre deux ailes voisines : un peu plus que l'épaisseur, pour qu'elles ne se touchent pas une fois pliées. */
export const cornerRelief = (thickness: number) => thickness + 0.2;

/** Faces numérotées de la pièce, dans l'ordre de lecture : 1 = base, puis une par aile. */
export function faceList(spec: PartSpec): { face: Face; n: number; label: string }[] {
  return [
    { face: 'base' as Face, n: 1, label: FACE_LABEL.base },
    ...spec.flanges.filter((f) => f.height > 0).map((f, i) => ({ face: f.edge as Face, n: i + 2, label: FACE_LABEL[f.edge] })),
  ];
}
