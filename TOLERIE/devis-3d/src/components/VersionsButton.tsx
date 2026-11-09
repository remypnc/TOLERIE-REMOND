import { useEffect, useRef, useState } from 'react';
import type { PartVersion } from '../lib/recap';
import styles from './VersionsButton.module.css';

interface Props {
  versions: PartVersion[];
  /** Version identique à la pièce affichée, ou null si elle a été modifiée depuis. */
  current: number | null;
  onRestore: (v: PartVersion) => void;
}

const time = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** Pastille « v3 » : liste des versions de la pièce, retour à l'une d'elles en un clic. */
export function VersionsButton({ versions, current, onRestore }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  const latest = versions[versions.length - 1].n;
  return (
    <div ref={root} className={styles.root}>
      <button
        type="button"
        className={`${styles.badge} ${open ? styles.badgeOn : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Versions de la pièce"
        aria-label={`Versions de la pièce, version ${current ?? latest} affichée`}
      >
        v{current ?? latest}
        {current === null && <i className={styles.dirty} aria-hidden />}
      </button>
      {open && (
        <div className={styles.pop} role="dialog" aria-label="Versions de la pièce">
          <h3>Versions de la pièce</h3>
          <p>Chaque modification crée une version. Revenez à l’une d’elles à tout moment.</p>
          <ol>
            {[...versions].reverse().map((v) => (
              <li key={v.n} className={v.n === current ? styles.now : ''}>
                <b>v{v.n}</b>
                <span>
                  {v.label}
                  <small>{time(v.at)}</small>
                </span>
                {v.n === current ? (
                  <em>affichée</em>
                ) : (
                  <button type="button" onClick={() => { onRestore(v); setOpen(false); }}>Revenir</button>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
