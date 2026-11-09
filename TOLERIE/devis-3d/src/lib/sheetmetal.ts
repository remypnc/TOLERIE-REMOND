// Mise à plat d'une pièce pliée : base rectangulaire + bords tombés, flan en croix.
import { MATERIALS } from './catalog';
import type { BendLine, Edge, Face, FlatPattern, Flange, Hole, PartSpec } from './types';
import { clipPolygon, cornerRelief, facePolygon, holeKept, type Pt as FPt } from './faces';

type Pt = [number, number];

interface BendCalc {
  flange: Flange;
  angle: number;
  /** Bend allowance : longueur de l'arc sur la fibre neutre. */
  ba: number;
  /** Recul extérieur (outside setback). */
  ossb: number;
  /** Bend deduction = 2·OSSB − BA. */
  bd: number;
  /** Longueur droite de l'aile dans le flan (hauteur extérieure − OSSB). */
  flat: number;
  /** Débord total du flan au-delà de la base plate (BA + aile). */
  ext: number;
}

const r2 = (v: number): number => Math.round(v * 100) / 100;

const fr = (v: number, digits = 2): string => v.toFixed(digits).replace('.', ',');

const frShort = (v: number): string => {
  const s = (Math.round(v * 100) / 100).toString();
  return s.replace('.', ',');
};

function bendCalc(flange: Flange, t: number, r: number, k: number): BendCalc {
  const angle = Math.min(Math.max(flange.angle, 0.1), 179);
  const ba = (Math.PI * (r + k * t) * angle) / 180;
  const ossb = (r + t) * Math.tan((angle * Math.PI) / 360);
  const bd = 2 * ossb - ba;
  const flat = Math.max(flange.height - ossb, 0);
  return { flange, angle, ba, ossb, bd, flat, ext: ba + flat };
}

function polygonArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function perimeter(pts: Pt[]): number {
  let p = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    p += Math.hypot(x2 - x1, y2 - y1);
  }
  return p;
}

/** Supprime les sommets doublons et colinéaires. */
function cleanPolygon(pts: Pt[]): Pt[] {
  const eps = 1e-9;
  let out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > eps || Math.abs(last[1] - p[1]) > eps) out.push(p);
  }
  if (out.length > 1) {
    const f = out[0];
    const l = out[out.length - 1];
    if (Math.abs(f[0] - l[0]) <= eps && Math.abs(f[1] - l[1]) <= eps) out.pop();
  }
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    const next: Pt[] = [];
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length];
      const b = out[i];
      const c = out[(i + 1) % out.length];
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(cross) <= eps) {
        changed = true;
        // On saute b, puis on recopie le reste tel quel pour ce passage.
        for (let j = i + 1; j < out.length; j++) next.push(out[j]);
        break;
      }
      next.push(b);
    }
    out = next;
  }
  return out;
}

/** Intervalles [a, b] couverts par les arêtes d'un polygone posées sur la droite `axis = value`. */
function edgeIntervals(poly: Pt[], axis: 0 | 1, value: number): [number, number][] {
  const other = axis === 0 ? 1 : 0;
  const out: [number, number][] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (Math.abs(a[axis] - value) < 1e-6 && Math.abs(b[axis] - value) < 1e-6) {
      out.push([Math.min(a[other], b[other]), Math.max(a[other], b[other])]);
    }
  }
  return out;
}

/** Recouvrement total de deux listes d'intervalles. */
function overlaps(a: [number, number][], b: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [a1, a2] of a) for (const [b1, b2] of b) {
    const lo = Math.max(a1, b1);
    const hi = Math.min(a2, b2);
    if (hi - lo > 1e-6) out.push([lo, hi]);
  }
  return out;
}

/**
 * Mise à plat face par face : la base plate (entre les débuts de pli) et chaque aile développée,
 * chacune découpée selon ses propres découpes. Le flan est la réunion des faces.
 */
export function unfold(spec: PartSpec): FlatPattern {
  const material = MATERIALS[spec.material];
  const t = spec.thickness;
  const r = spec.innerRadius ?? t;
  const k = material.kFactor;

  // Un seul bord tombé par bord : le dernier déclaré l'emporte.
  const byEdge = new Map<Edge, BendCalc>();
  for (const f of spec.flanges) {
    if (f.height > 0) byEdge.set(f.edge, bendCalc(f, t, r, k));
  }
  const n = byEdge.get('nord');
  const s = byEdge.get('sud');
  const e = byEdge.get('est');
  const w = byEdge.get('ouest');

  // Base plate (entre les débuts de pli), repère : coin SO de la base plate.
  const lx = Math.max(spec.width - (w?.ossb ?? 0) - (e?.ossb ?? 0), 0);
  const ly = Math.max(spec.depth - (s?.ossb ?? 0) - (n?.ossb ?? 0), 0);
  const offX = w?.ossb ?? 0;
  const offY = s?.ossb ?? 0;

  // Dégagement d'angle quand deux bords adjacents sont pliés : les ailes sont raccourcies d'autant.
  const relief = Math.min(cornerRelief(t), lx / 2, ly / 2);
  const rel = (a?: BendCalc, b?: BendCalc) => (a && b ? relief : 0);

  /** Repère d'une face (cotes de la pièce pliée) → repère de la base plate du flan. */
  const toFlat = (face: Face, x: number, y: number): Pt => {
    if (face === 'base') return [x - offX, y - offY];
    const c = byEdge.get(face)!;
    const d = c.ext * (y / Math.max(c.flange.height, 1e-6)); // hauteur → longueur développée
    if (face === 'nord') return [x - offX, ly + d];
    if (face === 'sud') return [x - offX, -d];
    if (face === 'est') return [lx + d, x - offY];
    return [-d, x - offY];
  };
  const clipBox = (poly: Pt[], x0: number, y0: number, x1: number, y1: number): Pt[] => {
    let p = poly;
    p = clipPolygon(p as FPt[], ([x]) => x - x0) as Pt[];
    p = clipPolygon(p as FPt[], ([x]) => x1 - x) as Pt[];
    p = clipPolygon(p as FPt[], ([, y]) => y - y0) as Pt[];
    p = clipPolygon(p as FPt[], ([, y]) => y1 - y) as Pt[];
    return p;
  };

  const faces: { face: Face; poly: Pt[] }[] = [];
  faces.push({ face: 'base', poly: clipBox(facePolygon(spec, 'base').map(([x, y]) => toFlat('base', x, y)), 0, 0, lx, ly) });
  if (n) faces.push({ face: 'nord', poly: clipBox(facePolygon(spec, 'nord').map(([x, y]) => toFlat('nord', x, y)), rel(n, w), ly, lx - rel(n, e), ly + n.ext) });
  if (s) faces.push({ face: 'sud', poly: clipBox(facePolygon(spec, 'sud').map(([x, y]) => toFlat('sud', x, y)), rel(s, w), -s.ext, lx - rel(s, e), 0) });
  if (e) faces.push({ face: 'est', poly: clipBox(facePolygon(spec, 'est').map(([x, y]) => toFlat('est', x, y)), lx, rel(e, s), lx + e.ext, ly - rel(e, n)) });
  if (w) faces.push({ face: 'ouest', poly: clipBox(facePolygon(spec, 'ouest').map(([x, y]) => toFlat('ouest', x, y)), -w.ext, rel(w, s), 0, ly - rel(w, n)) });
  const live = faces.filter((f) => f.poly.length >= 3 && Math.abs(polygonArea(f.poly)) > 0.01);

  // Jonctions base / aile et lignes de pli : seulement là où les deux faces existent encore.
  const base = live.find((f) => f.face === 'base')?.poly ?? [];
  const seamsRaw: { edge: Edge; c: BendCalc; axis: 0 | 1; value: number; spans: [number, number][] }[] = [];
  const addSeam = (edge: Edge, c: BendCalc | undefined, axis: 0 | 1, value: number) => {
    const fl = live.find((f) => f.face === edge);
    if (!c || !fl) return;
    const spans = overlaps(edgeIntervals(base, axis, value), edgeIntervals(fl.poly, axis, value));
    if (spans.length) seamsRaw.push({ edge, c, axis, value, spans });
  };
  addSeam('nord', n, 1, ly);
  addSeam('sud', s, 1, 0);
  addSeam('est', e, 0, lx);
  addSeam('ouest', w, 0, 0);

  // Origine au coin bas-gauche du rectangle englobant.
  const all = live.flatMap((f) => f.poly);
  const minX = all.length ? Math.min(...all.map((p) => p[0])) : 0;
  const minY = all.length ? Math.min(...all.map((p) => p[1])) : 0;
  const maxX = all.length ? Math.max(...all.map((p) => p[0])) : 0;
  const maxY = all.length ? Math.max(...all.map((p) => p[1])) : 0;
  const mv = ([x, y]: Pt): Pt => [r2(x - minX), r2(y - minY)];

  const facesOut = live.map((f) => cleanPolygon(f.poly).map(mv));
  const seams: [number, number, number, number][] = [];
  const bendLines: BendLine[] = [];
  for (const sm of seamsRaw) {
    for (const [a, b] of sm.spans) {
      const p1: Pt = sm.axis === 1 ? [a, sm.value] : [sm.value, a];
      const p2: Pt = sm.axis === 1 ? [b, sm.value] : [sm.value, b];
      const [x1, y1] = mv(p1);
      const [x2, y2] = mv(p2);
      seams.push([x1, y1, x2, y2]);
      // La ligne de pli est au milieu de la zone de pli (BA/2 au-delà de la base plate).
      const off = sm.c.ba / 2;
      const dx = sm.edge === 'est' ? off : sm.edge === 'ouest' ? -off : 0;
      const dy = sm.edge === 'nord' ? off : sm.edge === 'sud' ? -off : 0;
      bendLines.push({
        x1: r2(x1 + dx), y1: r2(y1 + dy), x2: r2(x2 + dx), y2: r2(y2 + dy),
        edge: sm.edge,
        angle: sm.c.angle,
        innerRadius: r2(r),
        bendAllowance: r2(sm.c.ba),
        bendDeduction: r2(sm.c.bd),
      });
    }
  }

  // Perçages conservés, reportés sur le flan.
  const kept = spec.holes.filter((h) => holeKept(spec, h) && (h.face === undefined || h.face === 'base' || byEdge.has(h.face)));
  const holes: Hole[] = kept.map((h) => {
    const [x, y] = mv(toFlat(h.face ?? 'base', h.x, h.y));
    return { id: h.id, x, y, diameter: h.diameter, face: h.face, hardware: h.hardware };
  });

  const holesArea = kept.reduce((acc, h) => acc + (Math.PI * h.diameter * h.diameter) / 4, 0);
  const holesCut = kept.reduce((acc, h) => acc + Math.PI * h.diameter, 0);
  const facesArea = live.reduce((acc, f) => acc + Math.abs(polygonArea(f.poly)), 0);
  const seamLen = seamsRaw.reduce((acc, sm) => acc + sm.spans.reduce((x, [a, b]) => x + (b - a), 0), 0);
  const area = Math.max(facesArea - holesArea, 0);
  // Contour = somme des périmètres des faces, moins les jonctions (comptées deux fois).
  const cutLength = live.reduce((acc, f) => acc + perimeter(f.poly), 0) - 2 * seamLen + holesCut;
  const mass = (area * t * material.density) / 1e6;
  const blankWidth = maxX - minX;
  const blankHeight = maxY - minY;

  const notes: string[] = [];
  const order: [Edge, BendCalc | undefined][] = [
    ['nord', n],
    ['sud', s],
    ['est', e],
    ['ouest', w],
  ];
  for (const [edge, c] of order) {
    if (!c) continue;
    notes.push(
      `Pli ${edge} ${frShort(c.angle)}° · R${frShort(r)} · K${frShort(k)} · BA ${fr(c.ba)} · BD ${fr(c.bd)} mm` +
        ` · aile développée ${fr(c.flat)} mm`,
    );
  }
  notes.push(`Flan ${fr(blankWidth, 1)} × ${fr(blankHeight, 1)} mm`);

  return {
    outline: facesOut[0] ?? [],
    faces: facesOut,
    seams,
    holes,
    bendLines,
    blankWidth: r2(blankWidth),
    blankHeight: r2(blankHeight),
    area: r2(area),
    cutLength: r2(cutLength),
    pierces: 1 + kept.length,
    mass: Math.round(mass * 1000) / 1000,
    notes,
  };
}
