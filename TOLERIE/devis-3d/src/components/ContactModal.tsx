import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ClientContact } from '../lib/api';
import { deliveryZoneFor } from '../lib/catalog';
import { Icon } from './Icons';
import styles from './ContactModal.module.css';

interface Props {
  /** « send » : avant l'envoi d'une demande ; « profile » : modifier ses coordonnées ; « login » : retrouver ses pièces (e-mail seul). */
  mode: 'send' | 'profile' | 'login';
  initial: ClientContact | null;
  /** Texte du bouton principal : « Envoyer ma demande » avant l'envoi, « Enregistrer » depuis l'espace client. */
  submitLabel: string;
  reference?: string;
  busy?: boolean;
  onSubmit: (c: ClientContact, remember: boolean) => void;
  onClose: () => void;
  /** Oublier les coordonnées mémorisées sur cet appareil. */
  onForget?: () => void;
  /** Message affiché sous le formulaire (ex. « Lien envoyé »). */
  info?: string;
  /** Test sans SMTP : le lien de connexion, à ouvrir directement (aucun e-mail réel n'est parti). */
  devLink?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^[+\d][\d\s.()-]{7,}$/;

const ZIP = /^\d{5}$/;

/**
 * Coordonnées du client : e-mail, nom (société ou particulier), téléphone et adresse de livraison obligatoires
 * (l'adresse fixe le prix du transport), sauf retrait à l'atelier.
 */
export function ContactModal({ mode, initial, submitLabel, reference, busy, onSubmit, onClose, onForget, info, devLink }: Props) {
  const login = mode === 'login';
  const [c, setC] = useState<ClientContact>(() => initial ?? { email: '' });
  const [remember, setRemember] = useState(true);
  const [touched, setTouched] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const emailBad = !EMAIL.test(c.email.trim());
  const nameBad = !c.company?.trim() && !c.name?.trim();
  const phoneBad = !PHONE.test(c.phone?.trim() ?? '');
  const ship = !c.pickup;
  const addressBad = ship && !c.address?.trim();
  const zipBad = ship && !ZIP.test(c.zip?.trim() ?? '');
  const zone = deliveryZoneFor(c.zip);
  const cityBad = ship && !c.city?.trim();
  const set = (k: keyof ClientContact) => (e: { target: { value: string } }) => setC((x) => ({ ...x, [k]: e.target.value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (emailBad || nameBad || phoneBad || addressBad || zipBad || cityBad) return;
    const clean = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]).filter(([, v]) => v)) as unknown as ClientContact;
    onSubmit(clean, remember);
  };

  return (
    <div className={styles.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className={styles.card} role="dialog" aria-modal aria-labelledby="contact-title" onSubmit={submit} noValidate>
        <header className={styles.head}>
          <span className={styles.badge}><Icon name="mail" size={20} /></span>
          <div>
            <h2 id="contact-title">{login ? 'Retrouver mes pièces' : mode === 'profile' ? 'Mes coordonnées' : 'Où vous envoyer le devis ?'}</h2>
            <p>
              {login
                ? 'Vos coordonnées et votre adresse de livraison (elle fixe le prix du transport) : vous recevez ensuite un lien de connexion, sans mot de passe.'
                : mode === 'profile'
                  ? 'Elles servent à vous envoyer vos devis et le suivi de vos pièces.'
                  : <>{reference ? <>Demande <b>{reference}</b> · </> : null}un technicien vous répond sous 48 h ouvrées.</>}
            </p>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Fermer"><Icon name="close" size={18} /></button>
        </header>

        <label className={`${styles.field} ${styles.wide} ${touched && emailBad ? styles.bad : ''}`}>
          <span>E-mail <i aria-hidden>*</i></span>
          <input ref={first} type="email" inputMode="email" autoComplete="email" placeholder="vous@entreprise.fr" value={c.email} onChange={set('email')} required aria-invalid={touched && emailBad} />
          {touched && emailBad && <small>Indiquez une adresse e-mail valide : c’est là que nous envoyons le devis.</small>}
        </label>
        <label className={`${styles.field} ${touched && nameBad ? styles.bad : ''}`}>
          <span>Société</span>
          <input autoComplete="organization" placeholder="Raison sociale" value={c.company ?? ''} onChange={set('company')} aria-invalid={touched && nameBad} />
        </label>
        <label className={`${styles.field} ${touched && nameBad ? styles.bad : ''}`}>
          <span>Nom <i aria-hidden>*</i></span>
          <input autoComplete="name" placeholder="Prénom Nom" value={c.name ?? ''} onChange={set('name')} aria-invalid={touched && nameBad} />
        </label>
        {touched && nameBad && <small className={`${styles.wide} ${styles.err}`}>Indiquez une société ou votre nom (particulier).</small>}
        <label className={`${styles.field} ${styles.wide} ${touched && phoneBad ? styles.bad : ''}`}>
          <span>Téléphone <i aria-hidden>*</i></span>
          <input type="tel" inputMode="tel" autoComplete="tel" placeholder="06 12 34 56 78" value={c.phone ?? ''} onChange={set('phone')} aria-invalid={touched && phoneBad} />
          {touched && phoneBad && <small>Indiquez un numéro joignable : le transporteur et l’atelier en ont besoin.</small>}
        </label>
        <label className={`${styles.check} ${styles.wide}`}>
          <input type="checkbox" checked={!!c.pickup} onChange={(e) => setC((x) => ({ ...x, pickup: e.target.checked }))} />
          <span>Je retire mes pièces à l’atelier (Crépand, 21) : pas de frais de transport</span>
        </label>
        {ship && <>
        <label className={`${styles.field} ${styles.wide} ${touched && addressBad ? styles.bad : ''}`}>
          <span>Adresse de livraison <i aria-hidden>*</i></span>
          <input autoComplete="street-address" placeholder="N° et rue, bâtiment, quai…" value={c.address ?? ''} onChange={set('address')} aria-invalid={touched && addressBad} />
        </label>
        <label className={`${styles.field} ${touched && zipBad ? styles.bad : ''}`}>
          <span>Code postal <i aria-hidden>*</i></span>
          <input inputMode="numeric" autoComplete="postal-code" placeholder="21000" maxLength={5} value={c.zip ?? ''} onChange={set('zip')} aria-invalid={touched && zipBad} />
          {touched && zipBad ? <small>5 chiffres (France).</small> : zone && <small className={styles.zone}>Transport : {zone.label}</small>}
        </label>
        <label className={`${styles.field} ${touched && cityBad ? styles.bad : ''}`}>
          <span>Ville <i aria-hidden>*</i></span>
          <input autoComplete="address-level2" placeholder="Dijon" value={c.city ?? ''} onChange={set('city')} aria-invalid={touched && cityBad} />
        </label>
        </>}
        {mode === 'send' && <label className={`${styles.field} ${styles.wide}`}>
          <span>Un mot pour l’atelier</span>
          <textarea rows={2} placeholder="Délai souhaité, usage de la pièce, plan à suivre…" value={c.message ?? ''} onChange={set('message')} />
        </label>}

        <label className={styles.check}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>Se souvenir de moi sur cet appareil</span>
        </label>
        <p className={styles.legal}><i aria-hidden>*</i> obligatoire. Vos coordonnées servent uniquement à vous envoyer vos devis et à suivre vos pièces. Elles ne sont jamais revendues.</p>
        {info && <p className={styles.info}>{info}</p>}
        {devLink && (
          <p className={styles.dev}>
            <span>Mode test : aucun SMTP n’est configuré, l’e-mail n’est pas réellement envoyé.</span>
            <a href={devLink}>Ouvrir le lien de connexion</a>
          </p>
        )}

        <footer className={styles.foot}>
          {onForget && initial && !login && (
            <button type="button" className={styles.forget} onClick={onForget}>Ce n’est pas moi</button>
          )}
          <button type="submit" className={styles.submit} disabled={busy}>
            <span>{busy ? 'Envoi…' : submitLabel}</span> <Icon name="send" size={18} />
          </button>
        </footer>
      </form>
    </div>
  );
}
