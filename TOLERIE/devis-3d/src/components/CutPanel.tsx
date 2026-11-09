import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Measure } from './Viewer3D';
import type { Cut, PartSpec } from '../lib/types';
import { FACE_LABEL, facePolygon, faceSize, removedPolygon } from '../lib/faces';
import { Icon } from './Icons';
import styles from './CutPanel.module.css';

interface Props {
  /** Pièce sans la découpe en préparation. */
  spec: PartSpec;
  /** Découpe en préparation (nouvelle ou en cours de modification). */
  draft: Cut | null;
  editing: boolean;
  onChange: (c: Cut) => void;
  onValidate: () => void;
  onCancel: () => void;
  onDelete: (id: string) => void;
  /** Allume le repère X / Y correspondant sur la 3D (null pour l'éteindre). */
  onMeasure: (m: Measure | null) => void;
}

const fr = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const parse = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'));

/** Panneau de découpe : schéma de la face, deux points en clair, aperçu avant de valider, liste des découpes. */
export function CutPanel({ spec, draft, editing, onChange, onValidate, onCancel, onDelete, onMeasure }: Props) {
  return (
    <section className={styles.panel} aria-label="Découpes">
      <header className={styles.head}>
        <Icon name="cut" size={18} />
        <h3>{editing ? 'Modifier la découpe' : 'Nouvelle découpe'}</h3>
        {draft && (
          <button type="button" className={styles.close} onClick={onCancel} title={editing ? 'Fermer sans enregistrer' : 'Fermer sans couper'} aria-label={editing ? 'Fermer sans enregistrer' : 'Fermer sans couper'}>
            <Icon name="close" size={16} />
          </button>
        )}
      </header>

      {draft && <DraftEditor spec={spec} draft={draft} onChange={onChange} onMeasure={onMeasure} />}

      {draft && (
        <>
          <button type="button" className={styles.primary} onClick={onValidate}>
            <Icon name="check" size={17} /> {editing ? 'Enregistrer' : 'Valider la découpe'}
          </button>
          {editing && (
            <button type="button" className={styles.deleteLink} onClick={() => onDelete(draft.id)}>
              <Icon name="trash" size={14} /> Supprimer cette découpe
            </button>
          )}
        </>
      )}
    </section>
  );
}

type PointN = '1' | '2';

function DraftEditor({ spec, draft, onChange, onMeasure }: { spec: PartSpec; draft: Cut; onChange: (c: Cut) => void; onMeasure: (m: Measure | null) => void }) {
  const face = draft.face ?? 'base';
  const size = faceSize(spec, face) ?? [spec.width, spec.depth];
  const svgRef = useRef<SVGSVGElement>(null);
  // Point actif (dernier touché) : ses X / Y sont tracés en pointillés ; l'axe survolé est renforcé.
  const [active, setActive] = useState<PointN>('1');
  const [axisHl, setAxisHl] = useState<'x' | 'y' | 'xy' | null>(null);
  const [dragging, setDragging] = useState<PointN | null>(null);

  const highlight = (n: PointN, axis: 'x' | 'y' | 'xy' | null, c = draft) => {
    setActive(n);
    setAxisHl(axis);
    onMeasure(axis ? { face, x: c[`x${n}`], y: c[`y${n}`], axis } : null);
  };

  // Glisser A ou B dans le schéma (aimanté sur les bords).
  const toFace = (e: { clientX: number; clientY: number }): [number, number] | null => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    const snap = Math.max(size[0], size[1]) * 0.04;
    const clamp = (v: number, max: number) => {
      const c = Math.min(max, Math.max(0, v));
      return Math.round(c < snap ? 0 : c > max - snap ? max : c);
    };
    return [clamp(p.x, size[0]), clamp(size[1] - p.y, size[1])];
  };
  const onDragMove = (e: ReactPointerEvent) => {
    if (!dragging) return;
    const pt = toFace(e);
    if (!pt) return;
    const next = { ...draft, [`x${dragging}`]: pt[0], [`y${dragging}`]: pt[1] };
    onChange(next);
    highlight(dragging, 'xy', next);
  };

  const keep = facePolygon(spec, face, [draft]);
  const removed = removedPolygon(spec, draft);

  // Schéma de la face, y vers le haut ; origine (0) en bas à gauche.
  const pad = Math.max(size[0], size[1]) * 0.12;
  const fs = pad * 0.42;
  const sy = (y: number) => size[1] - y;
  const poly = (pts: [number, number][]) => pts.map(([x, y]) => `${x},${sy(y)}`).join(' ');
  const ax = draft[`x${active}`];
  const ay = draft[`y${active}`];

  return (
    <>
      <p className={styles.faceName}>{FACE_LABEL[face]} · {fr(size[0])} × {fr(size[1])} mm</p>
      <svg
        ref={svgRef}
        className={styles.sketch}
        viewBox={`${-pad} ${-pad * 0.6} ${size[0] + pad * 2.6} ${size[1] + pad * 1.8}`}
        onPointerMove={onDragMove}
        onPointerUp={() => { setDragging(null); highlight(active, null); }}
        onPointerLeave={() => { if (!dragging) highlight(active, null); }}
      >
        <polygon points={poly(keep)} className={styles.keep} />
        {removed.length > 2 && <polygon points={poly(removed)} className={styles.removed} />}
        <line x1={draft.x1} y1={sy(draft.y1)} x2={draft.x2} y2={sy(draft.y2)} className={styles.line} />

        {/* X et Y du point actif, en pointillés depuis les bords (origine en bas à gauche) */}
        <g className={styles.dash}>
          <line x1={0} y1={sy(ay)} x2={ax} y2={sy(ay)} className={axisHl === 'x' || axisHl === 'xy' ? styles.dashOn : ''} />
          <line x1={ax} y1={sy(0)} x2={ax} y2={sy(ay)} className={axisHl === 'y' || axisHl === 'xy' ? styles.dashOn : ''} />
          {ax > fs * 2 && <text x={ax / 2} y={sy(ay) - fs * 0.35} style={{ fontSize: fs }} textAnchor="middle">X {fr(ax)}</text>}
          {ay > fs * 1.5 && <text x={ax + fs * 0.35} y={sy(ay / 2) + fs * 0.35} style={{ fontSize: fs }}>Y {fr(ay)}</text>}
        </g>

        {/* Repère : origine 0, X vers la droite, Y vers le haut */}
        <g className={styles.axes} style={{ fontSize: fs }}>
          <circle cx={0} cy={sy(0)} r={fs * 0.25} />
          <text x={-fs * 0.5} y={sy(0) + fs * 1.1} textAnchor="middle">0</text>
          <text x={size[0]} y={sy(0) + fs * 1.2} textAnchor="end">X →</text>
          <text x={-fs * 0.3} y={sy(size[1]) + fs * 0.2} textAnchor="end">Y</text>
          <text x={-fs * 0.3} y={sy(size[1]) + fs * 1.1} textAnchor="end">↑</text>
        </g>

        {(['1', '2'] as const).map((n) => (
          <g
            key={n}
            className={`${styles.handle} ${dragging === n ? styles.handleOn : ''}`}
            transform={`translate(${draft[`x${n}`]} ${sy(draft[`y${n}`])})`}
            onPointerDown={(e) => { (e.currentTarget.ownerSVGElement ?? e.currentTarget).setPointerCapture(e.pointerId); setDragging(n); highlight(n, 'xy'); }}
            onPointerEnter={() => { if (!dragging) highlight(n, 'xy'); }}
          >
            <circle r={fs * 0.75} className={styles.dot} />
            <text dy={fs * 0.32} className={styles.dotText} style={{ fontSize: fs * 0.85 }}>{n === '1' ? 'A' : 'B'}</text>
          </g>
        ))}
      </svg>
      <p className={styles.hint}>Glissez A ou B, ou tapez les cotes.</p>

      {(['1', '2'] as const).map((n) => (
        <fieldset
          key={n}
          className={`${styles.point} ${active === n ? styles.pointOn : ''}`}
          // Survoler n'importe où dans le bloc du point l'active (pas seulement les champs).
          onMouseEnter={() => highlight(n, 'xy')}
          onMouseLeave={(e) => { if (!e.currentTarget.contains(document.activeElement)) highlight(n, null); }}
        >
          <legend>Point {n === '1' ? 'A' : 'B'}</legend>
          {(['x', 'y'] as const).map((axis) => (
            <Num
              key={axis}
              label={axis.toUpperCase()}
              value={draft[`${axis}${n}`]}
              max={axis === 'x' ? size[0] : size[1]}
              onHover={(on) => highlight(n, on ? axis : 'xy')}
              onChange={(v) => {
                const next = { ...draft, [`${axis}${n}`]: v };
                onChange(next);
                highlight(n, axis, next);
              }}
            />
          ))}
        </fieldset>
      ))}

      <button type="button" className={styles.flip} onClick={() => onChange({ ...draft, flip: !draft.flip })}>
        <Icon name="swap" size={17} /> Inverser la zone retirée
      </button>
      <p className={styles.legend}><i /> en rouge : ce qui sera retiré</p>
    </>
  );
}

/** Champ numérique sans flèches : clavier direct, ↑/↓ ±1, Maj ±10. */
function Num({ label, value, max, onChange, onHover }: { label: string; value: number; max: number; onChange: (v: number) => void; onHover: (on: boolean) => void }) {
  const [text, setText] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const shown = text ?? fr(value);
  const commit = (raw: string) => {
    const v = parse(raw);
    if (Number.isFinite(v)) onChange(Math.min(max, Math.max(0, Math.round(v * 10) / 10)));
  };
  return (
    <label className={styles.num} onMouseEnter={() => onHover(true)} onMouseLeave={() => { if (document.activeElement !== inputRef.current) onHover(false); }}>
      <b>{label}</b>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={shown}
        onFocus={(e) => { setText(fr(value)); e.target.select(); onHover(true); }}
        onChange={(e) => { const t = e.target.value.replace(/[^0-9.,]/g, ''); setText(t); commit(t); }}
        onBlur={() => { setText(null); onHover(false); }}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
          e.preventDefault();
          const next = Math.min(max, Math.max(0, value + (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1)));
          setText(fr(next));
          onChange(next);
        }}
      />
      <span>mm</span>
    </label>
  );
}
