// Import de fichiers CAO dans le navigateur : STEP / IGES / BREP (noyau OpenCascade compilé en WebAssembly),
// STL, OBJ et DXF (profil plat extrudé à l'épaisseur). Le modèle devient la pièce affichée en 3D ; on en tire
// l'encombrement, la surface, une épaisseur et un nombre de plis estimés pour le chiffrage.
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import type { FlatPattern, ImportedModel, PartSpec } from './types';
import { MATERIALS } from './catalog';

/** Fichiers joints au chat, gardés en mémoire le temps de la session (id de la pièce jointe → fichier). */
export const attachmentFiles = new Map<string, File>();

/** Géométries importées (id → maillage en mm, Z en haut comme en CAO). Perdues au rechargement de la page. */
const meshes = new Map<string, THREE.BufferGeometry>();
export const importedGeometry = (id: string) => meshes.get(id);

export const IMPORTABLE = /\.(step|stp|iges|igs|brep|brp|stl|obj|dxf)$/i;

type Occt = {
  ReadStepFile: (b: Uint8Array, p: unknown) => OcctResult;
  ReadIgesFile: (b: Uint8Array, p: unknown) => OcctResult;
  ReadBrepFile: (b: Uint8Array, p: unknown) => OcctResult;
};
type OcctResult = { success: boolean; meshes: { attributes: { position: { array: number[] } }; index?: { array: number[] } }[] };
let occt: Promise<Occt> | null = null;
/** Le noyau OpenCascade (~7 Mo) n'est chargé qu'au premier fichier STEP / IGES. */
function loadOcct(): Promise<Occt> {
  occt ??= Promise.all([import('occt-import-js'), import('occt-import-js/dist/occt-import-js.wasm?url')]).then(([m, wasm]) =>
    (m.default as (o: object) => Promise<Occt>)({ locateFile: () => wasm.default }),
  );
  return occt;
}

async function readOcct(file: File, ext: string): Promise<THREE.BufferGeometry> {
  const lib = await loadOcct();
  const buf = new Uint8Array(await file.arrayBuffer());
  const params = { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.002, angularDeflection: 0.4 };
  const res = ext === 'step' || ext === 'stp' ? lib.ReadStepFile(buf, params) : ext === 'brep' || ext === 'brp' ? lib.ReadBrepFile(buf, null) : lib.ReadIgesFile(buf, params);
  if (!res.success || !res.meshes.length) throw new Error('Le fichier ne contient pas de solide lisible.');
  const pos: number[] = [];
  for (const m of res.meshes) {
    const p = m.attributes.position.array;
    const idx = m.index?.array ?? [...Array(p.length / 3).keys()];
    for (const i of idx) pos.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

function readObj(text: string): THREE.BufferGeometry {
  const pos: number[] = [];
  new OBJLoader().parse(text).traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const g = (o.geometry as THREE.BufferGeometry).index ? (o.geometry as THREE.BufferGeometry).toNonIndexed() : (o.geometry as THREE.BufferGeometry);
    pos.push(...(g.getAttribute('position').array as Float32Array));
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

// --- DXF : profil plat (contour + perçages) -------------------------------------------------------

type Seg = { a: THREE.Vector2; b: THREE.Vector2; pts: THREE.Vector2[] };
export interface DxfProfile {
  outline: THREE.Vector2[];
  holes: THREE.Vector2[][];
  circles: { c: THREE.Vector2; r: number }[];
}

/** Lit les entités LINE, ARC, CIRCLE, LWPOLYLINE d'un DXF (mm) et reconstitue le contour extérieur et les trous. */
export function parseDxf(text: string): DxfProfile {
  const lines = text.split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1].trim()]);
  const segs: Seg[] = [];
  const circles: { c: THREE.Vector2; r: number }[] = [];
  const closed: THREE.Vector2[][] = [];
  let i = pairs.findIndex(([c, v]) => c === 2 && v === 'ENTITIES');
  if (i < 0) i = 0;
  while (i < pairs.length) {
    const [code, val] = pairs[i];
    if (code !== 0) { i++; continue; }
    const type = val;
    const start = ++i;
    while (i < pairs.length && pairs[i][0] !== 0) i++;
    const g = pairs.slice(start, i);
    const num = (c: number, k = 0) => parseFloat(g.filter(([x]) => x === c)[k]?.[1] ?? 'NaN');
    if (type === 'LINE') {
      const a = new THREE.Vector2(num(10), num(20));
      const b = new THREE.Vector2(num(11), num(21));
      segs.push({ a, b, pts: [a, b] });
    } else if (type === 'CIRCLE') circles.push({ c: new THREE.Vector2(num(10), num(20)), r: num(40) });
    else if (type === 'ARC') {
      const c = new THREE.Vector2(num(10), num(20));
      const r = num(40);
      let a0 = THREE.MathUtils.degToRad(num(50));
      const a1 = THREE.MathUtils.degToRad(num(51));
      if (a1 < a0) a0 -= Math.PI * 2;
      const n = Math.max(4, Math.ceil(((a1 - a0) * r) / 3));
      const pts = Array.from({ length: n + 1 }, (_, k) => new THREE.Vector2(c.x + r * Math.cos(a0 + ((a1 - a0) * k) / n), c.y + r * Math.sin(a0 + ((a1 - a0) * k) / n)));
      segs.push({ a: pts[0], b: pts[n], pts });
    } else if (type === 'LWPOLYLINE') {
      const xs = g.filter(([x]) => x === 10).map(([, v]) => parseFloat(v));
      const ys = g.filter(([x]) => x === 20).map(([, v]) => parseFloat(v));
      const pts = xs.map((x, k) => new THREE.Vector2(x, ys[k]));
      const isClosed = (parseInt(g.find(([x]) => x === 70)?.[1] ?? '0', 10) & 1) === 1;
      if (isClosed && pts.length > 2) closed.push(pts);
      else if (pts.length > 1) segs.push({ a: pts[0], b: pts[pts.length - 1], pts });
    }
  }
  // Chaînage des segments bout à bout en boucles fermées.
  const tol = 0.05;
  const left = [...segs];
  while (left.length) {
    const loop = [...left.shift()!.pts];
    let grew = true;
    while (grew && loop[0].distanceTo(loop[loop.length - 1]) > tol) {
      grew = false;
      const end = loop[loop.length - 1];
      const k = left.findIndex((s) => s.a.distanceTo(end) < tol || s.b.distanceTo(end) < tol);
      if (k >= 0) {
        const s = left.splice(k, 1)[0];
        const pts = s.a.distanceTo(end) < tol ? s.pts : [...s.pts].reverse();
        loop.push(...pts.slice(1));
        grew = true;
      }
    }
    if (loop.length > 2 && loop[0].distanceTo(loop[loop.length - 1]) <= tol) closed.push(loop.slice(0, -1));
  }
  const area = (p: THREE.Vector2[]) => Math.abs(THREE.ShapeUtils.area(p));
  closed.sort((a, b) => area(b) - area(a));
  let outline = closed[0];
  const holes = closed.slice(1);
  if (!outline) {
    // Pas de contour : le plus grand cercle devient le disque.
    const big = [...circles].sort((a, b) => b.r - a.r)[0];
    if (!big) throw new Error('Aucun contour fermé trouvé dans le DXF.');
    circles.splice(circles.indexOf(big), 1);
    outline = Array.from({ length: 64 }, (_, k) => new THREE.Vector2(big.c.x + big.r * Math.cos((k / 64) * Math.PI * 2), big.c.y + big.r * Math.sin((k / 64) * Math.PI * 2)));
  }
  return { outline, holes, circles };
}

function dxfGeometry(prof: DxfProfile, t: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(prof.outline);
  for (const h of prof.holes) shape.holes.push(new THREE.Path(h));
  for (const c of prof.circles) {
    const p = new THREE.Path();
    p.absarc(c.c.x, c.c.y, c.r, 0, Math.PI * 2, true);
    shape.holes.push(p);
  }
  return new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 24 }).toNonIndexed();
}

// --- Mesures ------------------------------------------------------------------------------------

/**
 * Surface, volume, épaisseur et plis estimés d'un maillage de tôle : une tôle a deux grandes faces, donc
 * épaisseur ≈ 2 × volume / surface ; les plis se comptent par orientations de faces planes significatives.
 */
function measure(g: THREE.BufferGeometry) {
  const p = g.getAttribute('position');
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  let area = 0, vol = 0;
  const dirs = new Map<string, number>();
  for (let i = 0; i + 2 < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    n.subVectors(b, a).cross(c.clone().sub(a));
    const s = n.length() / 2;
    area += s;
    vol += a.dot(b.clone().cross(c)) / 6;
    if (s > 0) {
      n.normalize();
      // Orientation sans le sens (une face et son dos comptent pour une) : on force la 1re composante non nulle positive.
      const k = Math.abs(n.x) > 1e-3 ? Math.sign(n.x) : Math.abs(n.y) > 1e-3 ? Math.sign(n.y) : Math.sign(n.z) || 1;
      const key = [n.x * k, n.y * k, n.z * k].map((v) => Math.round(v * 12)).join(',');
      dirs.set(key, (dirs.get(key) ?? 0) + s);
    }
  }
  const planes = [...dirs.values()].filter((s) => s > area * 0.03).length;
  const thickness = Math.abs(vol) > 0 && area > 0 ? (2 * Math.abs(vol)) / area : 0;
  return { area, volume: Math.abs(vol), thickness, bends: Math.max(0, planes - 1) };
}

/** Lit le fichier, garde le maillage en mémoire et renvoie la fiche de la pièce importée. */
export async function importCad(file: File, thickness: number): Promise<ImportedModel> {
  const ext = file.name.split('.').pop()!.toLowerCase();
  let g: THREE.BufferGeometry;
  let profile: ImportedModel['profile'];
  if (['step', 'stp', 'iges', 'igs', 'brep', 'brp'].includes(ext)) g = await readOcct(file, ext);
  else if (ext === 'stl') g = new STLLoader().parse(await file.arrayBuffer());
  else if (ext === 'obj') g = readObj(await file.text());
  else if (ext === 'dxf') {
    const prof = parseDxf(await file.text());
    g = dxfGeometry(prof, thickness);
    const perim = (pts: THREE.Vector2[]) => pts.reduce((s, q, k) => s + q.distanceTo(pts[(k + 1) % pts.length]), 0);
    profile = {
      cut: perim(prof.outline) + prof.holes.reduce((s, h) => s + perim(h), 0) + prof.circles.reduce((s, c) => s + 2 * Math.PI * c.r, 0),
      pierces: 1 + prof.holes.length + prof.circles.length,
      area: Math.abs(THREE.ShapeUtils.area(prof.outline)) - prof.holes.reduce((s, h) => s + Math.abs(THREE.ShapeUtils.area(h)), 0) - prof.circles.reduce((s, c) => s + Math.PI * c.r * c.r, 0),
    };
  } else throw new Error(`Format .${ext} non lu dans le navigateur : envoyez un STEP, IGES, STL, OBJ ou DXF.`);
  if (g.index) g = g.toNonIndexed();
  g.computeBoundingBox();
  const box = g.boundingBox!;
  const size = box.getSize(new THREE.Vector3());
  if (!Number.isFinite(size.x) || size.length() < 1e-3) throw new Error('Le modèle est vide.');
  const m = measure(g);
  const id = crypto.randomUUID();
  // Centré, Z (haut en CAO) devient Y (haut à l'écran).
  g.translate(...box.getCenter(new THREE.Vector3()).negate().toArray());
  g.rotateX(-Math.PI / 2);
  g.computeVertexNormals();
  meshes.set(id, g);
  return {
    id,
    name: file.name,
    format: ext.toUpperCase(),
    size: [Math.round(size.x * 10) / 10, Math.round(size.y * 10) / 10, Math.round(size.z * 10) / 10],
    area: Math.round(m.area),
    triangles: g.getAttribute('position').count / 3,
    thickness: profile ? thickness : Math.round(m.thickness * 10) / 10,
    bends: profile ? 0 : m.bends,
    profile,
  };
}

/** Rappel au format FlatPattern d'une pièce importée, pour le chiffrage et les écrans existants. */
export function importedFlat(spec: PartSpec): FlatPattern {
  const im = spec.imported!;
  const [a, b] = [...im.size].sort((x, y) => y - x);
  // Surface de tôle : profil DXF exact, sinon la moitié de la surface du solide (deux grandes faces par tôle).
  const area = im.profile?.area ?? im.area / 2;
  const cut = im.profile?.cut ?? 2 * (a + b) * 1.3;
  return {
    outline: [[0, 0], [a, 0], [a, b], [0, b]],
    faces: [],
    seams: [],
    holes: [],
    bendLines: Array.from({ length: im.bends }, () => ({ x1: 0, y1: 0, x2: 0, y2: 0, edge: 'nord' as const, angle: 90, innerRadius: spec.thickness, bendAllowance: 0, bendDeduction: 0 })),
    blankWidth: a,
    blankHeight: b,
    area,
    cutLength: cut,
    pierces: im.profile?.pierces ?? 4,
    mass: (area * spec.thickness * MATERIALS[spec.material].density) / 1e6,
    notes: [`Fichier ${im.name} (${im.format}) : ${im.triangles.toLocaleString('fr-FR')} triangles`],
  };
}
