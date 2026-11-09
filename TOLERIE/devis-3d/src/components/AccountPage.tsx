import { useEffect, useState } from 'react';
import { MATERIALS, FINISHES } from '../lib/catalog';
import { CLIENT_STEPS, STATUS_LABEL, canEdit, stepIndex, type ClientContact, type ClientOrder } from '../lib/orders';
import { Icon } from './Icons';
import styles from './AccountPage.module.css';

interface Props {
  client: ClientContact;
  orders: ClientOrder[] | null;
  onNew: () => void;
  onEdit: (o: ClientOrder) => void;
  onReorder: (o: ClientOrder) => void;
  onProfile: () => void;
  onLogout: () => void;
  /** Développement uniquement : remplit l'espace avec des pièces d'exemple. */
  onDemo?: () => void;
}

const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : '—');
const dayTime = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const mm = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });

/** Espace client : toutes les pièces demandées ou commandées, leur avancement et leurs dates. */
export function AccountPage({ client, orders, onNew, onEdit, onReorder, onProfile, onLogout, onDemo }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const current = orders?.find((o) => o.reference === open) ?? null;
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current]);

  const active = orders?.filter((o) => o.status !== 'livree' && o.status !== 'annulee') ?? [];
  const toValidate = orders?.filter((o) => o.status === 'devis_envoye').length ?? 0;
  const done = (orders?.length ?? 0) - active.length;

  return (
    <section className={styles.page} aria-labelledby="account-title">
      <div className={styles.inner}>
        <header className={styles.head}>
          <div>
            <h1 id="account-title">Mes pièces</h1>
            <p>
              {client.company ? <b>{client.company} · </b> : null}{client.email}
              <button type="button" onClick={onProfile}>Mes coordonnées</button>
              <button type="button" onClick={onLogout}>Se déconnecter</button>
            </p>
          </div>
        </header>

        {orders && orders.length > 0 && (
          <div className={styles.summary}>
            <span><b>{active.length}</b> en cours</span>
            {toValidate > 0 && <span className={styles.attention}><b>{toValidate}</b> devis à valider</span>}
            <span><b>{done}</b> terminée{done > 1 ? 's' : ''}</span>
            <button type="button" className={styles.newBtn} onClick={onNew}>
              <Icon name="plus" size={18} /> Nouvelle pièce
            </button>
          </div>
        )}

        {orders === null && <p className={styles.empty}>Chargement…</p>}
        {orders?.length === 0 && (
          <div className={styles.empty}>
            <p>Aucune pièce pour l’instant.</p>
            <button type="button" className={styles.newBtn} onClick={onNew}><Icon name="sparkle" size={18} /> Décrire ma première pièce</button>
          </div>
        )}

        <ul className={styles.list}>
          {orders?.map((o) => (
            <li key={o.reference}>
              <button type="button" className={styles.card} onClick={() => setOpen(o.reference)}>
                <span className={styles.thumb}>{o.thumbnail ? <img src={o.thumbnail} alt="" /> : <Icon name="cube" size={28} />}</span>
                <span className={styles.main}>
                  <span className={styles.titleRow}>
                    <b>{o.spec.name}</b>
                    <StatusPill status={o.status} />
                  </span>
                  <small>{o.reference}{o.revision > 1 ? ` · version ${o.revision}` : ''} · {dayTime(o.createdAt)}</small>
                  <Progress status={o.status} />
                  <span className={styles.meta}>
                    <span>{o.price.quantity} pc · {eur(o.price.subtotal)} HT{o.price.final ? '' : ' (estimation)'}</span>
                    <span>{nextDate(o)}</span>
                  </span>
                </span>
                <Icon name="back" size={18} className={styles.chev} />
              </button>
            </li>
          ))}
        </ul>
        {onDemo && orders && !orders.some((o) => o.reference.startsWith('DEV-DEMO')) && (
          <button type="button" className={styles.link} onClick={onDemo}>Ajouter des pièces d’exemple (développement uniquement)</button>
        )}
      </div>

      {current && (
        <div className={styles.drawerBack} onMouseDown={(e) => e.target === e.currentTarget && setOpen(null)}>
          <aside className={styles.drawer} role="dialog" aria-modal aria-labelledby="order-title">
            <header className={styles.drawerHead}>
              <div>
                <h2 id="order-title">{current.spec.name}</h2>
                <small>{current.reference}{current.revision > 1 ? ` · version ${current.revision}` : ''}</small>
              </div>
              <button type="button" className={styles.close} onClick={() => setOpen(null)} aria-label="Fermer"><Icon name="close" size={18} /></button>
            </header>

            {current.thumbnail && <img className={styles.bigThumb} src={current.thumbnail} alt={`Aperçu de ${current.spec.name}`} />}

            <dl className={styles.keys}>
              <div><dt>Quantité</dt><dd>{current.price.quantity} pc</dd></div>
              <div><dt>{current.price.final ? 'Prix' : 'Estimation'}</dt><dd>{eur(current.price.subtotal)} HT</dd></div>
              <div><dt>Fabrication</dt><dd>{current.leadTimeDays} j ouvrés</dd></div>
              <div><dt>Livraison</dt><dd>{current.deliveryDays} j ouvrés</dd></div>
              <div><dt>Expédition prévue</dt><dd>{day(current.shipDate)}</dd></div>
              <div><dt>Livraison estimée</dt><dd>{day(current.deliveryDate)}</dd></div>
            </dl>
            {current.tracking && (
              <p className={styles.track}>
                Transporteur : {current.tracking.carrier}{current.tracking.number ? ` · n° ${current.tracking.number}` : ''}
                {current.tracking.url && <> · <a href={current.tracking.url} target="_blank" rel="noreferrer">Suivre le colis</a></>}
              </p>
            )}

            <h3>Suivi</h3>
            <Timeline order={current} />

            <h3>La pièce</h3>
            <ul className={styles.spec}>
              <li>{mm(current.spec.width)} × {mm(current.spec.depth)} mm{current.spec.flanges.length ? `, ${current.spec.flanges.length} pli${current.spec.flanges.length > 1 ? 's' : ''}` : ''}</li>
              <li>{MATERIALS[current.spec.material]?.label ?? current.spec.material}, ép. {mm(current.spec.thickness)} mm</li>
              <li>Finition : {FINISHES[current.spec.finish]?.label ?? current.spec.finish}{current.spec.ral ? ` RAL ${current.spec.ral}` : ''}</li>
              {current.spec.holes.length > 0 && <li>{current.spec.holes.length} perçage{current.spec.holes.length > 1 ? 's' : ''}</li>}
            </ul>
            {current.missing.length > 0 && canEdit(current.status) && (
              <p className={styles.missing}>À confirmer avec le technicien : {current.missing.join(', ')}.</p>
            )}

            <footer className={styles.drawerFoot}>
              {canEdit(current.status) ? (
                <button type="button" className={styles.newBtn} onClick={() => onEdit(current)}>
                  <Icon name="pencil" size={17} /> Modifier cette pièce
                </button>
              ) : (
                <button type="button" className={styles.newBtn} onClick={() => onReorder(current)}>
                  <Icon name="undo" size={17} /> Commander à nouveau
                </button>
              )}
              {canEdit(current.status) && <small>Une modification renvoie la demande en vérification.</small>}
            </footer>
          </aside>
        </div>
      )}
    </section>
  );
}

/** Prochaine date utile, en une ligne. */
function nextDate(o: ClientOrder) {
  if (o.status === 'livree') return `Livrée le ${day(o.history[o.history.length - 1]?.at)}`;
  if (o.status === 'annulee') return 'Annulée';
  if (o.status === 'expediee') return `Livraison estimée le ${day(o.deliveryDate)}`;
  if (o.status === 'devis_envoye') return 'Devis à valider';
  return `Livraison estimée le ${day(o.deliveryDate)}`;
}

export function StatusPill({ status }: { status: ClientOrder['status'] }) {
  const tone = status === 'livree' ? styles.pillDone : status === 'devis_envoye' ? styles.pillAction : status === 'annulee' ? styles.pillOff : '';
  return <span className={`${styles.pill} ${tone}`}>{STATUS_LABEL[status]}</span>;
}

export function Progress({ status }: { status: ClientOrder['status'] }) {
  const i = stepIndex(status);
  return (
    <span className={styles.progress} aria-label={`Étape ${i + 1} sur ${CLIENT_STEPS.length} : ${STATUS_LABEL[status]}`}>
      {CLIENT_STEPS.map((s, k) => <i key={s.id} className={k <= i ? styles.stepOn : ''} />)}
    </span>
  );
}

export function Timeline({ order }: { order: ClientOrder }) {
  const cur = stepIndex(order.status);
  // Date de la DERNIÈRE fois où chaque étape a été atteinte (une modification renvoie en vérification).
  const reached = new Map<string, string>();
  for (const e of order.history) reached.set(e.status, e.at);
  return (
    <ol className={styles.timeline}>
      {CLIENT_STEPS.map((s, k) => {
        const at = k <= cur ? reached.get(s.id) : undefined;
        const notes = order.history.filter((e) => e.status === s.id && e.note);
        return (
          <li key={s.id} className={k < cur ? styles.tlDone : k === cur ? styles.tlNow : ''}>
            <span className={styles.dot}>{k < cur ? <Icon name="check" size={12} /> : null}</span>
            <div>
              <b>{s.label}</b>
              {at && <time>{dayTime(at)}</time>}
              {k === cur && <p>{s.help}</p>}
              {k === cur && s.id === 'fabrication' && <p>Expédition prévue le {day(order.shipDate)}.</p>}
              {notes.map((n, j) => <p key={j} className={styles.tlNote}>{n.note}</p>)}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
