// Construit la pièce en three.js à partir de PartSpec.
// Repère pièce : base dans le plan XY (coin sud-ouest extérieur en 0,0), plis vers +Z.
// Le groupe renvoyé est tourné pour que Z pièce = Y three (le haut à l'écran).
import * as THREE from 'three';
import type { Edge, PartSpec, MaterialId, FinishId } from './types';
import { clipPolygon, cornerRelief, faceToCanonical, facePolygon, holeKept, holesOn, type Pt } from './faces';
import { MATERIALS } from './catalog';
import type { Face } from './types';

/** Zone cliquable : base ou aile d'une pièce pliée, ou panneau d'un produit assemblé. */
export type Region = 'base' | `aile-${Edge}` | `panel:${string}`;

const METAL: Record<MaterialId, { color: number; metalness: number; roughness: number }> = {
  acier: { color: 0x6f7780, metalness: 0.75, roughness: 0.42 },
  galva: { color: 0xb4bcc4, metalness: 0.85, roughness: 0.32 },
  inox304: { color: 0xc8cdd3, metalness: 0.95, roughness: 0.22 },
  inox316: { color: 0xc4cad1, metalness: 0.95, roughness: 0.2 },
  alu5754: { color: 0xd3d7dc, metalness: 0.8, roughness: 0.3 },
};

/** Quelques RAL courants ; les autres retombent sur un gris moyen. */
export const RAL: Record<string, number> = {
  '1013': 0xe3d9c6, '1023': 0xf0ca00, '2004': 0xe75b12, '3004': 0x6b1c23, '4005': 0x6c4675, '5002': 0x20214f, '6018': 0x48a43f, '6029': 0x20603d, '8017': 0x45322e, '9006': 0xa1a1a0,
  '1015': 0xe6d2b5, '3020': 0xcc0605, '5010': 0x0e294b, '5015': 0x2271b3, '6005': 0x0f4336,
  '7016': 0x383e42, '7035': 0xcbd0cc, '7037': 0x7d7f7d, '9005': 0x0a0a0a, '9010': 0xf1ece1, '9016': 0xf1f0ea,
};

export function partMaterial(material: MaterialId, finish: FinishId, ral?: string): THREE.MeshStandardMaterial {
  if (finish === 'epoxy') {
    const color = (ral && RAL[ral.replace(/\D/g, '')]) ?? 0x8c96a0;
    return new THREE.MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.55 });
  }
  const m = METAL[material];
  const mat = new THREE.MeshStandardMaterial({ color: m.color, metalness: m.metalness, roughness: m.roughness });
  if (finish === 'brossage') mat.roughness = 0.35;
  if (finish === 'anodisation') mat.color.offsetHSL(0, 0, 0.04);
  if (finish === 'galvanisation') mat.color.set(0xa9b2ba);
  return mat;
}

/** Longueur du bord de base sur lequel est posé un pli. */
export function edgeLength(spec: PartSpec, edge: Edge): number {
  return edge === 'nord' || edge === 'sud' ? spec.width : spec.depth;
}

/** Place le repère canonique d'un pli (bord le long de +X, extérieur vers +Y) sur le bon bord de la base. */
function edgeFrame(spec: PartSpec, edge: Edge): THREE.Group {
  const g = new THREE.Group();
  const { width: W, depth: D } = spec;
  if (edge === 'nord') g.position.set(0, D, 0);
  if (edge === 'sud') { g.position.set(W, 0, 0); g.rotation.z = Math.PI; }
  if (edge === 'est') { g.position.set(W, D, 0); g.rotation.z = -Math.PI / 2; }
  if (edge === 'ouest') { g.position.set(0, 0, 0); g.rotation.z = Math.PI / 2; }
  return g;
}

export interface DimLine {
  a: THREE.Vector3;
  b: THREE.Vector3;
  /** Décalage de la ligne de cote par rapport à l'objet. */
  offset: THREE.Vector3;
  label: string;
}

export interface BuiltPart {
  /** Groupe racine, centré et tourné Y-up. */
  root: THREE.Group;
  /** Plis (zone arrondie + aile), pour animer le dépliage : `update(1)` = plié, `update(0)` = à plat. */
  hinges: { pivot: THREE.Group; angle: number; update: (fold: number) => void }[];
  meshes: THREE.Mesh[];
  dims: DimLine[];
  /** Groupe des lignes de cote (dans le repère pièce). */
  dimGroup: THREE.Group;
  /** Repère pièce (avant centrage), pour convertir un point cliqué en cotes X/Y. */
  partFrame: THREE.Group;
  /** Repère 3D de chaque face : base = partFrame ; aile = son pivot (u le long du bord, v = hauteur, z = épaisseur). */
  faceFrames: Partial<Record<Face, THREE.Object3D>>;
  size: THREE.Vector3;
  /** Produit assemblé : mouvements et mise en marche. */
  product?: import('./productGeometry').ProductRuntime;
  dispose: () => void;
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString('fr-FR');

export function buildPart(spec: PartSpec, fold = 1): BuiltPart {
  const T = spec.thickness;
  const { width: W, depth: D } = spec;
  const material = partMaterial(spec.material, spec.finish, spec.ral);
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x0b1e44, transparent: true, opacity: 0.55 });
  const disposables: { dispose: () => void }[] = [material, edgeMat];
  const meshes: THREE.Mesh[] = [];

  const root = new THREE.Group();
  const frame = new THREE.Group();
  root.add(frame);

  const addMesh = (geo: THREE.BufferGeometry, region: Region, parent: THREE.Object3D) => {
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.region = region;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), edgeMat);
    mesh.add(edges);
    parent.add(mesh);
    meshes.push(mesh);
    disposables.push(geo, edges.geometry);
    return mesh;
  };

  // Plis arrondis : rayon intérieur R, recul extérieur s = (R+T)·tan(angle/2) de chaque côté de l'arête vive.
  const R = Math.max(spec.innerRadius ?? T, 0.1);
  const K = MATERIALS[spec.material]?.kFactor ?? 0.4;
  const bendOf = new Map(
    spec.flanges.filter((f) => f.height > 0).map((f) => {
      const a = THREE.MathUtils.degToRad(Math.min(Math.max(f.angle, 0.1), 179));
      return [f.edge, { a, setback: (R + T) * Math.tan(a / 2), neutral: (R + K * T) * a }] as const;
    }),
  );
  const setback = (e: Edge) => bendOf.get(e)?.setback ?? 0;
  // Angles entre deux ailes voisines : chacune s'arrête avant le coin, comme sur le flan (pas de chevauchement).
  const relief = Math.min(cornerRelief(T), W / 2, D / 2);
  const trimEnds = (face: Edge, poly: Pt[]): Pt[] => {
    const [a, b, L]: [Edge, Edge, number] = face === 'nord' || face === 'sud' ? ['ouest', 'est', W] : ['sud', 'nord', D];
    let p = poly;
    if (bendOf.has(a)) p = clipPolygon(p, ([x]) => x - relief);
    if (bendOf.has(b)) p = clipPolygon(p, ([x]) => L - relief - x);
    return p;
  };

  /** Partie plate d'une face : la base s'arrête au début de chaque pli, une aile commence à la fin du sien. */
  const flatPart = (face: Face, poly: Pt[]): Pt[] => {
    let p = poly;
    if (face === 'base') {
      p = clipPolygon(p, ([x]) => x - setback('ouest'));
      p = clipPolygon(p, ([x]) => W - setback('est') - x);
      p = clipPolygon(p, ([, y]) => y - setback('sud'));
      p = clipPolygon(p, ([, y]) => D - setback('nord') - y);
    } else p = clipPolygon(trimEnds(face, p), ([, y]) => y - setback(face));
    return p;
  };

  /** Partie plate d'une face (repère 3D de la face) avec ses perçages, extrudée sur l'épaisseur. */
  const faceGeometry = (face: Face): THREE.ExtrudeGeometry | null => {
    const poly = flatPart(face, facePolygon(spec, face)).map(([x, y]) => (face === 'base' ? [x, y] : faceToCanonical(spec, face, x, y)) as Pt);
    if (poly.length < 3) return null;
    const shape = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, y)));
    const [x0, x1, y0, y1] = face === 'base'
      ? [setback('ouest'), W - setback('est'), setback('sud'), D - setback('nord')]
      : [-Infinity, Infinity, setback(face), Infinity];
    for (const h of holesOn(spec, face)) {
      const r = h.diameter / 2;
      // Un perçage qui mord sur le pli n'est pas dessiné (le technicien le signalera).
      if (!holeKept(spec, h) || h.x - r < x0 || h.x + r > x1 || h.y - r < y0 || h.y + r > y1) continue;
      const [cx, cy] = face === 'base' ? [h.x, h.y] : faceToCanonical(spec, face, h.x, h.y);
      const path = new THREE.Path();
      path.absarc(cx, cy, r, 0, Math.PI * 2, true);
      shape.holes.push(path);
    }
    return new THREE.ExtrudeGeometry(shape, { depth: T, bevelEnabled: false, curveSegments: 40 });
  };

  /** Étendue du pli le long de son bord (repère canonique) : là où la base et l'aile ont toutes deux de la matière. */
  const bendSpan = (edge: Edge): [number, number] | null => {
    const L = edgeLength(spec, edge);
    const eps = 1e-6;
    const flange = trimEnds(edge, facePolygon(spec, edge)).filter(([, y]) => y < eps).map(([x]) => faceToCanonical(spec, edge, x, 0)[0]);
    const onEdge = ([x, y]: Pt) => (edge === 'nord' ? y > D - eps : edge === 'sud' ? y < eps : edge === 'est' ? x > W - eps : x < eps);
    const toU = ([x, y]: Pt) => (edge === 'nord' ? x : edge === 'sud' ? W - x : edge === 'est' ? D - y : y);
    const base = facePolygon(spec, 'base').filter(onEdge).map(toU);
    if (flange.length < 2 || base.length < 2) return null;
    const lo = Math.max(Math.min(...flange), Math.min(...base), 0);
    const hi = Math.min(Math.max(...flange), Math.max(...base), L);
    return hi - lo > 0.01 ? [lo, hi] : null;
  };

  /** Zone de pli : coque cylindrique (rayons R_f et R_f + T) balayant `phi`, le long de [u0, u1]. */
  const bendGeometry = (phi: number, rf: number, u0: number, u1: number) => {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, rf + T, -Math.PI / 2, -Math.PI / 2 + phi, false);
    shape.absarc(0, 0, rf, -Math.PI / 2 + phi, -Math.PI / 2, true);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: u1 - u0, bevelEnabled: false, curveSegments: 24 });
    // (forme x, forme y, extrusion) → (le long du bord, vers l'extérieur, vers le haut), centre de l'arc au-dessus de la base.
    geo.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, u0, 1, 0, 0, 0, 0, 1, 0, T + rf, 0, 0, 0, 1));
    return geo;
  };

  // Base : partie plate (après découpes), perçages en trous de forme.
  const faceFrames: BuiltPart['faceFrames'] = { base: frame };
  const baseGeo = faceGeometry('base');
  if (baseGeo) addMesh(baseGeo, 'base', frame);

  // Plis : zone arrondie puis aile (sa propre face, avec découpes et perçages).
  const hinges: BuiltPart['hinges'] = [];
  for (const f of spec.flanges) {
    const bend = bendOf.get(f.edge);
    if (!bend) continue;
    const holder = edgeFrame(spec, f.edge);
    const start = new THREE.Group();
    start.position.y = -bend.setback;
    holder.add(start);
    const pivot = new THREE.Group();
    start.add(pivot);
    // Le repère de la face garde ses cotes : la hauteur se mesure depuis l'arête vive, le plat commence à `setback`.
    const faceFrame = new THREE.Group();
    faceFrame.position.y = -bend.setback;
    pivot.add(faceFrame);
    faceFrames[f.edge] = faceFrame;
    const geo = faceGeometry(f.edge);
    if (geo) addMesh(geo, `aile-${f.edge}`, faceFrame);

    const span = bendSpan(f.edge);
    let arc: THREE.Mesh | null = null;
    let lastPhi = -1;
    const update = (fold: number) => {
      // Longueur de fibre neutre constante : plus l'angle est faible, plus le rayon est grand (à plat : ruban droit).
      const phi = Math.max(bend.a * fold, 0.02);
      if (Math.abs(phi - lastPhi) < 1e-4) return;
      lastPhi = phi;
      const rf = bend.neutral / phi - K * T;
      pivot.position.set(0, (T + rf) * Math.sin(phi), (T + rf) * (1 - Math.cos(phi)));
      pivot.rotation.x = phi;
      if (!span) return;
      const g = bendGeometry(phi, rf, span[0], span[1]);
      if (!arc) {
        arc = addMesh(g, `aile-${f.edge}`, start);
        arc.userData.bend = true;
      } else {
        arc.geometry.dispose();
        arc.geometry = g;
        const edges = arc.children[0] as THREE.LineSegments;
        edges.geometry.dispose();
        edges.geometry = new THREE.EdgesGeometry(g, 30);
      }
    };
    update(fold);
    frame.add(holder);
    hinges.push({ pivot, angle: f.angle, update });
  }

  // Inserts : écrou à sertir (collerette visible + fût dans le trou), goujon (tige filetée qui dépasse),
  // taraudage (filets dans le trou). Posés dans le repère de leur face, ils suivent le pliage.
  const hwMat = new THREE.MeshStandardMaterial({ color: 0xc9ced4, metalness: 0.9, roughness: 0.3 });
  const threadMat = new THREE.MeshStandardMaterial({ color: 0x8c949c, metalness: 0.85, roughness: 0.45 });
  disposables.push(hwMat, threadMat);
  /** Tube (anneau épais) d'axe Z, de z0 à z1. */
  const tube = (ri: number, ro: number, z0: number, z1: number) => {
    const g = new THREE.LatheGeometry([new THREE.Vector2(ri, z0), new THREE.Vector2(ro, z0), new THREE.Vector2(ro, z1), new THREE.Vector2(ri, z1), new THREE.Vector2(ri, z0)], 28);
    g.rotateX(Math.PI / 2);
    disposables.push(g);
    return g;
  };
  const PITCH: Record<string, number> = { M3: 0.5, M4: 0.7, M5: 0.8, M6: 1, M8: 1.25 };
  for (const h of spec.holes) {
    if (!h.hardware || !holeKept(spec, h)) continue;
    const face = h.face ?? 'base';
    const target = faceFrames[face];
    if (!target) continue;
    const [cx, cy] = face === 'base' ? [h.x, h.y] : faceToCanonical(spec, face, h.x, h.y);
    const d = parseInt(h.hardware.thread.slice(1), 10);
    const pitch = PITCH[h.hardware.thread] ?? 1;
    const g = new THREE.Group();
    g.position.set(cx, cy, 0);
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.z = z;
      m.castShadow = true;
      g.add(m);
    };
    const threads = (r: number, z0: number, z1: number, tubeR: number) => {
      const n = Math.min(24, Math.floor((z1 - z0) / pitch));
      for (let i = 0; i < n; i++) {
        const t = new THREE.TorusGeometry(r, tubeR, 5, 24);
        disposables.push(t);
        add(t, threadMat, z0 + pitch * (i + 0.5));
      }
    };
    if (h.hardware.kind === 'ecrou') {
      // Fût serti dans le trou, collerette au-dessus ; le taraudage de l'écrou est visible au centre.
      const collar = Math.max(1.5, d * 0.35);
      add(tube(d * 0.42, h.diameter / 2, 0, T), hwMat);
      add(tube(d * 0.42, d * 0.95, T, T + collar), hwMat);
      threads(d * 0.42, 0, T + collar, Math.max(0.12, pitch * 0.22));
    } else if (h.hardware.kind === 'goujon') {
      // Tête affleurante dessous, tige filetée qui dépasse de la face.
      const L = Math.max(10, d * 3);
      add(tube(0, d * 0.75, 0, Math.min(T, 1.2)), hwMat);
      const shank = new THREE.CylinderGeometry(d / 2 - pitch * 0.3, d / 2 - pitch * 0.3, L + T, 20);
      shank.rotateX(Math.PI / 2);
      shank.translate(0, 0, (L + T) / 2);
      disposables.push(shank);
      add(shank, hwMat);
      threads(d / 2 - pitch * 0.3, T, T + L, Math.max(0.15, pitch * 0.3));
    } else {
      // Taraudage : filets usinés dans la paroi du trou (perçage au Ø de taraudage, filet au Ø nominal).
      // Filets en relief dans la paroi du trou (à moitié dans la matière, comme un filet taillé).
      const tr = Math.max(0.12, pitch * 0.25);
      threads(h.diameter / 2 + tr * 0.3, 0, T, tr);
    }
    target.add(g);
  }

  // Cotes (repère pièce).
  const dims: DimLine[] = [];
  const gap = Math.max(W, D) * 0.12 + 10;
  dims.push({ a: new THREE.Vector3(0, 0, 0), b: new THREE.Vector3(W, 0, 0), offset: new THREE.Vector3(0, -gap, 0), label: `${fmt(W)}` });
  dims.push({ a: new THREE.Vector3(W, 0, 0), b: new THREE.Vector3(W, D, 0), offset: new THREE.Vector3(gap, 0, 0), label: `${fmt(D)}` });
  for (const f of spec.flanges) {
    const a = THREE.MathUtils.degToRad(f.angle);
    const up = new THREE.Vector3(0, Math.cos(a), Math.sin(a)).multiplyScalar(f.height);
    // point de départ : coin du bord, extérieur ; on cote le long de l'aile
    const start = new THREE.Vector3(0, 0, 0);
    const local = new THREE.Vector3(-gap * 0.5, 0, 0);
    const holder = edgeFrame(spec, f.edge);
    holder.updateMatrix();
    const rot = new THREE.Matrix4().extractRotation(holder.matrix);
    dims.push({
      a: start.clone().applyMatrix4(holder.matrix),
      b: start.clone().add(up).applyMatrix4(holder.matrix),
      offset: local.applyMatrix4(rot),
      label: `${fmt(f.height)}${f.angle !== 90 ? ` · ${fmt(f.angle)}°` : ''}`,
    });
  }
  const dimGroup = new THREE.Group();
  const dimMat = new THREE.LineBasicMaterial({ color: 0x00a2a3, depthTest: false, transparent: true });
  disposables.push(dimMat);
  for (const d of dims) {
    const a2 = d.a.clone().add(d.offset);
    const b2 = d.b.clone().add(d.offset);
    const pts = [d.a, a2, d.b, b2, a2, b2];
    // petites flèches : traits obliques aux extrémités
    const dir = b2.clone().sub(a2).normalize();
    const n = d.offset.clone().normalize();
    const tick = Math.max(W, D) * 0.015 + 2;
    for (const p of [a2, b2]) {
      pts.push(p.clone().addScaledVector(dir, -tick).addScaledVector(n, -tick), p.clone().addScaledVector(dir, tick).addScaledVector(n, tick));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    disposables.push(geo);
    const line = new THREE.LineSegments(geo, dimMat);
    line.renderOrder = 10;
    dimGroup.add(line);
  }
  frame.add(dimGroup);

  // Centrage + Y-up : (x, y, z) pièce → (x, z, -y) three.
  const maxH = spec.flanges.reduce((m, f) => Math.max(m, f.height), T);
  frame.position.set(-W / 2, -D / 2, 0);
  root.rotation.x = -Math.PI / 2;
  root.position.y = -maxH / 2;

  return {
    root,
    hinges,
    meshes,
    dims,
    dimGroup,
    partFrame: frame,
    faceFrames,
    size: new THREE.Vector3(W, maxH, D),
    dispose: () => {
      disposables.forEach((d) => d.dispose());
      // Les zones de pli changent de géométrie pendant le dépliage : on libère la dernière.
      for (const m of meshes) {
        m.geometry.dispose();
        (m.children[0] as THREE.LineSegments | undefined)?.geometry.dispose();
      }
    },
  };
}

/** Applique un taux de pliage 0 (à plat) → 1 (plié). */
export function setFold(part: BuiltPart, fold: number) {
  for (const h of part.hinges) h.update(fold);
}

export const REGION_LABEL = (r: Region): string =>
  r === 'base' ? 'Base' : r.startsWith('panel:') ? 'Panneau' : `Aile ${r.slice(5)}`;

/**
 * Zone de découpe dessinée sur une face : « draft » = rouge (ce qui va être retiré),
 * « done » = grisé translucide au contour pointillé (déjà découpé). `poly` est dans le repère de la face.
 */
export function addGhost(part: BuiltPart, spec: PartSpec, face: Face, poly: Pt[], style: 'draft' | 'done' = 'draft'): () => void {
  const target = part.faceFrames[face];
  if (!target || poly.length < 3) return () => {};
  const pts = poly.map(([x, y]) => (face === 'base' ? [x, y] : faceToCanonical(spec, face, x, y)) as Pt);
  const draft = style === 'draft';
  const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))), { depth: spec.thickness + 1.2, bevelEnabled: false });
  geo.translate(0, 0, -0.6);
  const mat = new THREE.MeshBasicMaterial({ color: draft ? 0xe53935 : 0x7d8a9c, transparent: true, opacity: draft ? 0.45 : 0.16, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 5;
  // Contour : plein pour la découpe en cours, pointillé pour les découpes déjà faites.
  const scale = Math.max(spec.width, spec.depth);
  const lineMat = draft
    ? new THREE.LineBasicMaterial({ color: 0xb71c1c })
    : new THREE.LineDashedMaterial({ color: 0x5b6475, dashSize: scale * 0.015, gapSize: scale * 0.01, transparent: true, opacity: 0.8 });
  const loopGeos: THREE.BufferGeometry[] = [];
  for (const z of [spec.thickness + 0.6, -0.6]) {
    const g = new THREE.BufferGeometry().setFromPoints(pts.map(([x, y]) => new THREE.Vector3(x, y, z)));
    loopGeos.push(g);
    const loop = new THREE.LineLoop(g, lineMat);
    loop.computeLineDistances();
    mesh.add(loop);
  }
  target.add(mesh);
  return () => {
    target.remove(mesh);
    geo.dispose();
    loopGeos.forEach((g) => g.dispose());
    mat.dispose();
    lineMat.dispose();
  };
}

const MEASURE_COLOR = 0xff7a00;

/**
 * Repère visuel d'une cote sur une face : X en pointillés depuis le bord gauche (X = 0) jusqu'au point,
 * Y en pointillés depuis le bord bas (Y = 0). Dessiné par-dessus la pièce ; renvoie la fonction de nettoyage.
 */
export function addMeasure(part: BuiltPart, spec: PartSpec, m: { face: Face; x: number; y: number; axis: 'x' | 'y' | 'xy' }): () => void {
  const target = part.faceFrames[m.face];
  if (!target) return () => {};
  const z = spec.thickness + 0.4;
  const toLocal = (x: number, y: number) => {
    const [u, v] = m.face === 'base' ? [x, y] : faceToCanonical(spec, m.face, x, y);
    return new THREE.Vector3(u, v, z);
  };
  const scale = Math.max(spec.width, spec.depth);
  const lineMat = new THREE.LineDashedMaterial({ color: MEASURE_COLOR, dashSize: scale * 0.02, gapSize: scale * 0.012, depthTest: false, transparent: true });
  const dotMat = new THREE.MeshBasicMaterial({ color: MEASURE_COLOR, depthTest: false, transparent: true });
  const group = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const dashed = (a: THREE.Vector3, b: THREE.Vector3) => {
    if (a.distanceTo(b) < 0.01) return;
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    geos.push(geo);
    const line = new THREE.Line(geo, lineMat);
    line.computeLineDistances();
    line.renderOrder = 30;
    group.add(line);
  };
  const p = toLocal(m.x, m.y);
  if (m.axis !== 'y') dashed(toLocal(0, m.y), p);
  if (m.axis !== 'x') dashed(toLocal(m.x, 0), p);
  const dotGeo = new THREE.SphereGeometry(scale * 0.007 + 0.3, 12, 8);
  geos.push(dotGeo);
  const dot = new THREE.Mesh(dotGeo, dotMat);
  dot.position.copy(p);
  dot.renderOrder = 31;
  group.add(dot);
  target.add(group);
  return () => {
    target.remove(group);
    geos.forEach((g) => g.dispose());
    lineMat.dispose();
    dotMat.dispose();
  };
}
