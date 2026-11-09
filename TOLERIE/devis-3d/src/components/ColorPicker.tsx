import { RAL } from '../lib/partGeometry';
import { Icon } from './Icons';
import styles from './ColorPicker.module.css';

/** Teintes RAL courantes en thermolaquage. */
const SWATCHES: [string, string][] = [
  ['9016', 'Blanc'], ['9010', 'Blanc cassé'], ['7035', 'Gris clair'], ['9006', 'Alu'], ['7016', 'Anthracite'], ['9005', 'Noir'],
  ['3020', 'Rouge'], ['3004', 'Bordeaux'], ['2004', 'Orange'], ['1023', 'Jaune'], ['1015', 'Ivoire'], ['8017', 'Marron'],
  ['6029', 'Vert'], ['6005', 'Vert sapin'], ['5015', 'Bleu ciel'], ['5010', 'Bleu marine'], ['5002', 'Bleu outremer'], ['4005', 'Violet'],
];
const hex = (ral: string) => `#${(RAL[ral] ?? 0x8c96a0).toString(16).padStart(6, '0')}`;

interface Props {
  /** RAL actuel (toute la pièce) et, si un panneau est choisi, le sien. */
  current?: string;
  /** Panneau visé (produit assemblé) : sa couleur seulement ; sinon toute la pièce. */
  panelLabel?: string;
  panelRal?: string;
  onPick: (ral: string | null, target: 'all' | 'panel') => void;
  onClose: () => void;
  /** Ouvrir vers le haut (barre de vues en bas de l'écran). */
  up?: boolean;
}

/** Nuancier : thermolaquage RAL de toute la pièce, ou d'un panneau désigné (porte, rideau, toit…). « Brut » retire la peinture. */
export function ColorPicker({ current, panelLabel, panelRal, onPick, onClose, up }: Props) {
  const target = panelLabel ? 'panel' : 'all';
  const sel = panelLabel ? panelRal : current;
  return (
    <div className={`${styles.pop} ${up ? styles.up : ''}`} role="dialog" aria-label="Couleur">
      <header>
        <b>{panelLabel ? `Couleur : ${panelLabel}` : 'Couleur de la pièce'}</b>
        <button type="button" onClick={onClose} aria-label="Fermer"><Icon name="close" size={14} /></button>
      </header>
      <div className={styles.grid}>
        {SWATCHES.map(([ral, name]) => (
          <button key={ral} type="button" className={sel === ral ? styles.on : ''} onClick={() => onPick(ral, target)} title={`RAL ${ral} · ${name}`} aria-label={`RAL ${ral} ${name}`}>
            <i style={{ background: hex(ral) }} />
            <small>{name}</small>
          </button>
        ))}
      </div>
      <footer>
        {panelLabel ? (
          <button type="button" onClick={() => onPick(null, 'panel')}>Même couleur que la pièce</button>
        ) : (
          <button type="button" onClick={() => onPick(null, 'all')}>Métal brut (sans peinture)</button>
        )}
        <small>Thermolaquage époxy-polyester ; toute teinte RAL possible sur demande.</small>
      </footer>
    </div>
  );
}
