import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import gsap from 'gsap';
import { addGhost, addMeasure, buildPart, setFold, type BuiltPart, type Region } from '../lib/partGeometry';
import { buildImported, buildProduct } from '../lib/productGeometry';
import { canonicalToFace, faceSize, faceToCanonical, type Pt } from '../lib/faces';
import type { Face, PartSpec } from '../lib/types';
import styles from './Viewer3D.module.css';

export type ViewName = 'iso' | 'face' | 'arriere' | 'dessus' | 'dessous' | 'droite' | 'gauche';

/** Direction caméra (repère three, Y en haut, face = +Z = bord sud de la pièce). */
const VIEW_DIR: Record<ViewName, [number, number, number]> = {
  iso: [1, 0.85, 1.25],
  face: [0, 0.0001, 1],
  arriere: [0, 0.0001, -1],
  dessus: [0, 1, 0.0001],
  dessous: [0, -1, 0.0001],
  droite: [1, 0.0001, 0],
  gauche: [-1, 0.0001, 0],
};

/** Vue de coupe : plan perpendiculaire à l'axe, à `pos` (0 → 1) de l'encombrement ; ce qui est au-delà est masqué. */
export interface Section {
  axis: 'x' | 'y' | 'z';
  pos: number;
}

export interface ViewerHandle {
  setView: (v: ViewName) => void;
  zoom: (factor: number) => void;
}

/** Modification faite directement sur une étiquette de la 3D. */
export type PartEdit =
  | { kind: 'width' | 'depth' | 'height'; value: number }
  | { kind: 'flange'; index: number; height: number; angle: number; radius: number }
  | { kind: 'hole'; id: string; x: number; y: number; diameter: number }
  | { kind: 'holeDelete'; id: string }
  | { kind: 'cutOpen'; id: string };

/** Clé d'étiquette : 'width', 'depth', 'flange:<i>', 'hole:<id>'. */
export type LabelKey = string;

export interface PickEvent {
  region: Region;
  /** Face cliquée et point cliqué dans le repère de cette face (mm). */
  face: Face;
  x: number;
  y: number;
}

/** Cote à mettre en évidence : du bord de référence de la face jusqu'au point, sur l'axe X ou Y. */
export interface Measure {
  face: Face;
  x: number;
  y: number;
  axis: 'x' | 'y' | 'xy';
}

/** Point sur une face (repère de la face, mm). */
export interface FacePoint {
  face: Face;
  x: number;
  y: number;
}

interface Props {
  spec: PartSpec;
  /** 1 = plié, 0 = à plat ; animé. */
  fold?: number;
  showDims?: boolean;
  /** Survol + clic pour sélectionner une zone (mode édition). */
  pickable?: boolean;
  onPick?: (e: PickEvent) => void;
  /** Rotation lente automatique tant que l'utilisateur ne touche pas. */
  autoRotate?: boolean;
  /** « blueprint » : rendu plan (fond transparent, faces translucides, arêtes claires). */
  variant?: 'real' | 'blueprint';
  /** Rend les étiquettes (cotes, plis, perçages) modifiables au clic. */
  onEdit?: (e: PartEdit) => void;
  /** Ouvre l'éditeur d'une étiquette depuis l'extérieur (clic sur la pièce, outil…). */
  editRequest?: { key: LabelKey; nonce: number } | null;
  /** Points repères (ex. points d'une découpe en cours). */
  markers?: FacePoint[];
  /** Zones de découpe : en rouge celle en préparation, en grisé pointillé celles déjà faites. */
  ghosts?: { face: Face; poly: Pt[]; style: 'draft' | 'done' }[];
  /** Pastilles cliquables posées sur la pièce (ex. « ✂ 1 » pour rouvrir une découpe, « R5 » sur un angle arrondi). */
  tags?: Tag[];
  onTag?: (id: string) => void;
  /** Cote mise en évidence depuis l'extérieur (panneau Découpes). */
  measure?: Measure | null;
  /** Rend les repères déplaçables à la souris / au doigt, sur leur face. */
  onMarkerMove?: (index: number, x: number, y: number) => void;
  /** Zone sélectionnée (face, aile ou panneau), surlignée en orange. */
  selected?: Region | null;
  /** Vue de coupe, ou null. */
  section?: Section | null;
  /** Produit assemblé : ouverture visée de chaque mouvement (0 / 1), animée. */
  motions?: Record<string, number>;
  /** Produit en marche (voyants, écran, ventilateur, robot). */
  active?: boolean;
  /** Clic sur un ouvrant (porte, trappe…) hors outil d'édition. */
  onMotion?: (id: string) => void;
  ref?: Ref<ViewerHandle>;
  className?: string;
}

export interface Tag {
  id: string;
  face: Face;
  x: number;
  y: number;
  label: string;
  title?: string;
  /** « add » : action proposée (pointillé) ; « on » : élément existant ; « sel » : élément sélectionné. */
  tone?: 'add' | 'on' | 'sel';
}

const NO_GHOSTS: { face: Face; poly: Pt[]; style: 'draft' | 'done' }[] = [];

const NO_MOTIONS: Record<string, number> = {};

export function Viewer3D({ spec, fold = 1, showDims = false, pickable = false, onPick, autoRotate = false, variant = 'real', onEdit, editRequest = null, markers = [], ghosts = NO_GHOSTS, tags = [], onTag, measure = null, onMarkerMove, selected = null, section = null, motions = NO_MOTIONS, active = false, onMotion, ref, className }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<HTMLDivElement>(null);
  const tagsRef = useRef<HTMLDivElement>(null);
  const ctx = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    part?: BuiltPart;
    foldState: { v: number };
    hovered?: THREE.Mesh;
    fitted?: boolean;
    blueprintMats?: THREE.Material[];
    /** Copies surlignées (survol, sélection) des matériaux, libérées à chaque reconstruction. */
    hlMats: THREE.Material[];
    paint: () => void;
    applyClip: () => void;
  } | null>(null);
  const propsRef = useRef({ showDims, pickable, onPick, fold, spec, markers, tags, selected, section, motions, active, onMotion });
  propsRef.current = { showDims, pickable, onPick, fold, spec, markers, tags, selected, section, motions, active, onMotion };

  // Scène, rendu, boucle : une seule fois.
  useEffect(() => {
    const host = hostRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.localClippingEnabled = true;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;

    scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c4d6, 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(400, 900, 600);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.radius = 6;
    scene.add(sun);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.13 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.name = 'ground';
    ground.visible = variant !== 'blueprint';
    scene.add(ground);

    const camera = new THREE.PerspectiveCamera(32, 1, 1, 50000);
    camera.position.set(500, 420, 620);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.addEventListener('start', () => { controls.autoRotate = false; });

    // Plan de coupe et son repère visuel (voile orange + contour), placés à chaque image.
    const clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
    const clipMat = new THREE.MeshBasicMaterial({ color: 0xff7a00, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false });
    const clipVeil = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), clipMat);
    const clipEdge = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.5, -0.5, 0), new THREE.Vector3(0.5, -0.5, 0), new THREE.Vector3(0.5, 0.5, 0), new THREE.Vector3(-0.5, 0.5, 0)]),
      new THREE.LineBasicMaterial({ color: 0xff7a00, transparent: true, opacity: 0.8 }),
    );
    clipVeil.add(clipEdge);
    clipVeil.visible = false;
    clipVeil.renderOrder = 20;
    scene.add(clipVeil);

    /** Surlignage : survol (turquoise) prioritaire sur la sélection (orange). */
    const paint = () => {
      const s = ctx.current;
      if (!s?.part) return;
      const sel = propsRef.current.selected;
      for (const mesh of s.part.meshes) {
        const base = (mesh.userData.mat0 ??= mesh.material) as THREE.Material;
        const want = mesh === s.hovered ? 'hover' : sel && mesh.userData.region === sel ? 'sel' : null;
        if (!want || !(base instanceof THREE.MeshStandardMaterial)) {
          mesh.material = base;
          continue;
        }
        const cache = (mesh.userData.hl ??= {}) as Record<string, THREE.MeshStandardMaterial>;
        if (!cache[want]) {
          const m = base.clone();
          m.emissive.set(want === 'hover' ? 0x00a2a3 : 0xff7a00);
          m.emissiveIntensity = want === 'hover' ? 0.35 : 0.5;
          cache[want] = m;
          s.hlMats.push(m);
        }
        cache[want].clippingPlanes = base.clippingPlanes;
        cache[want].side = base.side;
        mesh.material = cache[want];
      }
    };
    /** Applique (ou retire) le plan de coupe aux matériaux de la pièce, cotes exceptées. */
    const applyClip = () => {
      const s = ctx.current;
      if (!s?.part) return;
      const on = !!propsRef.current.section;
      const seen = new Set<THREE.Material>();
      for (const mesh of s.part.meshes) {
        for (const o of [mesh, ...mesh.children]) {
          const m = ((o as THREE.Mesh).userData.mat0 ?? (o as THREE.Mesh).material) as THREE.Material | undefined;
          if (!m || seen.has(m)) continue;
          seen.add(m);
          m.clippingPlanes = on ? [clip] : null;
          // En coupe, l'intérieur des tôles reste visible (faces arrière dessinées).
          if (m instanceof THREE.MeshStandardMaterial) m.side = on ? THREE.DoubleSide : THREE.FrontSide;
          m.needsUpdate = true;
        }
      }
      clipVeil.visible = on;
      paint();
    };

    const state = { renderer, scene, camera, controls, foldState: { v: propsRef.current.fold }, hlMats: [] as THREE.Material[], paint, applyClip };
    ctx.current = state;

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    // Recadrage après un changement de taille du cadre (rotation, fenêtre, panneau de chat).
    let refit = 0;
    let lastW = host.clientWidth;
    const onResize = () => {
      resize();
      if (Math.abs(host.clientWidth - lastW) < 40) return;
      lastW = host.clientWidth;
      window.clearTimeout(refit);
      refit = window.setTimeout(() => {
        const st = ctx.current;
        if (st?.part) fitDir(st.camera.position.clone().sub(st.controls.target), 0.5);
      }, 650);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(host);
    resize();

    // Survol / clic.
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const hit = (ev: PointerEvent) => {
      const part = ctx.current?.part;
      if (!part) return null;
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return ray.intersectObjects(part.meshes, false)[0] ?? null;
    };
    const setHover = (m?: THREE.Mesh) => {
      const s = ctx.current!;
      if (s.hovered === m) return;
      s.hovered = m;
      paint();
      renderer.domElement.style.cursor = m ? (propsRef.current.pickable ? 'crosshair' : 'pointer') : '';
    };
    /** Ouvrant sous le pointeur (porte, trappe…), quand aucun outil d'édition n'est actif. */
    const motionHit = (ev: PointerEvent) => {
      if (!propsRef.current.onMotion) return null;
      const h = hit(ev);
      const id = h?.object.userData.motion as string | undefined;
      const auto = ctx.current?.part?.product?.model.motions.find((x) => x.id === id)?.auto;
      return id && !auto ? (h!.object as THREE.Mesh) : null;
    };
    let downAt = { x: 0, y: 0 };
    const onMove = (ev: PointerEvent) => {
      if (!propsRef.current.pickable) return setHover(motionHit(ev) ?? undefined);
      setHover((hit(ev)?.object as THREE.Mesh) ?? undefined);
    };
    const onDown = (ev: PointerEvent) => { downAt = { x: ev.clientX, y: ev.clientY }; };
    const onUp = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 4) return;
      if (!propsRef.current.pickable) {
        const m = motionHit(ev);
        if (m) propsRef.current.onMotion?.(m.userData.motion as string);
        return;
      }
      const h = hit(ev);
      const part = ctx.current?.part;
      if (!h || !part) return;
      const region = h.object.userData.region as Region;
      if (region.startsWith('panel:')) {
        // Produit assemblé : on désigne un panneau ; le point est donné dans le repère produit.
        const local = part.partFrame.worldToLocal(h.point.clone());
        propsRef.current.onPick?.({ region, face: 'base', x: Math.round(local.x), y: Math.round(local.y) });
        return;
      }
      const face: Face = region === 'base' ? 'base' : (region.slice(5) as Face);
      const frameObj = part.faceFrames[face] ?? part.partFrame;
      const local = frameObj.worldToLocal(h.point.clone());
      const [x, y] = face === 'base' ? [local.x, local.y] : canonicalToFace(propsRef.current.spec, face, local.x, local.y);
      propsRef.current.onPick?.({ region, face, x: Math.round(x), y: Math.round(y) });
    };
    const el = renderer.domElement;
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointerleave', () => setHover(undefined));

    // Boucle.
    const v = new THREE.Vector3();
    let raf = 0;
    const motionState: Record<string, number> = {};
    let activeLevel = 0;
    let last = performance.now();
    const clock = { t: 0 };
    const tick = () => {
      raf = requestAnimationFrame(tick);
      controls.update();
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const part = ctx.current?.part;
      const labels = labelsRef.current;
      if (part) {
        setFold(part, state.foldState.v);
        if (part.product) {
          // Ouvrants : rapprochement doux vers la position demandée ; marche : montée / descente en 0,4 s.
          const target = propsRef.current.motions;
          const k = 1 - Math.exp(-dt * 5);
          for (const m of part.product.model.motions) motionState[m.id] = (motionState[m.id] ?? 0) + ((target[m.id] ?? 0) - (motionState[m.id] ?? 0)) * k;
          activeLevel += ((propsRef.current.active ? 1 : 0) - activeLevel) * Math.min(1, dt * 2.5);
          // Le temps de marche repart de zéro à chaque mise en marche (le reçu ressort à chaque séance).
          if (activeLevel > 0.001) clock.t += dt;
          else clock.t = 0;
          part.product.update(motionState, activeLevel, clock.t);
        }
        const sec = propsRef.current.section;
        if (sec) {
          const half = part.size.clone().multiplyScalar(0.5);
          const c = (sec.pos - 0.5) * part.size[sec.axis];
          const n = new THREE.Vector3(sec.axis === 'x' ? -1 : 0, sec.axis === 'y' ? -1 : 0, sec.axis === 'z' ? -1 : 0);
          clip.set(n, c);
          clipVeil.position.set(sec.axis === 'x' ? c : 0, sec.axis === 'y' ? c : 0, sec.axis === 'z' ? c : 0);
          clipVeil.rotation.set(sec.axis === 'y' ? -Math.PI / 2 : 0, sec.axis === 'x' ? Math.PI / 2 : 0, 0);
          const [a, b] = sec.axis === 'x' ? [half.z, half.y] : sec.axis === 'y' ? [half.x, half.z] : [half.x, half.y];
          clipVeil.scale.set(a * 2.3, b * 2.3, 1);
        }
        const dimsOn = propsRef.current.showDims && state.foldState.v > 0.98;
        part.dimGroup.visible = dimsOn;
        if (labels) {
          labels.style.opacity = dimsOn ? '1' : '0';
          labels.dataset.on = dimsOn ? '1' : '0';
          if (dimsOn) {
            part.root.updateMatrixWorld();
            const w = el.clientWidth, h = el.clientHeight;
            const place = (node: HTMLElement | undefined, lift: string, frameObj: THREE.Object3D = part.partFrame) => {
              if (!node) return;
              frameObj.localToWorld(v);
              v.project(camera);
              node.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, ${lift})`;
            };
            part.dims.forEach((d, i) => {
              v.copy(d.a).add(d.b).multiplyScalar(0.5).add(d.offset);
              place(labels.children[i] as HTMLElement | undefined, '-50%');
            });
            // Étiquettes des perçages, juste au-dessus de chaque trou.
            const sp = propsRef.current.spec;
            const onFace = (face: Face, x: number, y: number) => {
              const [u, w] = face === 'base' ? [x, y] : faceToCanonical(sp, face, x, y);
              v.set(u, w, sp.thickness);
              return part.faceFrames[face] ?? part.partFrame;
            };
            sp.holes.forEach((hole, i) => {
              const fo = onFace(hole.face ?? 'base', hole.x, hole.y);
              place(labels.children[part.dims.length + i] as HTMLElement | undefined, 'calc(-100% - 6px)', fo);
            });
            (sp.cuts ?? []).forEach((c, i) => {
              const fo = onFace(c.face ?? 'base', (c.x1 + c.x2) / 2, (c.y1 + c.y2) / 2);
              place(labels.children[part.dims.length + sp.holes.length + i] as HTMLElement | undefined, '-50%', fo);
            });
          }
        }
        // Pastilles (toujours visibles).
        const tg = tagsRef.current;
        if (tg) {
          part.root.updateMatrixWorld();
          propsRef.current.tags.forEach((t, i) => {
            const node = tg.children[i] as HTMLElement | undefined;
            if (!node) return;
            const sp = propsRef.current.spec;
            const [u, w] = t.face === 'base' ? [t.x, t.y] : faceToCanonical(sp, t.face, t.x, t.y);
            v.set(u, w, sp.thickness);
            (part.faceFrames[t.face] ?? part.partFrame).localToWorld(v);
            v.project(camera);
            node.style.transform = `translate(${((v.x + 1) / 2) * el.clientWidth}px, ${((1 - v.y) / 2) * el.clientHeight}px) translate(-50%, -50%)`;
          });
        }
        // Repères (toujours visibles).
        const mk = markersRef.current;
        if (mk) {
          part.root.updateMatrixWorld();
          propsRef.current.markers.forEach((m, i) => {
            const node = mk.children[i] as HTMLElement | undefined;
            if (!node) return;
            const sp = propsRef.current.spec;
            const [u, w] = m.face === 'base' ? [m.x, m.y] : faceToCanonical(sp, m.face, m.x, m.y);
            v.set(u, w, sp.thickness);
            (part.faceFrames[m.face] ?? part.partFrame).localToWorld(v);
            v.project(camera);
            node.style.transform = `translate(${((v.x + 1) / 2) * el.clientWidth}px, ${((1 - v.y) / 2) * el.clientHeight}px) translate(-50%, -50%)`;
          });
        }
      }
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(refit);
      ro.disconnect();
      controls.dispose();
      ctx.current?.part?.dispose();
      ctx.current?.blueprintMats?.forEach((m) => m.dispose());
      ctx.current?.hlMats.forEach((m) => m.dispose());
      clipVeil.geometry.dispose();
      clipMat.dispose();
      clipEdge.geometry.dispose();
      (clipEdge.material as THREE.Material).dispose();
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
      el.remove();
      ctx.current = null;
    };
  }, []);

  // (Re)construction de la pièce à chaque modification.
  const lastSize = useRef<THREE.Vector3 | null>(null);
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    const s = ctx.current;
    if (!s) return;
    if (s.part) {
      s.scene.remove(s.part.root);
      s.part.dispose();
      s.hovered = undefined;
    }
    s.hlMats.forEach((m) => m.dispose());
    s.hlMats = [];
    const part = spec.imported ? buildImported(spec) : spec.product ? buildProduct(spec) : buildPart(spec, s.foldState.v);
    s.blueprintMats?.forEach((m) => m.dispose());
    s.blueprintMats = undefined;
    if (variant === 'blueprint') {
      const ghost = new THREE.MeshBasicMaterial({ color: 0x3f74c4, transparent: true, opacity: 0.28, depthWrite: false });
      const edge = new THREE.LineBasicMaterial({ color: 0xcfeeff });
      const dim = new THREE.LineBasicMaterial({ color: 0x00dbdc, depthTest: false, transparent: true, opacity: 0.8 });
      s.blueprintMats = [ghost, edge, dim];
      for (const m of part.meshes) {
        m.material = ghost;
        m.castShadow = false;
        m.children.forEach((c) => { if (c instanceof THREE.LineSegments) c.material = edge; });
      }
      part.dimGroup.children.forEach((c) => { if (c instanceof THREE.LineSegments) c.material = dim; });
    }
    s.scene.add(part.root);
    s.part = part;
    for (const g of ghosts) addGhost(part, spec, g.face, g.poly, g.style);
    s.applyClip();

    // Sol et ombre à l'échelle de la pièce.
    const span = Math.max(part.size.x, part.size.z, part.size.y) * 3;
    const ground = s.scene.getObjectByName('ground') as THREE.Mesh;
    ground.scale.set(span, span, 1);
    ground.position.y = -part.size.y / 2 - 0.5;
    const cam = (s.scene.children.find((c) => c instanceof THREE.DirectionalLight) as THREE.DirectionalLight).shadow.camera;
    cam.left = cam.bottom = -span / 2;
    cam.right = cam.top = span / 2;
    cam.far = span * 4;
    cam.updateProjectionMatrix();
    s.controls.minDistance = span * 0.15;
    s.controls.maxDistance = span * 6;

    // Recadrage quand l'encombrement change sensiblement (en gardant l'angle de vue courant).
    const prev = lastSize.current;
    const grew = !prev || Math.abs(part.size.length() - prev.length()) / prev.length() > 0.12;
    lastSize.current = part.size.clone();
    // Nouvel objet (autre produit, fichier importé) : vue 3/4 recadrée plutôt que l'angle précédent.
    const key = spec.imported?.id ?? spec.product?.kind ?? 'piece';
    const changedObject = lastKey.current !== null && lastKey.current !== key;
    lastKey.current = key;
    if (changedObject) flyTo('iso', 0.8);
    else if (!s.fitted) {
      s.fitted = true;
      flyTo('iso', 0);
    } else if (grew) {
      fitDir(s.camera.position.clone().sub(s.controls.target), 0.8);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, ghosts]);

  // Sélection et coupe : repeindre / recouper sans reconstruire la pièce.
  useEffect(() => { ctx.current?.paint(); }, [selected]);
  useEffect(() => { ctx.current?.applyClip(); }, [section === null]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cote mise en évidence (survol ou saisie d'un champ X / Y) : bord de référence + trait jusqu'au point.
  const [labelMeasure, setLabelMeasure] = useState<Measure | null>(null);
  const shown = measure ?? labelMeasure;
  useEffect(() => {
    const s = ctx.current;
    if (!s?.part || !shown) return;
    return addMeasure(s.part, spec, shown);
  }, [shown, spec, ghosts]);

  // Déplacement d'un repère : rayon souris ∩ plan de sa face → coordonnées de face (bornées, aimantées).
  const markerDrag = useRef<number | null>(null);
  const moveMarker = (e: React.PointerEvent) => {
    const i = markerDrag.current;
    const s = ctx.current;
    const m = i === null ? undefined : markers[i];
    if (i === null || !s?.part || !m || !onMarkerMove) return;
    const frameObj = s.part.faceFrames[m.face] ?? s.part.partFrame;
    const rect = s.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), s.camera);
    frameObj.updateMatrixWorld();
    const origin = frameObj.localToWorld(new THREE.Vector3(0, 0, spec.thickness));
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(frameObj.matrixWorld);
    const hit = ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin), new THREE.Vector3());
    if (!hit) return;
    const local = frameObj.worldToLocal(hit);
    const [fx, fy] = m.face === 'base' ? [local.x, local.y] : canonicalToFace(spec, m.face, local.x, local.y);
    const size = faceSize(spec, m.face) ?? [spec.width, spec.depth];
    const snap = Math.max(size[0], size[1]) * 0.03;
    const clamp = (v: number, max: number) => {
      const c = Math.min(max, Math.max(0, v));
      return Math.round(c < snap ? 0 : c > max - snap ? max : c);
    };
    onMarkerMove(i, clamp(fx, size[0]), clamp(fy, size[1]));
  };

  // Animation pliage / dépliage.
  useEffect(() => {
    const s = ctx.current;
    if (!s) return;
    const t = gsap.to(s.foldState, { v: fold, duration: 1.1, ease: 'power2.inOut' });
    return () => { t.kill(); };
  }, [fold]);

  useEffect(() => {
    const s = ctx.current;
    if (s) s.controls.autoRotate = autoRotate;
    if (s) s.controls.autoRotateSpeed = 0.8;
  }, [autoRotate]);

  function flyTo(view: ViewName, duration = 0.9) {
    fitDir(new THREE.Vector3(...VIEW_DIR[view]), duration);
  }

  function fitDir(dir: THREE.Vector3, duration: number) {
    const s = ctx.current;
    if (!s?.part) return;
    const { x, y, z } = s.part.size;
    const radius = Math.sqrt(x * x + y * y + z * z) / 2;
    // Le plus petit des deux champs (vertical / horizontal) décide, pour que la pièce tienne quel que soit le cadre.
    const halfV = THREE.MathUtils.degToRad(s.camera.fov / 2);
    const half = Math.min(halfV, Math.atan(Math.tan(halfV) * s.camera.aspect));
    const dist = (radius / Math.sin(half)) * 1.4;
    const to = dir.clone().normalize().multiplyScalar(dist);
    s.controls.autoRotate = false;
    gsap.to(s.controls.target, { x: 0, y: 0, z: 0, duration, ease: 'power3.inOut' });
    gsap.to(s.camera.position, { x: to.x, y: to.y, z: to.z, duration, ease: 'power3.inOut', onUpdate: () => s.camera.lookAt(s.controls.target) });
  }

  useImperativeHandle(ref, () => ({
    setView: (v) => flyTo(v),
    zoom: (factor) => {
      const s = ctx.current;
      if (!s) return;
      const offset = s.camera.position.clone().sub(s.controls.target).multiplyScalar(factor);
      const len = THREE.MathUtils.clamp(offset.length(), s.controls.minDistance, s.controls.maxDistance);
      offset.setLength(len).add(s.controls.target);
      gsap.to(s.camera.position, { x: offset.x, y: offset.y, z: offset.z, duration: 0.45, ease: 'power2.out' });
    },
  }));

  return (
    <div className={`${styles.viewer} ${variant === 'blueprint' ? styles.blueprint : ''} ${className ?? ''}`}>
      <div ref={hostRef} className={styles.canvas} />
      <div ref={labelsRef} className={styles.labels} aria-hidden={!onEdit}>
        {labelDefs(spec).map((d) =>
          onEdit && !spec.imported ? (
            <EditableLabel key={d.key} def={d} request={editRequest} onEdit={onEdit} onMeasure={setLabelMeasure} />
          ) : (
            <span key={d.key} className={`${styles.label} ${d.hole ? styles.holeLabel : ''}`}>{d.text}</span>
          ),
        )}
      </div>
      <div ref={tagsRef} className={styles.markers}>
        {tags.map((t) => (
          <button key={t.id} type="button" className={`${styles.tag} ${t.tone ? styles[`tag_${t.tone}`] : ''}`} onClick={() => onTag?.(t.id)} title={t.title ?? 'Modifier cette découpe'}>
            {t.label}
          </button>
        ))}
      </div>
      <div ref={markersRef} className={styles.markers} aria-hidden>
        {markers.map((_, i) => (
          <span
            key={i}
            className={`${styles.marker} ${onMarkerMove ? styles.markerDrag : ''}`}
            onPointerDown={(e) => {
              if (!onMarkerMove) return;
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              markerDrag.current = i;
              if (ctx.current) ctx.current.controls.enabled = false;
            }}
            onPointerMove={moveMarker}
            onPointerUp={() => {
              markerDrag.current = null;
              if (ctx.current) ctx.current.controls.enabled = true;
            }}
          >
            {i === 0 ? 'A' : 'B'}
          </span>
        ))}
      </div>
    </div>
  );
}

interface Field {
  /** Axe mesuré par ce champ, pour le repère visuel au survol. */
  axis?: 'x' | 'y';
  name: string;
  prefix?: string;
  suffix: string;
  value: number;
  min: number;
  max: number;
}

interface LabelDef {
  key: LabelKey;
  text: string;
  hole?: boolean;
  fields: Field[];
  toEdit: (v: Record<string, number>) => PartEdit;
  remove?: PartEdit;
  /** Étiquette simple : un clic déclenche cette action au lieu d'ouvrir des champs. */
  action?: PartEdit;
  face?: Face;
}

const fr = (n: number) => (Math.round(n * 10) / 10).toLocaleString('fr-FR');

/** Ordre identique à BuiltPart.dims (largeur, profondeur, plis), puis un par perçage. */
function labelDefs(spec: PartSpec): LabelDef[] {
  if (spec.imported) {
    // Fichier importé : encombrement affiché, non modifiable (la géométrie vient du fichier).
    const [x, y, z] = spec.imported.size;
    return [x, y, z].map((v, i) => ({ key: `import:${i}`, text: `${fr(v)} mm`, fields: [], toEdit: () => ({ kind: 'cutOpen', id: '' }) }));
  }
  const p = spec.product;
  if (p) {
    // Produit : encombrement hors tout (même ordre que les cotes de buildProduct).
    const f = (key: 'width' | 'depth' | 'height', v: number): LabelDef => ({ key, text: `${fr(v)} mm`, fields: [{ name: 'v', suffix: 'mm', value: v, min: 100, max: 6000 }], toEdit: (x) => ({ kind: key, value: x.v }) });
    return [f('width', p.width), f('depth', p.depth), f('height', p.height)];
  }
  const defs: LabelDef[] = [
    { key: 'width', text: `${fr(spec.width)} mm`, fields: [{ name: 'v', suffix: 'mm', value: spec.width, min: 1, max: 6000 }], toEdit: (v) => ({ kind: 'width', value: v.v }) },
    { key: 'depth', text: `${fr(spec.depth)} mm`, fields: [{ name: 'v', suffix: 'mm', value: spec.depth, min: 1, max: 6000 }], toEdit: (v) => ({ kind: 'depth', value: v.v }) },
  ];
  spec.flanges.forEach((f, i) =>
    defs.push({
      key: `flange:${i}`,
      text: `${fr(f.height)} mm${f.angle !== 90 ? ` · ${fr(f.angle)}°` : ''}`,
      fields: [
        { name: 'h', suffix: 'mm', value: f.height, min: 1, max: 3000 },
        { name: 'a', suffix: '°', value: f.angle, min: 1, max: 179 },
        // Rayon intérieur de pliage (commun à tous les plis : même outil de presse).
        { name: 'r', prefix: 'R', suffix: 'mm', value: spec.innerRadius ?? spec.thickness, min: 0.5, max: 50 },
      ],
      toEdit: (v) => ({ kind: 'flange', index: i, height: v.h, angle: v.a, radius: v.r }),
    }),
  );
  spec.holes.forEach((h) => {
    const face = h.face ?? 'base';
    const size = faceSize(spec, face) ?? [spec.width, spec.depth];
    defs.push({
      key: `hole:${h.id}`,
      face,
      text: `Ø${fr(h.diameter)}`,
      hole: true,
      fields: [
        { name: 'd', prefix: 'Ø', suffix: 'mm', value: h.diameter, min: 1, max: Math.min(size[0], size[1]) },
        { name: 'x', axis: 'x', prefix: 'X', suffix: '', value: h.x, min: 0, max: size[0] },
        { name: 'y', axis: 'y', prefix: 'Y', suffix: '', value: h.y, min: 0, max: size[1] },
      ],
      toEdit: (v) => ({ kind: 'hole', id: h.id, x: v.x, y: v.y, diameter: v.d }),
      remove: { kind: 'holeDelete', id: h.id },
    });
  });
  (spec.cuts ?? []).forEach((c, i) =>
    defs.push({ key: `cut:${c.id}`, text: `✂ ${i + 1}`, hole: true, fields: [], toEdit: () => ({ kind: 'cutOpen', id: c.id }), action: { kind: 'cutOpen', id: c.id } }),
  );
  return defs;
}

const parse = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'));

/**
 * Étiquette modifiable : un clic ouvre un ou plusieurs champs (clavier direct, pavé numérique sur mobile,
 * sans flèches). Entrée valide, Échap annule ; quitter l'étiquette garde les valeurs valides.
 */
function EditableLabel({ def, request, onEdit, onMeasure }: { def: LabelDef; request: { key: LabelKey; nonce: number } | null; onEdit: (e: PartEdit) => void; onMeasure: (m: Measure | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [invalid, setInvalid] = useState<string | null>(null);
  // Fermer l'éditeur éteint aussi le repère X / Y.
  const close = () => {
    setEditing(false);
    onMeasure(null);
  };
  /** Allume le repère X / Y sur la 3D pour le champ survolé ou en cours de saisie. */
  const show = (axis: 'x' | 'y' | undefined, d = draft) => {
    if (!axis || !def.face) return onMeasure(null);
    const num = (k: string) => { const v = parse(d[k] ?? ''); return Number.isFinite(v) ? v : def.fields.find((f) => f.name === k)?.value ?? 0; };
    onMeasure({ face: def.face, x: num('x'), y: num('y'), axis });
  };

  const open = () => {
    setDraft(Object.fromEntries(def.fields.map((f) => [f.name, String(f.value).replace('.', ',')])));
    setInvalid(null);
    setEditing(true);
  };
  useEffect(() => {
    if (!request) return;
    // Une demande vise une seule étiquette : les autres éditeurs ouverts se ferment.
    if (request.key === def.key) open();
    else if (editing) close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const values = () => {
    const out: Record<string, number> = {};
    for (const f of def.fields) {
      const v = parse(draft[f.name] ?? '');
      if (!Number.isFinite(v) || v < f.min || v > f.max) return { bad: f.name, out };
      out[f.name] = Math.round(v * 10) / 10;
    }
    return { bad: null, out };
  };
  const changed = (out: Record<string, number>) => def.fields.some((f) => out[f.name] !== f.value);
  const commit = () => {
    const { bad, out } = values();
    if (bad) return setInvalid(bad);
    if (changed(out)) onEdit(def.toEdit(out));
    close();
  };

  return (
    <span className={`${styles.label} ${styles.editable} ${def.hole ? styles.holeLabel : ''} ${editing ? styles.editing : ''}`}>
      {editing ? (
        <span
          className={styles.editRow}
          onBlur={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
            onMeasure(null);
            const { bad, out } = values();
            if (!bad && changed(out)) onEdit(def.toEdit(out));
            close();
          }}
        >
          {def.fields.map((f, i) => (
            <label
              key={f.name}
              className={`${invalid === f.name ? styles.invalid : ''} ${f.axis ? styles.axisField : ''}`}
              title={f.axis === 'x' ? 'X : distance horizontale (voir le repère orange)' : f.axis === 'y' ? 'Y : distance verticale (voir le repère orange)' : f.prefix === 'R' ? 'Rayon intérieur de pliage, identique pour tous les plis' : undefined}
              onMouseEnter={() => show(f.axis)}
              onMouseLeave={() => onMeasure(null)}
            >
              {f.prefix && <span>{f.prefix}</span>}
              <input
                autoFocus={i === 0}
                type="text"
                inputMode="decimal"
                enterKeyHint="done"
                autoComplete="off"
                value={draft[f.name] ?? ''}
                size={Math.max(3, (draft[f.name] ?? '').length + 1)}
                onFocus={(e) => { e.target.select(); show(f.axis); }}
                onChange={(e) => {
                  const next = { ...draft, [f.name]: e.target.value.replace(/[^0-9.,]/g, '') };
                  setDraft(next);
                  setInvalid(null);
                  show(f.axis, next);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commit();
                  if (e.key === 'Escape') close();
                  // ↑ / ↓ : ±1 ; Maj + ↑ / ↓ : ±10 (bornés).
                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    const step = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
                    const cur = parse(draft[f.name] ?? '');
                    const next = Math.min(f.max, Math.max(f.min, Math.round(((Number.isFinite(cur) ? cur : f.value) + step) * 10) / 10));
                    const nd = { ...draft, [f.name]: String(next).replace('.', ',') };
                    setDraft(nd);
                    show(f.axis, nd);
                    setInvalid(null);
                  }
                }}
                aria-label={f.prefix === 'R' ? 'Rayon intérieur de pliage (mm)' : f.prefix ? `${f.prefix} (${f.suffix || 'mm'})` : f.suffix === '°' ? 'Angle en degrés' : 'Cote en millimètres'}
              />
              {f.suffix && <span>{f.suffix}</span>}
            </label>
          ))}
          {def.remove && (
            <button type="button" className={styles.remove} onClick={() => { onEdit(def.remove!); close(); }} aria-label="Supprimer" title="Supprimer">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          )}
        </span>
      ) : (
        <button type="button" onClick={def.action ? () => onEdit(def.action!) : open} title={def.key.startsWith('hole:') ? 'Modifier ce perçage' : def.key.startsWith('cut:') ? 'Modifier ou supprimer cette découpe' : 'Modifier cette cote'}>
          {def.text}
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
            <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />
          </svg>
        </button>
      )}
    </span>
  );
}
