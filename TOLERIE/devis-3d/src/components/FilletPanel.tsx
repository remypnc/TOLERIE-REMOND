import { useState } from 'react';
import type { Fillet } from '../lib/types';
import { FACE_LABEL } from '../lib/faces';
import { Icon } from './Icons';
import styles from './CutPanel.module.css';

interface Props {
  /** Arrondi sélectionné sur la pièce, ou null (le rayon sert alors aux prochains angles). */
  selected: Fillet | null;
  /** Rayon proposé pour les prochains angles. */
  radius: number;
  count: number;
  onRadius: (r: number) => void;
  onAll: () => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
}

const fr = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const parse = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'));
const PRESETS = [2, 5, 10, 20];

/** Arrondis d'angle : on touche un angle sur la pièce, le rayon se règle ici. */
export function FilletPanel({ selected, radius, count, onRadius, onAll, onDelete, onClear, onClose }: Props) {
  const value = selected?.radius ?? radius;
  const [text, setText] = useState<string | null>(null);
  const commit = (raw: string) => {
    const v = parse(raw);
    if (Number.isFinite(v) && v > 0) onRadius(Math.min(500, Math.round(v * 10) / 10));
    setText(null);
  };
  return (
    <section className={styles.panel} aria-label="Arrondir les angles">
      <header className={styles.head}>
        <Icon name="round" size={18} />
        <h3>{selected ? 'Angle arrondi' : 'Arrondir les angles'}</h3>
        <button type="button" className={styles.close} onClick={onClose} title="Fermer" aria-label="Fermer">
          <Icon name="close" size={16} />
        </button>
      </header>
      <p className={styles.help}>
        {selected ? <>Sur {FACE_LABEL[selected.face ?? 'base'].toLowerCase()}. Changez son rayon ou touchez un autre angle.</> : <>Touchez un angle <b>+ R</b> sur la pièce pour l’arrondir.</>}
      </p>

      <label className={styles.num}>
        <b>R</b>
        <input
          type="text"
          inputMode="decimal"
          value={text ?? fr(value)}
          onFocus={(e) => { setText(fr(value)); e.target.select(); }}
          onChange={(e) => setText(e.target.value.replace(/[^0-9.,]/g, ''))}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            e.preventDefault();
            const next = Math.max(0.5, value + (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1));
            setText(fr(next));
            onRadius(next);
          }}
          aria-label="Rayon de l’arrondi en millimètres"
        />
        <span>mm de rayon</span>
      </label>
      <div className={styles.presets}>
        {PRESETS.map((r) => (
          <button key={r} type="button" className={r === value ? styles.presetOn : ''} onClick={() => onRadius(r)}>R{r}</button>
        ))}
      </div>

      <button type="button" className={styles.flip} onClick={onAll}>
        <Icon name="round" size={17} /> Arrondir tous les angles
      </button>
      {selected && (
        <button type="button" className={styles.deleteLink} onClick={() => onDelete(selected.id)}>
          <Icon name="trash" size={14} /> Supprimer cet arrondi
        </button>
      )}
      {!selected && count > 0 && (
        <button type="button" className={styles.deleteLink} onClick={onClear}>
          <Icon name="trash" size={14} /> Retirer les {count} arrondis
        </button>
      )}
    </section>
  );
}
