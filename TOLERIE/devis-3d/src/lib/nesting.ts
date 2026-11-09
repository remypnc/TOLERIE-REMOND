// Imbrication rectangulaire (rectangle englobant du flan) sur les formats de tôle standards.
import { NEST_MARGIN, NEST_MIN_GAP, SHEET_FORMATS } from './catalog';
import type { FlatPattern, MaterialInfo, NestPlacement, NestingResult, SheetFormat } from './types';

interface Layout {
  placements: NestPlacement[];
}

/** Grille de pièces (w × h) dans une zone (zw × zh) à partir de (x0, y0). */
function grid(
  x0: number,
  y0: number,
  zw: number,
  zh: number,
  w: number,
  h: number,
  gap: number,
  rotated: boolean,
): NestPlacement[] {
  if (w <= 0 || h <= 0 || zw < w || zh < h) return [];
  const nx = Math.floor((zw + gap) / (w + gap));
  const ny = Math.floor((zh + gap) / (h + gap));
  const out: NestPlacement[] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      out.push({ x: x0 + i * (w + gap), y: y0 + j * (h + gap), rotated });
    }
  }
  return out;
}

/**
 * Grille principale dans une orientation, puis bande à droite (pleine hauteur) et
 * bande en haut (au-dessus de la grille) remplies dans l'orientation opposée.
 */
function layoutFor(uw: number, uh: number, w: number, h: number, gap: number, rotated: boolean, margin: number): Layout {
  const main = grid(margin, margin, uw, uh, w, h, gap, rotated);
  if (main.length === 0) {
    return { placements: grid(margin, margin, uw, uh, h, w, gap, !rotated) };
  }
  const nx = Math.floor((uw + gap) / (w + gap));
  const ny = Math.floor((uh + gap) / (h + gap));
  const usedW = nx * (w + gap);
  const usedH = ny * (h + gap);
  // Bande droite, pièces tournées (h × w), sur toute la hauteur utile.
  const right = grid(margin + usedW, margin, uw - usedW, uh, h, w, gap, !rotated);
  // Bande haute, pièces tournées, limitée à la largeur de la grille principale.
  const top = grid(margin, margin + usedH, usedW - gap, uh - usedH, h, w, gap, !rotated);
  return { placements: [...main, ...right, ...top] };
}

function bestLayout(sheet: SheetFormat, w: number, h: number, gap: number, margin: number): NestPlacement[] {
  const uw = sheet.width - 2 * margin;
  const uh = sheet.height - 2 * margin;
  if (uw <= 0 || uh <= 0) return [];
  const a = layoutFor(uw, uh, w, h, gap, false, margin).placements;
  const b = layoutFor(uw, uh, h, w, gap, true, margin).placements;
  return b.length > a.length ? b : a;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
const round4 = (v: number): number => Math.round(v * 10000) / 10000;

interface Candidate {
  sheet: SheetFormat;
  placements: NestPlacement[];
  perSheet: number;
  sheets: number;
  utilisation: number;
  sheetMass: number;
}

export function nest(flat: FlatPattern, quantity: number, material: MaterialInfo, thickness: number): NestingResult {
  const qty = Math.max(1, Math.round(Number.isFinite(quantity) ? quantity : 1));
  const gap = Math.max(NEST_MIN_GAP, 2 * thickness);
  const margin = NEST_MARGIN;
  const w = flat.blankWidth;
  const h = flat.blankHeight;
  const sheetKg = (s: SheetFormat): number => (s.width * s.height * thickness * material.density) / 1e6;

  const candidates: Candidate[] = SHEET_FORMATS.map((sheet) => {
    const placements = bestLayout(sheet, w, h, gap, margin);
    const perSheet = placements.length;
    const sheets = perSheet > 0 ? Math.ceil(qty / perSheet) : 0;
    const sheetArea = sheets * sheet.width * sheet.height;
    const utilisation = sheetArea > 0 ? (flat.area * qty) / sheetArea : 0;
    return { sheet, placements, perSheet, sheets, utilisation, sheetMass: sheets * sheetKg(sheet) };
  });

  const fitting = candidates.filter((c) => c.perSheet > 0);
  let best: Candidate;
  if (fitting.length > 0) {
    best = fitting.reduce((acc, c) => {
      if (c.sheetMass < acc.sheetMass - 1e-9) return c;
      if (Math.abs(c.sheetMass - acc.sheetMass) <= 1e-9 && c.utilisation > acc.utilisation) return c;
      return acc;
    });
  } else {
    // Hors format : on renvoie le plus grand format, sans placement.
    best = candidates.reduce((acc, c) => (c.sheet.width * c.sheet.height > acc.sheet.width * acc.sheet.height ? c : acc));
  }

  const partsMass = flat.mass * qty;
  return {
    sheet: best.sheet,
    perSheet: best.perSheet,
    sheets: best.sheets,
    placements: best.placements.map((p) => ({ x: round2(p.x), y: round2(p.y), rotated: p.rotated })),
    utilisation: round4(best.utilisation),
    sheetMass: round2(best.sheetMass),
    scrapMass: round2(best.perSheet > 0 ? Math.max(best.sheetMass - partsMass, 0) : 0),
    gap,
    margin,
    alternatives: candidates
      .filter((c) => c !== best)
      .map((c) => ({ sheet: c.sheet, perSheet: c.perSheet, sheets: c.sheets, utilisation: round4(c.utilisation) })),
  };
}
