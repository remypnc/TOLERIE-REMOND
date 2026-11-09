import { useState } from 'react';
import type { Edge, Face, PartSpec, ProductSpec } from '../lib/types';
import { faceList, faceSize, holesOn } from '../lib/faces';
import { PRODUCTS, productModel } from '../lib/products';
import type { PartEdit } from './Viewer3D';
import { Icon } from './Icons';
import styles from './CutPanel.module.css';
import own from './SelectPanel.module.css';

const fr = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const parse = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'));
const SIDE: Record<Edge, string> = { nord: 'arrière', sud: 'avant', est: 'droite', ouest: 'gauche' };

/** Champ numérique : on tape librement, la valeur est appliquée à Entrée ou en quittant le champ (si elle est valide). */
function NumField({ label, value, unit = 'mm', min, max, onCommit }: { label: string; value: number; unit?: string; min: number; max: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const v = draft ?? fr(value);
  const commit = () => {
    if (draft === null) return;
    const x = parse(draft);
    setDraft(null);
    if (Number.isFinite(x) && x >= min && x <= max && x !== value) onCommit(Math.round(x * 10) / 10);
  };
  return (
    <label className={own.num}>
      <span>{label}</span>
      <input type="text" inputMode="decimal" value={v} onChange={(e) => setDraft(e.target.value.replace(/[^0-9.,]/g, ''))} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} onFocus={(e) => e.target.select()} />
      <em>{unit}</em>
    </label>
  );
}

interface FaceProps {
  spec: PartSpec;
  face: Face;
  onSelect: (f: Face) => void;
  onEdit: (e: PartEdit) => void;
  onFlange: (edge: Edge, add: boolean) => void;
  onTool: (t: 'drill' | 'cut' | 'round' | 'insert') => void;
  onDescribe: (text: string) => void;
  onClose: () => void;
}

/** Face sélectionnée (« Face 2 · aile arrière ») : ses cotes, ses actions, et le passage aux autres faces. */
export function FacePanel({ spec, face, onSelect, onEdit, onFlange, onTool, onDescribe, onClose }: FaceProps) {
  const faces = faceList(spec);
  const cur = faces.find((f) => f.face === face) ?? faces[0];
  const size = faceSize(spec, cur.face) ?? [spec.width, spec.depth];
  const flangeIndex = spec.flanges.findIndex((f) => f.edge === cur.face);
  const flange = spec.flanges[flangeIndex];
  const holes = holesOn(spec, cur.face).length;
  const free = (['sud', 'nord', 'ouest', 'est'] as Edge[]).filter((e) => !spec.flanges.some((f) => f.edge === e && f.height > 0));
  return (
    <section className={styles.panel} aria-label={`Face ${cur.n}`}>
      <header className={styles.head}>
        <span className={own.badge}>{cur.n}</span>
        <h3>Face {cur.n} · {cur.label}</h3>
        <button type="button" className={styles.close} onClick={onClose} title="Fermer" aria-label="Fermer"><Icon name="close" size={16} /></button>
      </header>
      <div className={own.tabs} role="tablist" aria-label="Faces de la pièce">
        {faces.map((f) => (
          <button key={f.face} type="button" role="tab" aria-selected={f.face === cur.face} className={f.face === cur.face ? own.tabOn : ''} onClick={() => onSelect(f.face)} title={f.label}>{f.n}</button>
        ))}
      </div>
      <p className={styles.help}>
        {fr(size[0])} × {fr(size[1])} mm{holes ? ` · ${holes} perçage${holes > 1 ? 's' : ''}` : ''}{flange && flange.angle !== 90 ? ` · pliée à ${fr(flange.angle)}°` : ''}
      </p>
      <div className={own.fields}>
        {cur.face === 'base' ? (
          <>
            <NumField label="Longueur" value={spec.width} min={10} max={6000} onCommit={(v) => onEdit({ kind: 'width', value: v })} />
            <NumField label="Largeur" value={spec.depth} min={10} max={6000} onCommit={(v) => onEdit({ kind: 'depth', value: v })} />
          </>
        ) : flange && (
          <>
            <NumField label="Hauteur" value={flange.height} min={3} max={3000} onCommit={(v) => onEdit({ kind: 'flange', index: flangeIndex, height: v, angle: flange.angle, radius: spec.innerRadius ?? spec.thickness })} />
            <NumField label="Angle" unit="°" value={flange.angle} min={1} max={179} onCommit={(v) => onEdit({ kind: 'flange', index: flangeIndex, height: flange.height, angle: v, radius: spec.innerRadius ?? spec.thickness })} />
          </>
        )}
      </div>
      <div className={own.actions}>
        <button type="button" onClick={() => onTool('drill')}><Icon name="drill" size={16} /> Percer</button>
        <button type="button" onClick={() => onTool('insert')}><Icon name="nut" size={16} /> Insert</button>
        <button type="button" onClick={() => onTool('cut')}><Icon name="cut" size={16} /> Découper</button>
        <button type="button" onClick={() => onTool('round')}><Icon name="round" size={16} /> Arrondir</button>
      </div>
      {cur.face === 'base' && free.length > 0 && (
        <div className={own.addRow}>
          <span>Ajouter une aile :</span>
          {free.map((e) => <button key={e} type="button" onClick={() => onFlange(e, true)}>+ {SIDE[e]}</button>)}
        </div>
      )}
      <button type="button" className={own.describe} onClick={() => onDescribe(`Face ${cur.n} (${cur.label.toLowerCase()}) : `)}>
        <Icon name="pencil" size={15} /> Décrire une modification de cette face
      </button>
      {cur.face !== 'base' && (
        <button type="button" className={styles.deleteLink} onClick={() => onFlange(cur.face as Edge, false)}>
          <Icon name="trash" size={14} /> Supprimer cette aile
        </button>
      )}
    </section>
  );
}

interface ProductProps {
  spec: PartSpec;
  /** Panneau sélectionné (id), ou null. */
  panel: string | null;
  onChange: (p: ProductSpec) => void;
  onDescribe: (text: string) => void;
  onClose: () => void;
}

/** Produit assemblé : encombrement et réglages propres au produit, plus le panneau touché sur la 3D. */
export function ProductPanel({ spec, panel, onChange, onDescribe, onClose }: ProductProps) {
  const p = spec.product!;
  const def = PRODUCTS[p.kind];
  const model = productModel(p, spec.thickness);
  const index = model.panels.findIndex((x) => x.id === panel);
  const sel = model.panels[index];
  const set = (k: string, v: number | boolean | string) => onChange({ ...p, options: { ...p.options, [k]: v } });
  const dim = (k: 'width' | 'height' | 'depth') => (v: number) => onChange({ ...p, [k]: Math.min(def.limits[k][1], Math.max(def.limits[k][0], v)) });
  return (
    <section className={styles.panel} aria-label={def.label}>
      <header className={styles.head}>
        <Icon name="cube" size={18} />
        <h3>{def.label}</h3>
        <button type="button" className={styles.close} onClick={onClose} title="Fermer" aria-label="Fermer"><Icon name="close" size={16} /></button>
      </header>
      {sel ? (
        <div className={own.picked}>
          <span className={own.badge}>{index + 1}</span>
          <p>
            <b>Panneau {index + 1} · {sel.label}</b>
            <small>{[...sel.size].sort((a, b) => b - a).slice(0, 2).map(fr).join(' × ')} mm · {sel.sheet ? `tôle, ${sel.sheet.bends} plis` : 'composant'}</small>
          </p>
        </div>
      ) : (
        <p className={styles.help}>Touchez un panneau de la 3D pour le désigner, ou réglez l’ensemble ci-dessous.</p>
      )}
      {sel && (
        <button type="button" className={own.describe} onClick={() => onDescribe(`Panneau ${index + 1} (${sel.label.toLowerCase()}) : `)}>
          <Icon name="pencil" size={15} /> Décrire une modification de ce panneau
        </button>
      )}
      <div className={own.fields}>
        <NumField label="Largeur" value={p.width} min={def.limits.width[0]} max={def.limits.width[1]} onCommit={dim('width')} />
        <NumField label="Hauteur" value={p.height} min={def.limits.height[0]} max={def.limits.height[1]} onCommit={dim('height')} />
        <NumField label="Profondeur" value={p.depth} min={def.limits.depth[0]} max={def.limits.depth[1]} onCommit={dim('depth')} />
      </div>
      <div className={own.params}>
        {def.params.filter((prm) => !prm.if || p.options[prm.if]).map((prm) =>
          prm.type === 'choice' ? (
            <div key={prm.key} className={own.choice}>
              <span>{prm.label}</span>
              <div>
                {prm.choices!.map((c) => (
                  <button key={c.value} type="button" className={p.options[prm.key] === c.value ? own.choiceOn : ''} onClick={() => set(prm.key, c.value)}>{c.label}</button>
                ))}
              </div>
            </div>
          ) : prm.type === 'bool' ? (
            <label key={prm.key} className={own.toggle}>
              <input type="checkbox" checked={Boolean(p.options[prm.key])} onChange={(e) => set(prm.key, e.target.checked)} />
              <span>{prm.label}</span>
            </label>
          ) : (
            <div key={prm.key} className={own.stepper}>
              <span>{prm.label}</span>
              <button type="button" aria-label={`Moins : ${prm.label}`} disabled={Number(p.options[prm.key]) <= (prm.min ?? 0)} onClick={() => set(prm.key, Math.max(prm.min ?? 0, Number(p.options[prm.key]) - (prm.step ?? 1)))}>−</button>
              <b>{fr(Number(p.options[prm.key]))}{prm.unit ? ` ${prm.unit}` : ''}</b>
              <button type="button" aria-label={`Plus : ${prm.label}`} disabled={Number(p.options[prm.key]) >= (prm.max ?? Infinity)} onClick={() => set(prm.key, Math.min(prm.max ?? Infinity, Number(p.options[prm.key]) + (prm.step ?? 1)))}>+</button>
            </div>
          ),
        )}
      </div>
      <p className={styles.hint}>{model.panels.filter((x) => x.sheet).length} tôles à fabriquer · {model.motions.filter((m) => !m.auto).length} ouvrants</p>
    </section>
  );
}

