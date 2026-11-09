import type { Hardware, HardwareKind, Hole } from '../lib/types';
import { PRE_HOLE, THREADS } from '../lib/hardware';
import { FACE_LABEL } from '../lib/faces';
import { Icon } from './Icons';
import styles from './CutPanel.module.css';

interface Props {
  /** Perçage sélectionné sur la pièce, ou null (le choix sert alors aux prochains perçages posés). */
  selected: Hole | null;
  /** Insert proposé pour les prochains perçages. */
  choice: Hardware;
  thickness: number;
  count: number;
  onChoice: (h: Hardware) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}

const fr = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
const KINDS: HardwareKind[] = ['ecrou', 'goujon', 'taraudage'];
// Libellés courts : on comprend déjà qu'écrou et goujon se sertissent.
const SHORT: Record<HardwareKind, string> = { ecrou: 'Écrou', goujon: 'Goujon', taraudage: 'Taraudage' };
const REMOVE: Record<HardwareKind, string> = { ecrou: 'Retirer l’écrou', goujon: 'Retirer le goujon', taraudage: 'Retirer le taraudage' };

/** Goujonnage, sertissage et taraudage : on touche un perçage (ou la pièce pour en poser un), l'insert se règle ici. */
export function InsertPanel({ selected, choice, thickness, count, onChoice, onRemove, onClose }: Props) {
  const value = selected?.hardware ?? choice;
  const spec = PRE_HOLE[value.kind][value.thread];
  const thin = thickness < spec.minThickness;
  return (
    <section className={styles.panel} aria-label="Goujonnage, sertissage et taraudage">
      <header className={styles.head}>
        <Icon name="nut" size={18} />
        <h3>{selected ? (selected.hardware ? 'Insert du perçage' : 'Perçage simple') : 'Inserts et taraudages'}</h3>
        <button type="button" className={styles.close} onClick={onClose} title="Fermer" aria-label="Fermer">
          <Icon name="close" size={16} />
        </button>
      </header>
      <p className={styles.help}>
        {selected
          ? <>Sur {FACE_LABEL[selected.face ?? 'base'].toLowerCase()}, Ø{fr(selected.diameter)} mm. Choisissez ce qui s’y pose.</>
          : <>Touchez un perçage pour y poser un insert, ou la pièce pour créer un perçage équipé.</>}
      </p>

      <div className={styles.presets}>
        {KINDS.map((k) => (
          <button key={k} type="button" className={value.kind === k && (!selected || selected.hardware) ? styles.presetOn : ''} onClick={() => onChoice({ ...value, kind: k })}>
            {SHORT[k]}
          </button>
        ))}
      </div>
      <div className={styles.presets}>
        {THREADS.map((t) => (
          <button key={t} type="button" className={value.thread === t && (!selected || selected.hardware) ? styles.presetOn : ''} onClick={() => onChoice({ ...value, thread: t })}>{t}</button>
        ))}
      </div>
      <p className={styles.help}>
        Trou de préparation <b>Ø{fr(spec.hole)} mm</b> · tôle de {fr(spec.minThickness)} mm minimum.
      </p>
      {thin && <p className={styles.help} style={{ color: 'var(--warn)' }}><Icon name="warn" size={13} /> Tôle de {fr(thickness)} mm trop fine : choisissez un filetage plus petit ou une tôle plus épaisse.</p>}

      {/* Le perçage lui-même se supprime avec l'outil perçage : ici on ne retire que ce qui s'y pose. */}
      {selected?.hardware && (
        <button type="button" className={styles.deleteLink} onClick={() => onRemove(selected.id)}>
          <Icon name="close" size={14} /> {REMOVE[selected.hardware.kind]}
        </button>
      )}
      {!selected && count > 0 && <p className={styles.help}>{count} perçage{count > 1 ? 's' : ''} équipé{count > 1 ? 's' : ''} sur la pièce.</p>}
    </section>
  );
}
