import { useEffect, useRef, useState } from 'react';
import type { PartSpec } from '../lib/types';
import { Viewer3D, type ViewerHandle } from './Viewer3D';
import { Icon, ViewCubeIcon } from './Icons';
import styles from './View3DModal.module.css';

/** Vue 3D réaliste en grand, sur fond sombre ; se referme sur le blueprint. */
export function View3DModal({ spec, open, onClose }: { spec: PartSpec; open: boolean; onClose: () => void }) {
  const [dims, setDims] = useState(false);
  const viewer = useRef<ViewerHandle>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.card} role="dialog" aria-modal aria-label={`${spec.name}, vue 3D`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.bar}>
          <span className={styles.title}>{spec.name} — vue 3D</span>
          {(['iso', 'face', 'dessus', 'droite', 'gauche'] as const).map((v) => (
            <button key={v} type="button" className={styles.btn} onClick={() => viewer.current?.setView(v)} aria-label={`Vue ${v}`} title={`Vue ${v}`}>
              <ViewCubeIcon view={v} />
            </button>
          ))}
          <button type="button" className={`${styles.btn} ${dims ? styles.on : ''}`} onClick={() => setDims((d) => !d)} aria-pressed={dims} title="Cotes">
            <Icon name="ruler" size={18} />
          </button>
          <button ref={closeRef} type="button" className={styles.close} onClick={onClose}>
            <Icon name="collapse" size={16} /> Revenir au plan
          </button>
        </div>
        <div className={styles.view}>
          <Viewer3D ref={viewer} spec={spec} showDims={dims} />
        </div>
      </div>
    </div>
  );
}
