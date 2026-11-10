import type { ViewName } from './Viewer3D';

// Cube isométrique : la face correspondant à la vue est colorée ; les faces cachées sont en pointillé.
const S = 9;
const C30 = Math.cos(Math.PI / 6);
const p = (x: number, y: number, z: number) => [12 + (x - z) * C30 * S, 12.5 + (x + z) * 0.5 * S - y * S + S * 0.05] as const;
const poly = (pts: (readonly [number, number])[]) => pts.map((q) => q.join(',')).join(' ');

const FACES: Record<Exclude<ViewName, 'iso'>, { pts: [number, number, number][]; hidden: boolean }> = {
  face: { pts: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], hidden: false },
  droite: { pts: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], hidden: false },
  dessus: { pts: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], hidden: false },
  arriere: { pts: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], hidden: true },
  gauche: { pts: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], hidden: true },
  dessous: { pts: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], hidden: true },
};

export function ViewCubeIcon({ view }: { view: ViewName }) {
  const visible = (['face', 'droite', 'dessus'] as const).map((k) => FACES[k]);
  const target = view === 'iso' ? null : FACES[view];
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden>
      {/* arêtes cachées */}
      <g fill="none" stroke="currentColor" strokeWidth="0.9" strokeDasharray="1.6 1.6" opacity="0.55">
        <polyline points={poly([p(0, 0, 1), p(0, 0, 0), p(1, 0, 0)])} />
        <line x1={p(0, 0, 0)[0]} y1={p(0, 0, 0)[1]} x2={p(0, 1, 0)[0]} y2={p(0, 1, 0)[1]} />
      </g>
      {target?.hidden && <polygon points={poly(target.pts.map((q) => p(...q)))} fill="var(--accent)" opacity="0.55" />}
      {visible.map((f, i) => (
        <polygon
          key={i}
          points={poly(f.pts.map((q) => p(...q)))}
          fill={view === 'iso' ? 'var(--accent)' : f === target ? 'var(--accent)' : 'transparent'}
          fillOpacity={view === 'iso' ? 0.25 + i * 0.25 : 1}
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

type IconName =
  | 'ruler' | 'unfold' | 'zoomIn' | 'zoomOut' | 'send' | 'clip' | 'expand' | 'collapse' | 'back' | 'check'
  | 'eye' | 'layers' | 'cut' | 'trash' | 'pencil' | 'swap' | 'undo' | 'cursor' | 'drill' | 'bend' | 'resize' | 'palette' | 'note' | 'close' | 'warn' | 'cube' | 'sparkle' | 'drag' | 'save' | 'round' | 'user' | 'mail' | 'phone' | 'plus' | 'mic' | 'download' | 'nut' | 'section' | 'power' | 'door' | 'image';

const PATHS: Record<IconName, string> = {
  ruler: 'M3 17 17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
  unfold: 'M3 20h18M5 20l5-9 4 0 5 9M10 11V5h4v6',
  zoomIn: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5 21 21M10.5 7.5v6M7.5 10.5h6',
  zoomOut: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5 21 21M7.5 10.5h6',
  send: 'M4 12 20 4l-6 16-3-7zM11 13l9-9',
  clip: 'M20 11.5 12 19.5a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17.2a1.7 1.7 0 0 1-2.4-2.4L15 7',
  expand: 'M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7',
  collapse: 'M4 14h6v6M20 10h-6V4M10 14l-7 7M14 10l7-7',
  back: 'M19 12H5M11 6l-6 6 6 6',
  check: 'M4 12.5 9.5 18 20 6',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  pencil: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  swap: 'M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  cut: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  layers: 'M12 3 2 8l10 5 10-5zM2 13l10 5 10-5',
  cursor: 'M5 3l14 7-6 2-2 6z',
  drill: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 3v3M12 18v3M3 12h3M18 12h3',
  bend: 'M4 20V8a4 4 0 0 1 4-4h12',
  round: 'M4 20V12a8 8 0 0 1 8-8h8v16zM4 4h.01M7 4h.01M4 7h.01',
  plus: 'M12 5v14M5 12h14',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3M8 21h8',
  download: 'M12 4v11M7 10l5 5 5-5M4 20h16',
  nut: 'M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
  resize: 'M3 9V3h6M21 15v6h-6M3 3l7 7M21 21l-7-7',
  palette: 'M12 21a9 9 0 1 1 9-9c0 2-1.5 3-3 3h-2a2 2 0 0 0-1.5 3.3A1.6 1.6 0 0 1 12 21zM7.5 11.5h.01M10.5 7.5h.01M15 8h.01',
  note: 'M5 4h14v12l-4 4H5zM15 20v-4h4M8 9h8M8 13h5',
  close: 'M6 6l12 12M18 6 6 18',
  warn: 'M12 3 2 20h20zM12 10v4M12 17h.01',
  cube: 'M12 2 21 7v10l-9 5-9-5V7zM12 12l9-5M12 12 3 7M12 12v10',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z',
  section: 'M4 8l8-4 8 4v8l-8 4-8-4zM2 12h20',
  power: 'M12 3v8M6.3 6.3a8 8 0 1 0 11.4 0',
  door: 'M5 21V4l9-1v18M14 3h5v18h-5M11 12h.01',
  image: 'M4 5h16v14H4zM8.5 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM20 15l-5-5-9 9',
  save: 'M6 3h12v18l-6-4-6 4z',
  drag: 'M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01',
};

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === 'drag' ? 3 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}

export const LOGO_URL = 'https://www.tolerie-remond.com/wp-content/uploads/2025/02/logo-site-tolerie.png';
export const LOGO_WHITE_URL = 'https://www.tolerie-remond.com/wp-content/uploads/2025/02/logo-site-tolerie-blanc.png';
