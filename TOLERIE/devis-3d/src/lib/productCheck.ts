// Contrôle d'assemblage d'un produit : chaque panneau doit toucher au moins un autre (rien ne flotte),
// et deux tôles ne doivent pas se traverser (un assemblage en angle ou en T est permis, une croix non).
import type { Panel, ProductModel } from './products';

type Box = { min: number[]; max: number[] };

function boxOf(p: Panel): Box {
  const h = p.size.map((s) => s / 2);
  if (!p.rot) return { min: p.at.map((c, i) => c - h[i]), max: p.at.map((c, i) => c + h[i]) };
  // Panneau tourné : boîte englobante de ses 8 coins.
  const [rx, ry, rz] = p.rot.map((d) => (d * Math.PI) / 180);
  const rot = ([x, y, z]: number[]) => {
    let [a, b, c] = [x, y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
    [a, c] = [a * Math.cos(ry) + c * Math.sin(ry), -a * Math.sin(ry) + c * Math.cos(ry)];
    [a, b] = [a * Math.cos(rz) - b * Math.sin(rz), a * Math.sin(rz) + b * Math.cos(rz)];
    return [a, b, c];
  };
  const pts: number[][] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pts.push(rot([sx * h[0], sy * h[1], sz * h[2]]).map((v, i) => v + p.at[i]));
  return { min: [0, 1, 2].map((i) => Math.min(...pts.map((q) => q[i]))), max: [0, 1, 2].map((i) => Math.max(...pts.map((q) => q[i]))) };
}

const gap = (a: Box, b: Box) => Math.max(...[0, 1, 2].map((i) => Math.max(a.min[i] - b.max[i], b.min[i] - a.max[i])));

export interface CheckResult {
  floating: string[];
  clashes: [string, string][];
  /** Pièce qui traverse une tôle pleine (elle devrait être posée contre, ou la tôle percée). */
  crossing: [string, string][];
}

/** `tol` : jeu toléré entre deux pièces qui se touchent (mm). */
export function checkModel(m: ProductModel, tol = 3): CheckResult {
  const boxes = m.panels.map(boxOf);
  const floating: string[] = [];
  if (m.panels.length > 1) m.panels.forEach((p, i) => {
    if (!m.panels.some((_, j) => j !== i && gap(boxes[i], boxes[j]) <= tol)) floating.push(p.id);
  });
  // Croisement : la zone commune est à l'intérieur des deux tôles (loin de leurs bords), pas un simple assemblage.
  const clashes: [string, string][] = [];
  const sheets = m.panels.map((p, i) => ({ p, b: boxes[i] })).filter((x) => x.p.sheet && !x.p.rot);
  for (let i = 0; i < sheets.length; i++) for (let j = i + 1; j < sheets.length; j++) {
    const A = sheets[i], B = sheets[j];
    const lo = [0, 1, 2].map((k) => Math.max(A.b.min[k], B.b.min[k]));
    const hi = [0, 1, 2].map((k) => Math.min(A.b.max[k], B.b.max[k]));
    if (![0, 1, 2].every((k) => hi[k] - lo[k] > 0.5)) continue;
    const interior = (x: typeof A) => {
      const thin = x.p.size.indexOf(Math.min(...x.p.size));
      const m2 = Math.max(6, x.p.size[thin] * 3);
      return [0, 1, 2].every((k) => k === thin || (lo[k] > x.b.min[k] + m2 && hi[k] < x.b.max[k] - m2));
    };
    if (interior(A) && interior(B)) clashes.push([A.p.id, B.p.id]);
  }
  // Traversée : une pièce passe de part et d'autre d'une tôle, dans sa surface, sans ouverture prévue à cet endroit.
  const crossing: [string, string][] = [];
  m.panels.forEach((q, j) => {
    if (q.rot) return;
    for (const A of sheets) {
      if (A.p === q || (A.p.motion ?? '') !== (q.motion ?? '')) continue;
      const k = A.p.size.indexOf(Math.min(...A.p.size));
      const b = boxes[j];
      if (!(b.min[k] < A.b.min[k] - 1 && b.max[k] > A.b.max[k] + 1)) continue;
      const inside = [0, 1, 2].every((i) => i === k || (b.min[i] > A.b.min[i] + 2 && b.max[i] < A.b.max[i] - 2) || (Math.min(b.max[i], A.b.max[i]) - Math.max(b.min[i], A.b.min[i]) > 2 && (b.min[i] > A.b.min[i] + 2 || b.max[i] < A.b.max[i] - 2)));
      if (!inside) continue;
      if (A.p.cutouts?.length || A.p.holes?.length) continue;
      crossing.push([q.id, A.p.id]);
    }
  });
  return { floating, clashes, crossing };
}
