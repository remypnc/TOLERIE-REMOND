// Fichiers pour l'atelier, générés à partir de la pièce : patron DXF (découpe laser), modèle 3D STEP,
// fiche devis imprimable (PDF via l'impression du navigateur).
import * as THREE from 'three';
import type { PartSpec, Quote } from './types';
import { buildPart } from './partGeometry';
import { unfold } from './sheetmetal';
import { computeQuote } from './pricing';
import { PRODUCTS, productFlat, productModel, productQuote, sheetParts } from './products';
import { importedFlat } from './cadImport';
import { specRecap } from './recap';
import { STATUS_LABEL, type ClientContact, type ClientOrder } from './orders';
import { nest } from './nesting';
import { FINISHES, MATERIALS } from './catalog';
import { FACE_LABEL } from './faces';
import { HARDWARE_LABEL, hardwareDxf, hardwareList, preHole } from './hardware';

/** Les logiciels de CAO et de découpe lisent mal les accents : noms et textes en ASCII. */
const ascii = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '');

export function download(name: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// --- DXF : le flan déplié, prêt pour la découpe -----------------------------------------------------

type Seg = [number, number, number, number];

/** Retire d'un bord de face les portions posées sur une jonction (pli) : seul le vrai contour est découpé. */
function minusSeams([x1, y1, x2, y2]: Seg, seams: Seg[]): Seg[] {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return [];
  const along = (x: number, y: number) => ((x - x1) * dx + (y - y1) * dy) / (len * len);
  const off = (x: number, y: number) => Math.abs((x - x1) * dy - (y - y1) * dx) / len;
  let keep: [number, number][] = [[0, 1]];
  for (const [a, b, c, d] of seams) {
    if (off(a, b) > 1e-3 || off(c, d) > 1e-3) continue;
    const [s0, s1] = [along(a, b), along(c, d)].sort((p, q) => p - q);
    keep = keep.flatMap(([k0, k1]) => [[k0, Math.min(k1, s0)], [Math.max(k0, s1), k1]] as [number, number][]).filter(([k0, k1]) => (k1 - k0) * len > 1e-3);
  }
  return keep.map(([t0, t1]) => [x1 + dx * t0, y1 + dy * t0, x1 + dx * t1, y1 + dy * t1]);
}

/** Patron DXF (R12, mm) : calque DECOUPE (contour + perçages), PLIAGE (axes de pli, tirets), TEXTE (consignes). */
export function flatDxf(spec: PartSpec, reference: string): string {
  const flat = unfold(spec);
  const n = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v).toFixed(4).replace(/\.?0+$/, '') || '0';
  const out: (string | number)[] = [];
  const g = (...pairs: (string | number)[]) => out.push(...pairs);

  g(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', 9, '$INSUNITS', 70, 4,
    9, '$EXTMIN', 10, 0, 20, 0, 30, 0, 9, '$EXTMAX', 10, n(flat.blankWidth), 20, n(flat.blankHeight), 30, 0, 0, 'ENDSEC');
  g(0, 'SECTION', 2, 'TABLES');
  g(0, 'TABLE', 2, 'LTYPE', 70, 2,
    0, 'LTYPE', 2, 'CONTINUOUS', 70, 0, 3, 'Solid line', 72, 65, 73, 0, 40, 0,
    0, 'LTYPE', 2, 'DASHED', 70, 0, 3, '__ __ __', 72, 65, 73, 2, 40, 15, 49, 10, 49, -5, 0, 'ENDTAB');
  const layers: [string, number, string][] = [['DECOUPE', 7, 'CONTINUOUS'], ['PLIAGE', 1, 'DASHED'], ['TEXTE', 3, 'CONTINUOUS']];
  g(0, 'TABLE', 2, 'LAYER', 70, layers.length);
  for (const [name, color, lt] of layers) g(0, 'LAYER', 2, name, 70, 0, 62, color, 6, lt);
  g(0, 'ENDTAB', 0, 'ENDSEC');

  g(0, 'SECTION', 2, 'ENTITIES');
  const line = (layer: string, [a, b, c, d]: Seg) => g(0, 'LINE', 8, layer, 10, n(a), 20, n(b), 30, 0, 11, n(c), 21, n(d), 31, 0);
  const text = (x: number, y: number, h: number, s: string, rot = 0) => g(0, 'TEXT', 8, 'TEXTE', 10, n(x), 20, n(y), 30, 0, 40, n(h), 1, s, 50, n(rot));

  for (const face of flat.faces) {
    face.forEach(([x, y], i) => {
      const [x2, y2] = face[(i + 1) % face.length];
      minusSeams([x, y, x2, y2], flat.seams).forEach((s) => line('DECOUPE', s));
    });
  }
  const th = Math.max(Math.min(flat.blankWidth, flat.blankHeight) * 0.025, 2.5);
  for (const h of flat.holes) {
    g(0, 'CIRCLE', 8, 'DECOUPE', 10, n(h.x), 20, n(h.y), 30, 0, 40, n(h.diameter / 2));
    // Perçage équipé : le trou est découpé au diamètre de préparation, l'insert est repéré pour le poste de sertissage.
    if (h.hardware) text(h.x + h.diameter / 2 + th * 0.4, h.y - th * 0.4, th * 0.8, hardwareDxf(h.hardware));
  }
  for (const b of flat.bendLines) {
    line('PLIAGE', [b.x1, b.y1, b.x2, b.y2]);
    const rot = (Math.atan2(b.y2 - b.y1, b.x2 - b.x1) * 180) / Math.PI;
    const upright = rot > 90 || rot <= -90 ? rot - 180 : rot;
    text((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2 + th * 0.6, th, `PLI ${n(b.angle)}%%d R${n(b.innerRadius)} VERS LE HAUT`, upright);
  }
  text(0, -th * 2.4, th, ascii(`${reference} - ${spec.name} - ep. ${n(spec.thickness)} mm - ${spec.material} - flan ${n(flat.blankWidth)} x ${n(flat.blankHeight)} mm`));
  g(0, 'ENDSEC', 0, 'EOF');
  return out.join('\n') + '\n';
}

/**
 * Triangles de la pièce pliée (mm, Z vers le haut, origine au coin avant gauche de la base), sommets soudés.
 * Les faces collées entre une partie plate et l'arc de pli sont retirées : il reste l'enveloppe extérieure.
 */
function partTriangles(spec: PartSpec) {
  const part = buildPart(spec, 1);
  part.root.updateMatrixWorld(true);
  const toPart = part.partFrame.matrixWorld.clone().invert();

  const pts: [number, number, number][] = [];
  const index = new Map<string, number>();
  const weld = (v: THREE.Vector3) => {
    const k = `${Math.round(v.x * 1000)},${Math.round(v.y * 1000)},${Math.round(v.z * 1000)}`;
    let i = index.get(k);
    if (i === undefined) {
      i = pts.length;
      pts.push([v.x, v.y, v.z]);
      index.set(k, i);
    }
    return i;
  };
  const tris = new Map<string, { t: [number, number, number]; count: number }>();
  const v = new THREE.Vector3();
  for (const mesh of part.meshes) {
    const m = toPart.clone().multiply(mesh.matrixWorld);
    const geo = mesh.geometry;
    const pos = geo.getAttribute('position');
    const idx = geo.getIndex();
    const count = idx ? idx.count : pos.count;
    const at = (k: number) => weld(v.fromBufferAttribute(pos, idx ? idx.getX(k) : k).applyMatrix4(m));
    for (let k = 0; k < count; k += 3) {
      const t: [number, number, number] = [at(k), at(k + 1), at(k + 2)];
      if (t[0] === t[1] || t[1] === t[2] || t[0] === t[2]) continue;
      const key = [...t].sort((a, b) => a - b).join(',');
      const cur = tris.get(key);
      if (cur) cur.count++;
      else tris.set(key, { t, count: 1 });
    }
  }
  part.dispose();
  const out = [...tris.values()].filter((x) => x.count === 1).map((x) => x.t);
  return { pts, tris: out };
}

/** Modèle STL (maillage, mm) : visualisation, impression 3D, contrôle. */
export function partStl(spec: PartSpec, reference: string): string {
  const { pts, tris } = partTriangles(spec);
  const f = (x: number) => x.toExponential(6);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const out = [`solid ${ascii(reference)}`];
  for (const t of tris) {
    a.fromArray(pts[t[0]]); b.fromArray(pts[t[1]]); c.fromArray(pts[t[2]]);
    const nrm = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    out.push(` facet normal ${f(nrm.x)} ${f(nrm.y)} ${f(nrm.z)}`, '  outer loop', ...[a, b, c].map((v) => `   vertex ${f(v.x)} ${f(v.y)} ${f(v.z)}`), '  endloop', ' endfacet');
  }
  out.push(`endsolid ${ascii(reference)}`);
  return out.join('\n') + '\n';
}

// --- STEP : la pièce pliée en 3D --------------------------------------------------------------------

/**
 * Modèle STEP AP214 (mm, Z vers le haut, origine au coin avant gauche de la base).
 * Solide à facettes (FACETED_BREP) : exact sur les faces planes, plis arrondis approchés par facettes.
 * Les faces collées entre une partie plate et l'arc de pli sont retirées pour garder une enveloppe fermée.
 */
export function partStep(spec: PartSpec, reference: string): string {
  const { pts, tris } = partTriangles(spec);
  const r = (x: number) => (Math.abs(x) < 1e-9 ? 0 : x).toFixed(4).replace(/0+$/, '');

  const lines: string[] = [];
  let id = 0;
  const e = (body: string) => {
    lines.push(`#${++id}=${body};`);
    return `#${id}`;
  };
  const name = ascii(`${reference} ${spec.name}`).replace(/'/g, "''");
  const ctx = e("APPLICATION_CONTEXT('automotive design')");
  e(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${ctx})`);
  const pctx = e(`PRODUCT_CONTEXT('',${ctx},'mechanical')`);
  const product = e(`PRODUCT('${ascii(reference)}','${name}','',(${pctx}))`);
  e(`PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(${product}))`);
  const pdf = e(`PRODUCT_DEFINITION_FORMATION('','',${product})`);
  const pdctx = e(`PRODUCT_DEFINITION_CONTEXT('part definition',${ctx},'design')`);
  const pd = e(`PRODUCT_DEFINITION('design','',${pdf},${pdctx})`);
  const pds = e(`PRODUCT_DEFINITION_SHAPE('','',${pd})`);
  const mm = e('(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))');
  const rad = e('(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))');
  const sr = e('(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())');
  const unc = e(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-03),${mm},'distance_accuracy_value','confusion accuracy')`);
  const geomCtx = e(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${unc}))GLOBAL_UNIT_ASSIGNED_CONTEXT((${mm},${rad},${sr}))REPRESENTATION_CONTEXT('',''))`);
  const origin = e(`AXIS2_PLACEMENT_3D('',${e("CARTESIAN_POINT('',(0.,0.,0.))")},${e("DIRECTION('',(0.,0.,1.))")},${e("DIRECTION('',(1.,0.,0.))")})`);

  const pointRef = pts.map(([x, y, z]) => e(`CARTESIAN_POINT('',(${r(x)},${r(y)},${r(z)}))`));
  const faces: string[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (const t of tris) {
    a.fromArray(pts[t[0]]); b.fromArray(pts[t[1]]); c.fromArray(pts[t[2]]);
    const u = b.clone().sub(a);
    const nrm = u.clone().cross(c.clone().sub(a));
    if (nrm.lengthSq() < 1e-12) continue;
    nrm.normalize();
    u.normalize();
    const dir = (w: THREE.Vector3) => e(`DIRECTION('',(${r(w.x)},${r(w.y)},${r(w.z)}))`);
    const plane = e(`PLANE('',${e(`AXIS2_PLACEMENT_3D('',${pointRef[t[0]]},${dir(nrm)},${dir(u)})`)})`);
    const loop = e(`POLY_LOOP('',(${t.map((i) => pointRef[i]).join(',')}))`);
    faces.push(e(`FACE_SURFACE('',(${e(`FACE_OUTER_BOUND('',${loop},.T.)`)}),${plane},.T.)`));
  }
  const brep = e(`FACETED_BREP('${name}',${e(`CLOSED_SHELL('',(${faces.join(',')}))`)})`);
  const rep = e(`FACETED_BREP_SHAPE_REPRESENTATION('${name}',(${origin},${brep}),${geomCtx})`);
  e(`SHAPE_DEFINITION_REPRESENTATION(${pds},${rep})`);

  const stamp = new Date().toISOString().slice(0, 19);
  return [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('${name}'),'2;1');`,
    `FILE_NAME('${ascii(reference)}.step','${stamp}',('Tolerie Remond'),('Tolerie Remond'),'devis-3d','devis-3d','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
    'ENDSEC;',
    'DATA;',
    ...lines,
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n');
}

// --- Fiche devis : page imprimable (« Enregistrer en PDF ») -----------------------------------------

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const eur = (x: number) => x.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const fr = (x: number, d = 1) => x.toLocaleString('fr-FR', { maximumFractionDigits: d });
const date = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');

/** Patron déplié en SVG. `file` : dimensions réelles en mm (pour un logiciel), sinon taille libre (pour une fiche). */
export function flatSvg(spec: PartSpec, file = false) {
  const flat = unfold(spec);
  const { blankWidth: W, blankHeight: H } = flat;
  const pad = file ? 2 : Math.max(W, H) * 0.06;
  const path = flat.faces.map((f) => f.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${H - y}`).join(' ') + 'Z').join(' ');
  const sw = file ? 0.2 : Math.max(W, H) / 300;
  const size = file ? ` width="${W + 2 * pad}mm" height="${H + 2 * pad}mm"` : '';
  return `<svg viewBox="${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}"${size} xmlns="http://www.w3.org/2000/svg">
<path d="${path}" fill="${file ? 'none' : '#eef3f9'}" stroke="#0b1e44" stroke-width="${sw}"/>
${flat.seams.map(([a, b, c, d]) => `<line x1="${a}" y1="${H - b}" x2="${c}" y2="${H - d}" stroke="${file ? '#fff' : '#eef3f9'}" stroke-width="${sw * 1.6}"/>`).join('')}
${flat.bendLines.map((l) => `<line x1="${l.x1}" y1="${H - l.y1}" x2="${l.x2}" y2="${H - l.y2}" stroke="#d64545" stroke-width="${sw}" stroke-dasharray="${sw * 6} ${sw * 4}"/>`).join('')}
${flat.holes.map((h) => `<circle cx="${h.x}" cy="${H - h.y}" r="${h.diameter / 2}" fill="${h.hardware ? '#ffe2b3' : '#fff'}" stroke="#0b1e44" stroke-width="${sw}"/>`).join('')}
</svg>`;
}

/** Liste des perçages (CSV, séparateur « ; » pour Excel FR) : programmation poinçonneuse, poste de sertissage. */
export function holesCsv(spec: PartSpec): string {
  const flat = unfold(spec);
  const onFlat = new Map(flat.holes.map((h) => [h.id, h]));
  const d = (x: number) => fr(x, 2).replace(/\s/g, '');
  const rows = [['N°', 'Face', 'X face (mm)', 'Y face (mm)', 'X flan (mm)', 'Y flan (mm)', 'Diamètre (mm)', 'Insert', 'Filetage', 'Épaisseur mini (mm)', 'Remarque']];
  spec.holes.forEach((h, i) => {
    const f = onFlat.get(h.id);
    rows.push([
      String(i + 1), FACE_LABEL[h.face ?? 'base'], d(h.x), d(h.y), f ? d(f.x) : '', f ? d(f.y) : '', d(h.diameter),
      h.hardware ? HARDWARE_LABEL[h.hardware.kind] : '', h.hardware?.thread ?? '', h.hardware ? d(preHole(h.hardware).minThickness) : '',
      f ? '' : 'Dans la zone de pliage : non découpé, à revoir',
    ]);
  });
  return '﻿' + rows.map((r) => r.map((c) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(';')).join('\r\n') + '\r\n';
}

// --- Pages imprimables ------------------------------------------------------------------------

const SHEET_CSS = `
@page { size: A4; margin: 12mm; }
* { box-sizing: border-box; }
body { margin: 0; font: 12px/1.45 Roboto, Arial, sans-serif; color: #1d2433; background: #f5f6f8; }
.sheet { max-width: 190mm; margin: 0 auto; padding: 14mm; background: #fff; }
.bar { position: sticky; top: 0; display: flex; justify-content: center; gap: 10px; padding: 10px; background: #0b1e44; }
.bar button { padding: 10px 18px; border: 0; border-radius: 999px; background: #00a2a3; color: #fff; font: 600 14px Arial; cursor: pointer; }
header { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; padding-bottom: 14px; border-bottom: 2px solid #0b1e44; }
header img { height: 46px; }
header .ref { text-align: right; }
header h1 { margin: 0; font-size: 20px; color: #0b1e44; }
h2.t { margin: 18px 0 6px; font-size: 13px; color: #0b1e44; }
.muted { color: #5b6577; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 14px 0; }
.box { padding: 12px 14px; border: 1px solid #e1e5ec; border-radius: 10px; break-inside: avoid; }
.box h2 { margin: 0 0 6px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: #5b6577; }
.pic { display: grid; place-items: center; background: linear-gradient(#eef3f9, #c9d6e6); border-radius: 10px; min-height: 150px; overflow: hidden; }
.pic img { max-width: 100%; display: block; }
.pic svg { width: 100%; max-height: 220px; }
table { width: 100%; border-collapse: collapse; }
.spec th { width: 40%; text-align: left; font-weight: 500; color: #5b6577; padding: 3px 0; vertical-align: top; }
.spec td { padding: 3px 0; }
.price th, .price td { padding: 6px; border-bottom: 1px solid #e1e5ec; text-align: left; vertical-align: top; }
.price th { font-size: 10px; text-transform: uppercase; color: #5b6577; }
.n { text-align: right !important; white-space: nowrap; }
.tot td { border: 0; padding: 4px 6px; }
.tot tr:last-child td { font-size: 15px; font-weight: 700; color: #0b1e44; border-top: 2px solid #0b1e44; padding-top: 8px; }
.note { margin-top: 14px; padding: 10px 12px; border-radius: 10px; background: #fff4e5; color: #8a5300; }
.note.ok { background: #e5f5ee; color: #16794c; }
.op { display: grid; grid-template-columns: 34px 1fr; gap: 10px; padding: 10px 0; border-bottom: 1px solid #e1e5ec; break-inside: avoid; }
.op b.num { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: #0b1e44; color: #fff; }
.op h3 { margin: 2px 0 4px; font-size: 13px; color: #0b1e44; }
.op p { margin: 2px 0; }
.check { display: inline-block; width: 11px; height: 11px; border: 1.5px solid #0b1e44; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }
footer { margin-top: 22px; padding-top: 10px; border-top: 1px solid #e1e5ec; font-size: 10px; color: #5b6577; }
@media print { body { background: #fff; } .bar { display: none; } .sheet { padding: 0; } }
`;

/** Ouvre une page A4 dans un nouvel onglet, avec la fenêtre d'impression (choisir « Enregistrer en PDF »). */
function openPrintable(title: string, body: string) {
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${SHEET_CSS}</style></head><body>
<div class="bar"><button onclick="print()">Imprimer / Enregistrer en PDF</button></div>
<div class="sheet">${body}<footer>Tôlerie Rémond · tolerie-remond.com · Document généré le ${date(new Date().toISOString())}</footer></div>
<script>window.addEventListener('load', () => setTimeout(() => print(), 300));</script>
</body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const w = window.open(url, '_blank');
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  // Onglet bloqué par le navigateur : on télécharge la page, à ouvrir puis imprimer en PDF.
  if (!w) download(`${title}.html`, html, 'text/html');
  return !!w;
}

export interface SheetInput {
  reference: string;
  revision?: number;
  date: string;
  contact: ClientContact;
  spec: PartSpec;
  /** Devis tel que vu par le client à l'envoi ; recalculé sinon. */
  quote?: Quote;
  order?: ClientOrder;
  image?: string;
  logoUrl: string;
  /** Message du client à l'envoi. */
  message?: string;
}

const contactHtml = (c: ClientContact) => {
  const where = c.pickup ? 'Retrait à l’atelier (Crépand)' : [c.address, [c.zip, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return `${c.company ? `<b>${esc(c.company)}</b><br>` : ''}${c.name ? `${esc(c.name)}<br>` : ''}${esc(c.email)}${c.phone ? `<br>${esc(c.phone)}` : ''}${where ? `<br>Livraison : ${esc(where)}` : ''}`;
};

/** Nomenclature des tôles d'un produit assemblé (tableau HTML des fiches). */
const nomenclatureHtml = (spec: PartSpec) =>
  `<table class="price"><thead><tr><th>Repère</th><th>Désignation</th><th class="n">Développé</th><th class="n">Plis</th><th class="n">Contre-plis</th><th class="n">Trous</th></tr></thead><tbody>${sheetParts(spec)
    .map((x) => `<tr><td>${esc(x.id)}</td><td>${esc(x.label)}</td><td class="n">${x.a} × ${x.b} mm</td><td class="n">${x.bends}</td><td class="n">${x.hems}</td><td class="n">${x.pierces - 1}</td></tr>`)
    .join('')}</tbody></table>`;

/** Fiche devis A4 pour le client. */
export function openQuoteSheet(s: SheetInput) {
  const product = s.spec.product;
  const flat = product ? productFlat(s.spec) : s.spec.imported ? importedFlat(s.spec) : unfold(s.spec);
  const q = s.quote ?? (product ? productQuote(s.spec) : computeQuote(s.spec, flat));
  const final = s.order?.price.final ? s.order.price : null;
  const subtotal = final ? final.subtotal : q.subtotal;
  const vat = subtotal * 0.2;
  const rows = specRecap(s.spec).map((l) => `<tr><th>${esc(l.label)}</th><td>${esc(l.value)}</td></tr>`).join('');
  const lines = final
    ? `<tr><td>Prix définitif validé par l’atelier</td><td>${final.quantity} × ${eur(final.unitPrice)}</td><td class="n">${eur(final.subtotal)}</td></tr>`
    : q.lines.map((l) => `<tr><td>${esc(l.label)}</td><td>${esc(l.detail)}</td><td class="n">${eur(l.amount)}</td></tr>`).join('');
  return openPrintable(`Devis ${s.reference}`, `
<header>
  <img src="${esc(s.logoUrl)}" alt="Tôlerie Rémond">
  <div class="ref"><h1>${final ? 'Devis' : 'Estimation'} ${esc(s.reference)}</h1>
  <div class="muted">${s.revision ? `Version ${s.revision} · ` : ''}${date(s.date)}${s.order ? ` · ${esc(STATUS_LABEL[s.order.status])}` : ''}</div></div>
</header>
<div class="grid">
  <div class="box"><h2>Client</h2>${contactHtml(s.contact)}</div>
  <div class="box"><h2>Délais</h2>
    Fabrication : ${s.order?.leadTimeDays ?? q.leadTimeDays} jours ouvrés après validation<br>
    ${s.order?.shipDate ? `Expédition prévue : ${date(s.order.shipDate)}<br>` : ''}${s.order?.deliveryDate ? `Livraison prévue : ${date(s.order.deliveryDate)}` : ''}
  </div>
</div>
<div class="grid">
  <div><div class="pic">${s.image ? `<img src="${esc(s.image)}" alt="">` : ''}</div></div>
  <div class="box"><h2>${esc(s.spec.name)}</h2><table class="spec">${rows}
    ${product ? `<tr><th>Tôlerie</th><td>${sheetParts(s.spec).length} tôles · ${fr(flat.mass, 1)} kg par ensemble</td></tr>` : `<tr><th>Flan</th><td>${fr(flat.blankWidth)} × ${fr(flat.blankHeight)} mm · ${fr(flat.mass, 2)} kg / pièce</td></tr>`}</table></div>
</div>
${product || s.spec.imported ? '' : `<div class="box"><h2>Patron déplié</h2><div class="pic" style="background:#fff">${flatSvg(s.spec)}</div></div>`}
<h2 class="t">Détail du prix (${s.spec.quantity} pièce${s.spec.quantity > 1 ? 's' : ''})</h2>
<table class="price"><thead><tr><th>Poste</th><th>Détail</th><th class="n">Montant HT</th></tr></thead><tbody>${lines}</tbody></table>
<table class="tot" style="width:46%;margin-left:auto;margin-top:8px">
  <tr><td>Total HT</td><td class="n">${eur(subtotal)}</td></tr>
  <tr><td>TVA 20 %</td><td class="n">${eur(vat)}</td></tr>
  <tr><td>Total TTC</td><td class="n">${eur(subtotal + vat)}</td></tr>
</table>
<p class="note ${final ? 'ok' : ''}">${final ? 'Prix définitif validé par l’atelier.' : 'Estimation indicative calculée en ligne : un technicien vérifie les cotes, la faisabilité et le prix avant le devis définitif.'}</p>`);
}

const SIDE: Record<string, string> = { nord: 'arrière', sud: 'avant', est: 'droite', ouest: 'gauche' };

/**
 * Fiche de fabrication (atelier) : la gamme poste par poste — découpe laser / poinçonnage, ébavurage,
 * sertissage et taraudage, pliage, soudure, finition, contrôle — avec toutes les cotes utiles.
 */
export function openFabricationSheet(s: SheetInput) {
  const spec = s.spec;
  if (spec.product) return openProductFabrication(s);
  const flat = unfold(spec);
  const mat = MATERIALS[spec.material];
  const nesting = nest(flat, spec.quantity, mat, spec.thickness);
  const hw = hardwareList(spec);
  const lost = spec.holes.length - flat.holes.length;
  const adjacent = (['nord', 'sud'] as const).flatMap((a) => (['est', 'ouest'] as const).filter((b) => spec.flanges.some((f) => f.edge === a && f.height > 0) && spec.flanges.some((f) => f.edge === b && f.height > 0)).map((b) => `${SIDE[a]}-${SIDE[b]}`));
  const R = spec.innerRadius ?? spec.thickness;
  // Ordre de pliage proposé : les ailes courtes d'abord, puis les longues (à valider par le régleur).
  const bends = [...flat.bendLines].sort((a, b) => Math.hypot(a.x2 - a.x1, a.y2 - a.y1) - Math.hypot(b.x2 - b.x1, b.y2 - b.y1));
  const flangeOf = (e: string) => spec.flanges.find((f) => f.edge === e);
  const warn: string[] = [];
  if (lost > 0) warn.push(`${lost} perçage${lost > 1 ? 's' : ''} dans une zone de pliage : non découpé${lost > 1 ? 's' : ''}, à revoir avec le client.`);
  for (const x of hw) if (spec.thickness < x.minThickness) warn.push(`${HARDWARE_LABEL[x.kind]} ${x.thread} : tôle de ${fr(spec.thickness)} mm sous le minimum de ${fr(x.minThickness)} mm.`);
  for (const f of spec.flanges) if (f.height > 0 && f.height < Math.max(3 * spec.thickness + R, 6)) warn.push(`Aile ${SIDE[f.edge]} de ${fr(f.height)} mm : très courte pour l’outillage de pliage, vérifier la faisabilité.`);
  if (s.order?.missing.length) warn.push(`Non confirmé par le client : ${s.order.missing.join(', ')}.`);
  let k = 0;
  const op = (title: string, body: string) => `<div class="op"><b class="num">${++k}</b><div><h3><span class="check"></span>${title}</h3>${body}</div></div>`;
  const holeRows = spec.holes.map((h, i) => {
    const f = flat.holes.find((x) => x.id === h.id);
    return `<tr><td>${i + 1}</td><td>${FACE_LABEL[h.face ?? 'base']}</td><td class="n">${fr(h.x, 2)}</td><td class="n">${fr(h.y, 2)}</td><td class="n">${f ? `${fr(f.x, 2)} / ${fr(f.y, 2)}` : '—'}</td><td class="n">Ø${fr(h.diameter, 2)}</td><td>${h.hardware ? `${HARDWARE_LABEL[h.hardware.kind]} ${h.hardware.thread}` : ''}</td></tr>`;
  }).join('');

  return openPrintable(`Fabrication ${s.reference}`, `
<header>
  <img src="${esc(s.logoUrl)}" alt="Tôlerie Rémond">
  <div class="ref"><h1>Fiche de fabrication ${esc(s.reference)}</h1>
  <div class="muted">${esc(spec.name)}${s.revision ? ` · version ${s.revision}` : ''} · ${date(s.date)}</div></div>
</header>
<div class="grid">
  <div class="box"><h2>Lot</h2><table class="spec">
    <tr><th>Quantité</th><td><b>${spec.quantity} pièce${spec.quantity > 1 ? 's' : ''}</b></td></tr>
    <tr><th>Matière</th><td>${esc(mat?.label ?? spec.material)}</td></tr>
    <tr><th>Épaisseur</th><td>${fr(spec.thickness)} mm</td></tr>
    <tr><th>Finition</th><td>${esc(FINISHES[spec.finish]?.label ?? spec.finish)}${spec.ral ? ` RAL ${esc(spec.ral)}` : ''}</td></tr>
    <tr><th>Masse</th><td>${fr(flat.mass, 3)} kg / pièce · ${fr(flat.mass * spec.quantity, 1)} kg le lot</td></tr>
  </table></div>
  <div class="box"><h2>Client</h2>${contactHtml(s.contact)}${s.message ? `<p class="muted" style="margin:8px 0 0">« ${esc(s.message)} »</p>` : ''}
    ${s.order?.deliveryDate ? `<p style="margin:8px 0 0">Livraison prévue : <b>${date(s.order.deliveryDate)}</b></p>` : ''}</div>
</div>
<div class="grid">
  <div><div class="pic">${s.image ? `<img src="${esc(s.image)}" alt="">` : ''}</div></div>
  <div class="box"><h2>Pièce finie</h2><table class="spec">${specRecap(spec).filter((l) => l.label !== 'Quantité' && l.label !== 'Matière' && l.label !== 'Finition').map((l) => `<tr><th>${esc(l.label)}</th><td>${esc(l.value)}</td></tr>`).join('')}</table></div>
</div>
${warn.length ? `<p class="note"><b>Points d’attention</b><br>${warn.map(esc).join('<br>')}</p>` : ''}

<h2 class="t">Gamme de fabrication</h2>
${op('Débit : découpe laser ou poinçonnage', `
  <p>Flan <b>${fr(flat.blankWidth, 2)} × ${fr(flat.blankHeight, 2)} mm</b> · surface nette ${fr(flat.area / 1e6, 4)} m² · ${flat.pierces} amorçage${flat.pierces > 1 ? 's' : ''} · ${fr(flat.cutLength / 1000, 2)} m de coupe / pièce.</p>
  <p>Imbrication : tôle <b>${esc(nesting.sheet.label)}</b> · ${nesting.perSheet} pièce${nesting.perSheet > 1 ? 's' : ''} / tôle · <b>${nesting.sheets} tôle${nesting.sheets > 1 ? 's' : ''}</b> · utilisation ${fr(nesting.utilisation * 100, 0)} % · écart ${fr(nesting.gap)} mm, marge ${fr(nesting.margin)} mm.</p>
  <p class="muted">Programme : fichier DXF (calque DECOUPE = contour et perçages, PLIAGE = axes de pli à marquer, TEXTE = consignes).</p>`)}
${op('Ébavurage', '<p>Ébavurer contour et perçages avant pliage.</p>')}
${hw.length ? op('Goujonnage, sertissage et taraudage (avant pliage)', `<table class="price"><thead><tr><th>Opération</th><th>Filetage</th><th class="n">Pré-trou</th><th class="n">Tôle mini</th><th class="n">Par pièce</th><th class="n">Lot</th></tr></thead><tbody>${hw.map((x) => `<tr><td>${HARDWARE_LABEL[x.kind]}</td><td>${x.thread}</td><td class="n">Ø${fr(x.hole, 2)}</td><td class="n">${fr(x.minThickness)} mm</td><td class="n">${x.count}</td><td class="n">${x.count * spec.quantity}</td></tr>`).join('')}</tbody></table>`) : ''}
${flat.bendLines.length ? op('Pliage', `<table class="price"><thead><tr><th>Ordre</th><th>Aile</th><th class="n">Angle</th><th class="n">Rayon int.</th><th class="n">Hauteur ext.</th><th class="n">Long. pli</th><th class="n">Déduction</th></tr></thead><tbody>${bends.map((b, i) => `<tr><td>${i + 1}</td><td>${SIDE[b.edge]}</td><td class="n">${fr(b.angle)}°</td><td class="n">R${fr(b.innerRadius, 2)}</td><td class="n">${fr(flangeOf(b.edge)?.height ?? 0)} mm</td><td class="n">${fr(Math.hypot(b.x2 - b.x1, b.y2 - b.y1))} mm</td><td class="n">${fr(b.bendDeduction, 2)} mm</td></tr>`).join('')}</tbody></table>
  <p class="muted">Tous les plis vers le haut (même sens). Ordre proposé : plis courts d’abord, à valider au réglage. Facteur K ${fr(mat?.kFactor ?? 0.4, 2)}.</p>`) : ''}
${op('Soudure / assemblage', adjacent.length ? `<p>${adjacent.length} angle${adjacent.length > 1 ? 's' : ''} entre ailes voisines (${adjacent.join(', ')}), dégagement d’angle prévu au flan : <b>souder (TIG/MIG) ou laisser ouvert selon le besoin client</b>.</p>` : '<p>Aucune soudure prévue.</p>')}
${spec.finish !== 'brut' ? op(`Finition : ${esc(FINISHES[spec.finish]?.label ?? spec.finish)}${spec.ral ? ` RAL ${esc(spec.ral)}` : ''}`, `<p>${fr((flat.area / 1e6) * 2 * spec.quantity, 2)} m² développés (deux faces) pour le lot.</p>`) : ''}
${op('Contrôle', `<p>Contrôle dimensionnel premier article : base ${fr(spec.width)} × ${fr(spec.depth)} mm${spec.flanges.length ? `, ailes ${spec.flanges.map((f) => `${SIDE[f.edge]} ${fr(f.height)} mm à ${fr(f.angle)}°`).join(', ')}` : ''}${hw.length ? ', tenue des inserts' : ''}.</p>`)}

<div class="box" style="margin-top:14px"><h2>Patron déplié (perçages équipés en orange)</h2><div class="pic" style="background:#fff">${flatSvg(spec)}</div></div>
${spec.holes.length ? `<h2 class="t">Perçages</h2><table class="price"><thead><tr><th>N°</th><th>Face</th><th class="n">X</th><th class="n">Y</th><th class="n">Flan X / Y</th><th class="n">Ø</th><th>Insert</th></tr></thead><tbody>${holeRows}</tbody></table>` : ''}`);
}

/** Fiche de fabrication d'un produit assemblé : nomenclature des tôles, puis la gamme d'assemblage. */
function openProductFabrication(s: SheetInput) {
  const spec = s.spec;
  const p = spec.product!;
  const def = PRODUCTS[p.kind];
  const model = productModel(p, spec.thickness);
  const flat = productFlat(spec);
  const parts = sheetParts(spec);
  const mat = MATERIALS[spec.material];
  const ouvrants = model.motions.filter((m) => !m.auto);
  const bought = model.panels.filter((x) => !x.sheet);
  const boughtList = [...new Map(bought.map((x) => [x.label, bought.filter((y) => y.label === x.label).length])).entries()];
  let k = 0;
  const op = (title: string, body: string) => `<div class="op"><b class="num">${++k}</b><div><h3><span class="check"></span>${title}</h3>${body}</div></div>`;
  return openPrintable(`Fabrication ${s.reference}`, `
<header>
  <img src="${esc(s.logoUrl)}" alt="Tôlerie Rémond">
  <div class="ref"><h1>Fiche de fabrication ${esc(s.reference)}</h1>
  <div class="muted">${esc(def.label)}${s.revision ? ` · version ${s.revision}` : ''} · ${date(s.date)}</div></div>
</header>
<div class="grid">
  <div class="box"><h2>Lot</h2><table class="spec">
    <tr><th>Quantité</th><td><b>${spec.quantity} ensemble${spec.quantity > 1 ? 's' : ''}</b></td></tr>
    <tr><th>Encombrement</th><td>${fr(p.width)} × ${fr(p.height)} × ${fr(p.depth)} mm (L × H × P)</td></tr>
    <tr><th>Matière</th><td>${esc(mat?.label ?? spec.material)}, ép. ${fr(spec.thickness)} mm</td></tr>
    <tr><th>Finition</th><td>${esc(FINISHES[spec.finish]?.label ?? spec.finish)}${spec.ral ? ` RAL ${esc(spec.ral)}` : ''}</td></tr>
    <tr><th>Masse tôlerie</th><td>${fr(flat.mass, 1)} kg / ensemble</td></tr>
  </table></div>
  <div class="box"><h2>Client</h2>${contactHtml(s.contact)}${s.message ? `<p class="muted" style="margin:8px 0 0">« ${esc(s.message)} »</p>` : ''}</div>
</div>
<div class="grid">
  <div><div class="pic">${s.image ? `<img src="${esc(s.image)}" alt="">` : ''}</div></div>
  <div class="box"><h2>Équipement</h2><table class="spec">${specRecap(spec).filter((l) => l.label === 'Équipement' || l.label === 'Produit').map((l) => `<tr><th>${esc(l.label)}</th><td>${esc(l.value)}</td></tr>`).join('')}</table></div>
</div>
<h2 class="t">Nomenclature des tôles (${parts.length})</h2>
${nomenclatureHtml(spec)}
<h2 class="t">Gamme de fabrication</h2>
${op('Débit : découpe laser / poinçonnage', `<p>${parts.length} tôles · ${fr(flat.cutLength / 1000, 1)} m de coupe par ensemble · développés ci-dessus (à confirmer au bureau d’études).</p>`)}
${op('Pliage', `<p>${flat.bendLines.length} plis et ${parts.reduce((t, x) => t + x.hems, 0)} contre-plis par ensemble, rayon intérieur R${fr(spec.innerRadius ?? spec.thickness)} mm, facteur K ${fr(mat?.kFactor ?? 0.4, 2)}. Développés calculés avec la déduction de pli ; contre-plis : pli aigu puis écrasement.</p>`)}
${op('Soudure et assemblage', `<p>Assembler la structure (soudure TIG/MIG ou rivetage selon plan), puis monter les ouvrants : ${ouvrants.map((m) => esc(m.label)).join(', ') || 'aucun'}.</p>`)}
${op('Quincaillerie et composants', `<p>${ouvrants.length} ouvrant${ouvrants.length > 1 ? 's' : ''} : charnières, fermetures, coulisses.</p>${boughtList.length ? `<p class="muted">Composants à approvisionner ou fournis par le client : ${boughtList.map(([l, n]) => `${esc(l)}${n > 1 ? ` × ${n}` : ''}`).join(', ')}.</p>` : ''}`)}
${spec.finish !== 'brut' ? op(`Finition : ${esc(FINISHES[spec.finish]?.label ?? spec.finish)}${spec.ral ? ` RAL ${esc(spec.ral)}` : ''}`, `<p>${fr((flat.area / 1e6) * 2 * spec.quantity, 1)} m² développés (deux faces) pour le lot.</p>`) : ''}
${op('Contrôle et essais', `<p>Contrôle de l’encombrement ${fr(p.width)} × ${fr(p.height)} × ${fr(p.depth)} mm, équerrage, jeu et fermeture de chaque ouvrant, essai de mise en marche si l’électronique est montée à l’atelier.</p>`)}`);
}
