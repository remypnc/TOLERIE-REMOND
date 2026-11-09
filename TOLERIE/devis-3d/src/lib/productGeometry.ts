// Construit un produit assemblé en three.js : un maillage par panneau, regroupés sous le mouvement qui les entraîne
// (porte + poignée + voyant tournent ensemble), avec les lumières et ventilateurs animés quand le produit est en marche.
import * as THREE from 'three';
import type { PartSpec } from './types';
import { panelAxes, productModel, type Look, type Motion, type Panel, type ProductModel } from './products';
import { partMaterial, type BuiltPart, type DimLine } from './partGeometry';
import { importedGeometry } from './cadImport';

export interface ProductRuntime {
  model: ProductModel;
  /** Ouverture de chaque mouvement (0 fermé → 1 ouvert), mise en marche (0 → 1) et temps (s). */
  update: (open: Record<string, number>, active: number, time: number) => void;
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString('fr-FR');

function lookMaterial(look: Look, spec: PartSpec, color?: number): THREE.MeshStandardMaterial {
  switch (look) {
    case 'tole': return partMaterial(spec.material, spec.finish, spec.ral);
    case 'interieur': return new THREE.MeshStandardMaterial({ color: 0xd5dae1, metalness: 0.3, roughness: 0.6 });
    case 'galva': return new THREE.MeshStandardMaterial({ color: 0xb4bcc4, metalness: 0.85, roughness: 0.32 });
    case 'noir': return new THREE.MeshStandardMaterial({ color: 0x1d2128, metalness: 0.2, roughness: 0.6 });
    case 'verre': return new THREE.MeshStandardMaterial({ color: 0xcfe8ff, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.35 });
    case 'ecran': return new THREE.MeshStandardMaterial({ color: 0x0b1220, metalness: 0.2, roughness: 0.15 });
    case 'led': return new THREE.MeshStandardMaterial({ color: color ?? 0xffffff, metalness: 0.1, roughness: 0.4 });
    case 'rideau': return new THREE.MeshStandardMaterial({ color: 0x7f1d1d, metalness: 0, roughness: 0.95 });
    case 'boite': return new THREE.MeshStandardMaterial({ color: color ?? 0xf8fafc, metalness: 0, roughness: 0.7 });
    case 'blanc': return new THREE.MeshStandardMaterial({ color: 0xf1f3f5, metalness: 0.05, roughness: 0.5 });
    case 'solaire': return new THREE.MeshStandardMaterial({ color: 0x1e3a8a, metalness: 0.6, roughness: 0.2 });
    case 'bois': return new THREE.MeshStandardMaterial({ color: 0xb08356, metalness: 0, roughness: 0.75 });
  }
}

/**
 * Géométrie d'un panneau : simple boîte, ou tôle extrudée percée (trous ronds, ouvertures rectangulaires)
 * quand le panneau est usiné. Le profil est tracé dans le plan du panneau puis tourné sur son axe mince.
 */
function panelGeometry(x: Panel): THREE.BufferGeometry {
  if (x.round) return new THREE.CylinderGeometry(x.size[0] / 2, x.size[0] / 2, x.size[1], 40);
  if (!x.holes?.length && !x.cutouts?.length && !x.poly) return new THREE.BoxGeometry(...x.size);
  const { thin, u: su, v: sv } = panelAxes(x.size);
  const t = x.size[thin];
  const shape = new THREE.Shape();
  const outline: [number, number][] = x.poly ?? [[-su / 2, -sv / 2], [su / 2, -sv / 2], [su / 2, sv / 2], [-su / 2, sv / 2]];
  outline.forEach(([u, v], i) => (i ? shape.lineTo(u, v) : shape.moveTo(u, v)));
  shape.closePath();
  const inside = (u: number, v: number, hu: number, hv: number) => Math.abs(u) + hu < su / 2 - 0.5 && Math.abs(v) + hv < sv / 2 - 0.5;
  const many = (x.holes?.length ?? 0) > 120;
  for (const [u, v, d] of x.holes ?? []) {
    if (!inside(u, v, d / 2, d / 2)) continue;
    const path = new THREE.Path();
    path.absarc(u, v, d / 2, 0, Math.PI * 2, true);
    shape.holes.push(path);
  }
  for (const [u, v, w, h] of x.cutouts ?? []) {
    if (!inside(u, v, w / 2, h / 2)) continue;
    const path = new THREE.Path();
    path.moveTo(u - w / 2, v - h / 2);
    path.lineTo(u - w / 2, v + h / 2);
    path.lineTo(u + w / 2, v + h / 2);
    path.lineTo(u + w / 2, v - h / 2);
    path.closePath();
    shape.holes.push(path);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: many ? 6 : 16 });
  geo.translate(0, 0, -t / 2);
  // (u, v, épaisseur) → axes du panneau, en repère direct.
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
  const m = new THREE.Matrix4();
  if (thin === 0) m.makeBasis(Z, Y, X.clone().negate());
  else if (thin === 1) m.makeBasis(X, Z.clone().negate(), Y);
  geo.applyMatrix4(m);
  return geo;
}

/** Texte centré sur fond transparent, à la proportion du panneau. */
function textTexture(text: string, w: number, h: number, color: string): THREE.CanvasTexture {
  const scale = 512 / Math.max(w, h);
  const c = document.createElement('canvas');
  c.width = Math.max(16, Math.round(w * scale));
  c.height = Math.max(16, Math.round(h * scale));
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = c.height * 0.7;
  g.font = `700 ${size}px Roboto, Arial, sans-serif`;
  while (g.measureText(text).width > c.width * 0.92 && size > 6) {
    size *= 0.9;
    g.font = `700 ${size}px Roboto, Arial, sans-serif`;
  }
  g.fillText(text, c.width / 2, c.height / 2);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildProduct(spec: PartSpec): BuiltPart & { product: ProductRuntime } {
  const p = spec.product!;
  const model = productModel(p, spec.thickness);
  const disposables: { dispose: () => void }[] = [];
  const meshes: THREE.Mesh[] = [];
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x0b1e44, transparent: true, opacity: 0.35 });
  disposables.push(edgeMat);

  // Matériaux partagés par aspect (et par couleur / effet de lumière).
  const mats = new Map<string, THREE.MeshStandardMaterial>();
  const glowing: { mat: THREE.MeshStandardMaterial; color: number; mode: NonNullable<Panel['glow']>['mode'] }[] = [];
  // Couleur propre à un panneau (ou à tout ce que porte un ouvrant) : RAL thermolaqué, sinon la couleur de la pièce.
  const ralOf = (x: Panel) => (x.look === 'tole' || x.look === 'rideau' ? p.colors?.[x.id] ?? (x.motion ? p.colors?.[x.motion] : undefined) : undefined);
  const matFor = (x: Panel) => {
    const ral = ralOf(x);
    const key = `${x.look}:${x.color ?? ''}:${ral ?? ''}:${x.glow ? `${x.glow.color}:${x.glow.mode}` : ''}`;
    let m = mats.get(key);
    if (!m) {
      m = ral ? partMaterial(spec.material, 'epoxy', ral) : lookMaterial(x.look, spec, x.color);
      if (x.glow) {
        m.emissive.set(x.glow.color);
        m.emissiveIntensity = 0;
        glowing.push({ mat: m, color: x.glow.color, mode: x.glow.mode });
      }
      mats.set(key, m);
      disposables.push(m);
    }
    return m;
  };

  // Encombrement : boîte englobante des panneaux, puis centrage.
  const box = new THREE.Box3();
  for (const x of model.panels) {
    box.expandByPoint(new THREE.Vector3(x.at[0] - x.size[0] / 2, x.at[1] - x.size[1] / 2, x.at[2] - x.size[2] / 2));
    box.expandByPoint(new THREE.Vector3(x.at[0] + x.size[0] / 2, x.at[1] + x.size[1] / 2, x.at[2] + x.size[2] / 2));
  }
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());

  const root = new THREE.Group();
  // Repère produit (mm, Y en haut) : les cotes et les clics s'y expriment.
  const frame = new THREE.Group();
  frame.position.set(-center.x, -center.y, -center.z);
  root.add(frame);

  // Un groupe par mouvement, placé à son pivot ; les panneaux qu'il entraîne y sont rattachés.
  // Un mouvement porté par un autre (trappe dans une porte) est rattaché à son groupe et le suit.
  const groups = new Map<string, { g: THREE.Group; m: Motion; origin: THREE.Vector3; base: THREE.Vector3 }>();
  for (const m of model.motions) {
    const g = new THREE.Group();
    const origin = new THREE.Vector3(...(m.pivot ?? [0, 0, 0]));
    groups.set(m.id, { g, m, origin, base: origin.clone() });
  }
  for (const x of groups.values()) {
    const parent = x.m.parent ? groups.get(x.m.parent) : undefined;
    if (parent) x.base.sub(parent.origin);
    x.g.position.copy(x.base);
    (parent?.g ?? frame).add(x.g);
  }
  const spinners: { mesh: THREE.Mesh; axis: 'x' | 'y' | 'z' }[] = [];
  for (const x of model.panels) {
    const geo = panelGeometry(x);
    const mesh = new THREE.Mesh(geo, matFor(x));
    mesh.castShadow = x.look !== 'verre';
    mesh.receiveShadow = true;
    mesh.userData.region = `panel:${x.id}`;
    mesh.userData.label = x.label;
    if (x.motion) mesh.userData.motion = x.motion;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
    mesh.add(edges);
    disposables.push(geo, edges.geometry);
    if (x.text) {
      // Sérigraphie / pictogramme : texture texte sur la face avant (z+).
      // Texte foncé sur les surfaces claires ou lumineuses (écran, bandeau, pastille), blanc sur le noir.
      const tex = textTexture(x.text, x.size[0], x.size[1], x.look === 'blanc' ? '#1d4ed8' : x.look === 'led' || x.look === 'ecran' || x.look === 'galva' ? '#0b1e44' : '#ffffff');
      disposables.push(tex);
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(x.size[0] * 0.96, x.size[1] * 0.9), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      plane.position.z = x.size[2] / 2 + 0.3;
      disposables.push(plane.geometry, plane.material as THREE.Material);
      mesh.add(plane);
    }
    const holder = x.motion ? groups.get(x.motion) : undefined;
    const pos = new THREE.Vector3(...x.at);
    if (holder) pos.sub(holder.origin);
    mesh.position.copy(pos);
    if (x.rot) mesh.rotation.set(...(x.rot.map((d) => THREE.MathUtils.degToRad(d)) as [number, number, number]));
    (holder?.g ?? frame).add(mesh);
    meshes.push(mesh);
    if (x.spin) spinners.push({ mesh, axis: x.spin });
  }

  // Cotes hors tout : largeur, profondeur, hauteur (même ordre que les étiquettes).
  const [x0, y0, z0] = [box.min.x, box.min.y, box.min.z];
  const [x1, y1, z1] = [box.max.x, box.max.y, box.max.z];
  const gap = Math.max(size.x, size.z) * 0.1 + 40;
  const dims: DimLine[] = [
    { a: new THREE.Vector3(x0, y0, z1), b: new THREE.Vector3(x1, y0, z1), offset: new THREE.Vector3(0, 0, gap), label: fmt(p.width) },
    { a: new THREE.Vector3(x1, y0, z0), b: new THREE.Vector3(x1, y0, z1), offset: new THREE.Vector3(gap, 0, 0), label: fmt(p.depth) },
    { a: new THREE.Vector3(x0, y0, z1), b: new THREE.Vector3(x0, y1, z1), offset: new THREE.Vector3(-gap, 0, 0), label: fmt(p.height) },
  ];
  const dimGroup = new THREE.Group();
  const dimMat = new THREE.LineBasicMaterial({ color: 0x00a2a3, depthTest: false, transparent: true });
  disposables.push(dimMat);
  for (const d of dims) {
    const a2 = d.a.clone().add(d.offset);
    const b2 = d.b.clone().add(d.offset);
    const dir = b2.clone().sub(a2).normalize();
    const nrm = d.offset.clone().normalize();
    const tick = Math.max(size.x, size.z) * 0.012 + 6;
    const pts = [d.a, a2, d.b, b2, a2, b2];
    for (const q of [a2, b2]) pts.push(q.clone().addScaledVector(dir, -tick).addScaledVector(nrm, -tick), q.clone().addScaledVector(dir, tick).addScaledVector(nrm, tick));
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    disposables.push(geo);
    const line = new THREE.LineSegments(geo, dimMat);
    line.renderOrder = 10;
    dimGroup.add(line);
  }
  frame.add(dimGroup);

  const update: ProductRuntime['update'] = (open, active, time) => {
    for (const { g, m, base } of groups.values()) {
      // Mouvements automatiques (robot, impression) : va-et-vient tant que le produit est en marche.
      // `hold` : s'accomplit une fois (après un court délai) et reste, jusqu'à l'arrêt.
      const v = m.auto ? (m.hold ? active * Math.min(1, Math.max(0, (time - 1.2) / 1.6)) : active * (0.5 - 0.5 * Math.cos(time * 1.3))) : (open[m.id] ?? 0);
      if (m.type === 'hinge') {
        g.rotation.set(0, 0, 0);
        g.rotation[m.axis ?? 'y'] = THREE.MathUtils.degToRad(m.angle ?? 90) * v;
      } else if (m.type === 'slide') {
        const [dx, dy, dz] = m.move ?? [0, 0, 0];
        g.position.set(base.x + dx * v, base.y + dy * v, base.z + dz * v);
      } else {
        // Écrasement vers le pivot (rideau replié en x) ; à l'envers pour ce qui sort (reçu qui se déroule en y).
        const k = m.hold ? (m.scale ?? 0.02) + (1 - (m.scale ?? 0.02)) * v : 1 + ((m.scale ?? 0.2) - 1) * v;
        g.scale.set(1, 1, 1);
        g.scale[m.axis ?? 'x'] = k;
      }
    }
    for (const { mat, mode } of glowing) {
      const wave =
        mode === 'blink' ? (Math.sin(time * 6) > 0 ? 1 : 0.15)
        : mode === 'flash' ? (time % 2.4 < 0.12 ? 3 : 0.05)
        : mode === 'pulse' ? 0.55 + 0.45 * Math.sin(time * 3)
        : 1;
      mat.emissiveIntensity = active * wave * 1.4;
    }
    for (const { mesh, axis } of spinners) mesh.rotation[axis] += active * 0.35;
  };
  update({}, 0, 0);

  return {
    root,
    hinges: [],
    meshes,
    dims,
    dimGroup,
    partFrame: frame,
    faceFrames: { base: frame },
    size,
    product: { model, update },
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}

/**
 * Pièce importée (STEP, IGES, STL, OBJ, DXF) : le maillage du fichier, à la matière choisie, avec ses arêtes vives.
 * Si le maillage n'est plus en mémoire (page rechargée), une boîte à l'encombrement le remplace.
 */
export function buildImported(spec: PartSpec): BuiltPart {
  const im = spec.imported!;
  const disposables: { dispose: () => void }[] = [];
  const material = partMaterial(spec.material, spec.finish, spec.ral);
  material.side = THREE.DoubleSide;
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x0b1e44, transparent: true, opacity: 0.45 });
  disposables.push(material, edgeMat);
  const source = importedGeometry(im.id);
  const geo = source ?? new THREE.BoxGeometry(im.size[0], im.size[2], im.size[1]);
  if (!source) disposables.push(geo);
  const root = new THREE.Group();
  const frame = new THREE.Group();
  root.add(frame);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.region = 'panel:import';
  mesh.userData.label = im.name;
  // Arêtes : seulement sous ~300 000 triangles, au-delà le calcul ralentirait l'affichage.
  if (im.triangles < 300_000) {
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), edgeMat);
    mesh.add(edges);
    disposables.push(edges.geometry);
  }
  frame.add(mesh);
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  const size = box.getSize(new THREE.Vector3());
  const gap = Math.max(size.x, size.z) * 0.1 + 20;
  const [x0, y0, z0, x1, y1, z1] = [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z];
  const dims: DimLine[] = [
    { a: new THREE.Vector3(x0, y0, z1), b: new THREE.Vector3(x1, y0, z1), offset: new THREE.Vector3(0, 0, gap), label: fmt(size.x) },
    { a: new THREE.Vector3(x1, y0, z0), b: new THREE.Vector3(x1, y0, z1), offset: new THREE.Vector3(gap, 0, 0), label: fmt(size.z) },
    { a: new THREE.Vector3(x0, y0, z1), b: new THREE.Vector3(x0, y1, z1), offset: new THREE.Vector3(-gap, 0, 0), label: fmt(size.y) },
  ];
  const dimGroup = new THREE.Group();
  dimGroup.visible = false;
  frame.add(dimGroup);
  return {
    root, hinges: [], meshes: [mesh], dims, dimGroup, partFrame: frame, faceFrames: { base: frame }, size,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}
