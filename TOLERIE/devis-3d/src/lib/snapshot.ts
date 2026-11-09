// Rendu hors écran de la pièce en image, pour la couverture et l'intérieur de la carte devis.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildPart } from './partGeometry';
import type { PartSpec } from './types';

export type SnapStyle = 'day' | 'night';

/** « day » : pièce réaliste sur fond clair ; « night » : vue plan bleu marine, arêtes claires. */
export function renderSnapshot(spec: PartSpec, style: SnapStyle, width: number, height: number, ratio = 2): string {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(ratio);
  renderer.setSize(width, height, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;

  const part = buildPart(spec, 1);
  part.dimGroup.visible = style === 'night';
  if (style === 'night') {
    const bg = document.createElement('canvas');
    bg.width = 2; bg.height = 256;
    const g = bg.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#1b3f7d');
    grad.addColorStop(1, '#0a1a3c');
    g.fillStyle = grad;
    g.fillRect(0, 0, 2, 256);
    scene.background = new THREE.CanvasTexture(bg);
    const ghost = new THREE.MeshBasicMaterial({ color: 0x2a5aa0, transparent: true, opacity: 0.35 });
    part.meshes.forEach((m) => {
      m.material = ghost;
      m.children.forEach((c) => { if (c instanceof THREE.LineSegments) c.material = new THREE.LineBasicMaterial({ color: 0xbfe9ff }); });
    });
  } else {
    const bg = document.createElement('canvas');
    bg.width = 2; bg.height = 256;
    const g = bg.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#eef3f9');
    grad.addColorStop(1, '#c9d6e6');
    g.fillStyle = grad;
    g.fillRect(0, 0, 2, 256);
    scene.background = new THREE.CanvasTexture(bg);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9fb0c8, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(300, 900, 500);
    scene.add(sun);
  }
  scene.add(part.root);

  const camera = new THREE.PerspectiveCamera(30, width / height, 1, 50000);
  const { x, y, z } = part.size;
  const r = Math.sqrt(x * x + y * y + z * z) / 2;
  const dist = (r / Math.sin(THREE.MathUtils.degToRad(15))) * (width < height ? 1.75 : 1.15);
  camera.position.copy(new THREE.Vector3(1, 0.9, 1.3).normalize().multiplyScalar(dist));
  camera.lookAt(0, -y * 0.08, 0);
  renderer.render(scene, camera);
  // Petites vignettes (espace client) en JPEG : bien plus légères à stocker.
  const url = ratio < 2 ? renderer.domElement.toDataURL('image/jpeg', 0.82) : renderer.domElement.toDataURL('image/png');

  part.dispose();
  env.dispose();
  pmrem.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  return url;
}
