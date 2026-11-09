import { useState } from 'react';
import type { FlatPattern, NestingResult } from '../lib/types';
import { Icon } from './Icons';
import styles from './FlatPanel.module.css';

const mm = (n: number, d = 1) => n.toLocaleString('fr-FR', { maximumFractionDigits: d });
const kg = (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} kg`;

interface Props {
  flat: FlatPattern;
  nesting: NestingResult;
  quantity: number;
  onClose: () => void;
}

export function FlatPanel({ flat, nesting, quantity, onClose }: Props) {
  const [tab, setTab] = useState<'flat' | 'nest'>('flat');
  return (
    <section className={styles.panel} aria-label="Patron et imbrication">
      <header className={styles.head}>
        <div className={styles.tabs} role="tablist">
          <button role="tab" aria-selected={tab === 'flat'} onClick={() => setTab('flat')}>Patron déplié</button>
          <button role="tab" aria-selected={tab === 'nest'} onClick={() => setTab('nest')}>Imbrication tôle</button>
        </div>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Fermer le patron"><Icon name="close" size={18} /></button>
      </header>
      {tab === 'flat' ? <FlatDrawing flat={flat} /> : <NestDrawing flat={flat} nesting={nesting} quantity={quantity} />}
    </section>
  );
}

/** Le flan dessiné face par face (un sous-tracé par face). */
function outlinePath(flat: FlatPattern, ox = 0, oy = 0, rotated = false) {
  const H = flat.blankHeight;
  // SVG : y vers le bas → on retourne le flan pour garder le repère plan (y vers le haut).
  const pt = ([x, y]: [number, number]) => (rotated ? [ox + y, oy + x] : [ox + x, oy + (H - y)]);
  return flat.faces.map((f) => f.map((p, i) => `${i ? 'L' : 'M'}${pt(p).join(' ')}`).join(' ') + ' Z').join(' ');
}

function FlatDrawing({ flat }: { flat: FlatPattern }) {
  const { blankWidth: W, blankHeight: H } = flat;
  const pad = Math.max(W, H) * 0.14;
  const font = Math.max(W, H) * 0.032;
  return (
    <div className={styles.body}>
      <svg className={styles.svg} viewBox={`${-pad} ${-pad} ${W + pad * 2} ${H + pad * 2}`}>
        <path d={outlinePath(flat)} className={styles.blank} />
        {/* Jonctions entre faces : pas de découpe à cet endroit */}
        {flat.seams.map(([x1, y1, x2, y2], i) => (
          <line key={i} x1={x1} y1={H - y1} x2={x2} y2={H - y2} className={styles.seam} />
        ))}
        {flat.bendLines.map((b, i) => (
          <line key={i} x1={b.x1} y1={H - b.y1} x2={b.x2} y2={H - b.y2} className={styles.bend} />
        ))}
        {flat.holes.map((h) => (
          <circle key={h.id} cx={h.x} cy={H - h.y} r={h.diameter / 2} className={styles.hole} />
        ))}
        {/* cotes du flan */}
        <g className={styles.dim} style={{ fontSize: font }}>
          <line x1={0} y1={H + pad * 0.45} x2={W} y2={H + pad * 0.45} />
          <line x1={0} y1={H + pad * 0.25} x2={0} y2={H + pad * 0.6} />
          <line x1={W} y1={H + pad * 0.25} x2={W} y2={H + pad * 0.6} />
          <text x={W / 2} y={H + pad * 0.45 - font * 0.4} textAnchor="middle">{mm(W, 2)} mm</text>
          <line x1={-pad * 0.45} y1={0} x2={-pad * 0.45} y2={H} />
          <line x1={-pad * 0.6} y1={0} x2={-pad * 0.25} y2={0} />
          <line x1={-pad * 0.6} y1={H} x2={-pad * 0.25} y2={H} />
          <text x={-pad * 0.45 - font * 0.4} y={H / 2} textAnchor="middle" transform={`rotate(-90 ${-pad * 0.45 - font * 0.4} ${H / 2})`}>{mm(H, 2)} mm</text>
        </g>
      </svg>
      <div className={styles.side}>
        <h3>Développé</h3>
        <dl className={styles.kv}>
          <dt>Flan</dt><dd>{mm(W, 2)} × {mm(H, 2)} mm</dd>
          <dt>Surface nette</dt><dd>{mm(flat.area / 1e6, 4)} m²</dd>
          <dt>Masse / pièce</dt><dd>{kg(flat.mass)}</dd>
          <dt>Longueur de coupe</dt><dd>{mm(flat.cutLength / 1000, 2)} m</dd>
          <dt>Amorçages</dt><dd>{flat.pierces}</dd>
          <dt>Plis</dt><dd>{flat.bendLines.length}</dd>
        </dl>
        {flat.notes.length > 0 && (
          <>
            <h3>Pertes au pli</h3>
            <ul className={styles.notes}>{flat.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          </>
        )}
        <p className={styles.legend}><i className={styles.lgBend} /> ligne de pli <i className={styles.lgCut} /> découpe laser</p>
      </div>
    </div>
  );
}

function NestDrawing({ flat, nesting, quantity }: { flat: FlatPattern; nesting: NestingResult; quantity: number }) {
  const { sheet } = nesting;
  const best = nesting;
  return (
    <div className={styles.body}>
      <svg className={styles.svg} viewBox={`-20 -20 ${sheet.width + 40} ${sheet.height + 40}`}>
        <rect x={0} y={0} width={sheet.width} height={sheet.height} className={styles.sheet} />
        <rect x={best.margin} y={best.margin} width={sheet.width - best.margin * 2} height={sheet.height - best.margin * 2} className={styles.margin} />
        {nesting.placements.map((p, i) => (
          <g key={i} className={i < quantity ? styles.placed : styles.spare}>
            <path d={outlinePath(flat, p.x, p.y, p.rotated)} />
          </g>
        ))}
      </svg>
      <div className={styles.side}>
        <h3>Imbrication</h3>
        <dl className={styles.kv}>
          <dt>Format retenu</dt><dd>{sheet.label}</dd>
          <dt>Pièces / tôle</dt><dd>{best.perSheet}</dd>
          <dt>Tôles pour {quantity} pc</dt><dd>{best.sheets}</dd>
          <dt>Utilisation</dt><dd><Gauge v={best.utilisation} /></dd>
          <dt>Tôle achetée</dt><dd>{kg(best.sheetMass)}</dd>
          <dt>Chute</dt><dd>{kg(best.scrapMass)}</dd>
          <dt>Écart / marge</dt><dd>{best.gap} / {best.margin} mm</dd>
        </dl>
        {nesting.alternatives.length > 0 && (
          <>
            <h3>Autres formats</h3>
            <table className={styles.alt}>
              <thead><tr><th>Format</th><th>pc/tôle</th><th>tôles</th><th>util.</th></tr></thead>
              <tbody>
                {nesting.alternatives.map((a) => (
                  <tr key={a.sheet.label}>
                    <td>{a.sheet.label}</td><td>{a.perSheet}</td><td>{a.sheets}</td><td>{Math.round(a.utilisation * 100)} %</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <p className={styles.legend}><i className={styles.lgPlaced} /> pièces du lot <i className={styles.lgSpare} /> places libres</p>
      </div>
    </div>
  );
}

function Gauge({ v }: { v: number }) {
  const pct = Math.round(v * 100);
  return (
    <span className={styles.gauge}>
      <span style={{ width: `${pct}%` }} />
      <b>{pct} %</b>
    </span>
  );
}
