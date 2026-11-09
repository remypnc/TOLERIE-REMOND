import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { adminApi, type Account, type AdminClient, type AdminOrder, type AdminOrderDetail, type StatusUpdate } from '../lib/api';
import { CLIENT_STEPS, INTERNAL_LABEL, INTERNAL_TO_CLIENT, STATUS_LABEL, type ClientContact, type ClientStatus } from '../lib/orders';
import { specRecap } from '../lib/recap';
import { MATERIALS } from '../lib/catalog';
import { Icon } from './Icons';
import { DownloadMenu } from './DownloadMenu';
import { StatusPill, Timeline } from './AccountPage';
import acc from './AccountPage.module.css';
import styles from './AdminPage.module.css';

interface Props {
  me: Account;
  /** Ouvre la pièce dans l'éditeur (outils complets) ; un renvoi crée une nouvelle version au nom du client. */
  onOpenInEditor: (o: AdminOrder, contact: ClientContact) => void;
}

const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const dayTime = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const who = (c: ClientContact) => c.company || c.name || c.email;

/** Statuts internes regroupés par étape client, pour la liste déroulante. */
const GROUPS = [...CLIENT_STEPS.map((s) => s.id), 'annulee' as const].map((step) => ({
  step,
  items: Object.keys(INTERNAL_TO_CLIENT).filter((k) => INTERNAL_TO_CLIENT[k] === step),
}));

type Filter = 'all' | 'todo' | 'quote' | 'prod' | 'done';
const FILTERS: { id: Filter; label: string; match: (s: ClientStatus) => boolean }[] = [
  { id: 'all', label: 'Toutes', match: () => true },
  { id: 'todo', label: 'À traiter', match: (s) => s === 'recue' || s === 'verification' },
  { id: 'quote', label: 'Devis envoyés', match: (s) => s === 'devis_envoye' },
  { id: 'prod', label: 'En production', match: (s) => s === 'validee' || s === 'fabrication' || s === 'expediee' },
  { id: 'done', label: 'Terminées', match: (s) => s === 'livree' || s === 'annulee' },
];

/** Back-office de l'atelier (test) : toutes les demandes, les clients, le suivi et les fichiers de fabrication. */
export function AdminPage({ me, onOpenInEditor }: Props) {
  const [tab, setTab] = useState<'orders' | 'clients'>('orders');
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const [clients, setClients] = useState<AdminClient[] | null>(null);
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!adminApi) return setError('Le back-office a besoin du serveur de l’atelier (npm run dev).');
    try {
      const [o, c] = await Promise.all([adminApi.adminOrders(), adminApi.adminClients()]);
      setOrders(o);
      setClients(c);
    } catch {
      setError('Accès refusé : ce compte n’est pas un compte atelier (ADMIN_EMAILS dans server/.env).');
    }
  }, []);
  useEffect(() => {
    void reload(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [reload]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const f = FILTERS.find((x) => x.id === filter)!;
    return (orders ?? []).filter((o) => f.match(o.status) && (!q || [o.reference, o.spec.name, o.email, o.contact.company, o.contact.name].some((v) => v?.toLowerCase().includes(q))));
  }, [orders, query, filter]);

  const active = (orders ?? []).filter((o) => o.status !== 'livree' && o.status !== 'annulee');
  const kpis = [
    { label: 'À traiter', value: (orders ?? []).filter((o) => FILTERS[1].match(o.status)).length, tone: styles.kpiWarn },
    { label: 'Devis envoyés', value: (orders ?? []).filter((o) => o.status === 'devis_envoye').length },
    { label: 'En production', value: (orders ?? []).filter((o) => FILTERS[3].match(o.status)).length },
    { label: 'Montant en cours', value: eur(active.reduce((s, o) => s + o.price.subtotal, 0)), small: 'HT, estimations comprises' },
  ];

  return (
    <section className={acc.page} aria-labelledby="admin-title">
      <div className={styles.inner}>
        <header className={acc.head}>
          <div>
            <h1 id="admin-title">Atelier <span className={styles.badge}>Back-office · test</span></h1>
            <p>Connecté en tant que <b>{me.email}</b></p>
          </div>
          <div className={styles.tabs} role="tablist">
            <button role="tab" aria-selected={tab === 'orders'} onClick={() => setTab('orders')}>Demandes{orders ? ` (${orders.length})` : ''}</button>
            <button role="tab" aria-selected={tab === 'clients'} onClick={() => setTab('clients')}>Clients{clients ? ` (${clients.length})` : ''}</button>
          </div>
        </header>

        {error && <p className={acc.notice}><Icon name="warn" size={16} /> {error}</p>}
        {!error && !orders && <p className={acc.empty}>Chargement…</p>}

        {orders && tab === 'orders' && (
          <>
            <div className={styles.kpis}>
              {kpis.map((k) => (
                <div key={k.label} className={k.tone}>
                  <span>{k.label}</span>
                  <b>{k.value}</b>
                  {k.small && <small>{k.small}</small>}
                </div>
              ))}
            </div>
            <div className={styles.filters}>
              <input type="search" placeholder="Rechercher : référence, client, pièce…" value={query} onChange={(e) => setQuery(e.target.value)} />
              {FILTERS.map((f) => (
                <button key={f.id} type="button" className={filter === f.id ? styles.chipOn : ''} onClick={() => setFilter(f.id)}>{f.label}</button>
              ))}
            </div>
            {shown.length === 0 ? (
              <p className={acc.empty}>Aucune demande{query || filter !== 'all' ? ' pour ce filtre' : ''}.</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr><th /><th>Référence</th><th>Client</th><th>Pièce</th><th className={styles.num}>Qté</th><th className={styles.num}>Montant HT</th><th>Statut atelier</th><th>Client voit</th></tr>
                  </thead>
                  <tbody>
                    {shown.map((o) => (
                      <tr key={o.reference} onClick={() => setOpen(o.reference)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(o.reference)}>
                        <td><span className={styles.thumb}>{o.thumbnail ? <img src={o.thumbnail} alt="" /> : <Icon name="cube" size={20} />}</span></td>
                        <td><b>{o.reference}</b><small>{day(o.createdAt)}{o.revision > 1 ? ` · v${o.revision}` : ''}</small></td>
                        <td>{who(o.contact)}{who(o.contact) !== o.email && <small>{o.email}</small>}</td>
                        <td>{o.spec.name}<small>{MATERIALS[o.spec.material]?.label.split(' (')[0] ?? o.spec.material} · {o.spec.thickness} mm</small></td>
                        <td className={styles.num}>{o.price.quantity}</td>
                        <td className={styles.num}>{eur(o.price.subtotal)}<small>{o.price.final ? 'définitif' : 'estimation'}</small></td>
                        <td><span className={styles.internal}>{INTERNAL_LABEL[o.internalStatus] ?? o.internalStatus}</span></td>
                        <td><StatusPill status={o.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {clients && tab === 'clients' && (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Client</th><th>E-mail</th><th>Téléphone</th><th>CP</th><th className={styles.num}>Pièces</th><th>Dernière demande</th></tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.email} onClick={() => { setQuery(c.email); setFilter('all'); setTab('orders'); }} tabIndex={0} title="Voir ses demandes">
                    <td><b>{c.company || c.name || '—'}</b>{c.company && c.name && <small>{c.name}</small>}</td>
                    <td><a href={`mailto:${c.email}`} onClick={(e) => e.stopPropagation()}>{c.email}</a></td>
                    <td>{c.phone ? <a href={`tel:${c.phone.replace(/\s/g, '')}`} onClick={(e) => e.stopPropagation()}>{c.phone}</a> : '—'}</td>
                    <td>{c.zip ?? '—'}</td>
                    <td className={styles.num}>{c.orders}</td>
                    <td>{day(c.lastOrderAt ?? c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {open && <OrderDrawer reference={open} onClose={() => setOpen(null)} onSaved={reload} onOpenInEditor={onOpenInEditor} />}
    </section>
  );
}

function OrderDrawer({ reference, onClose, onSaved, onOpenInEditor }: { reference: string; onClose: () => void; onSaved: () => Promise<void>; onOpenInEditor: Props['onOpenInEditor'] }) {
  const [d, setD] = useState<AdminOrderDetail | null>(null);
  const load = useCallback(() => adminApi?.adminOrder(reference).then(setD), [reference]);
  useEffect(() => {
    void load();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [load, onClose]);

  const o = d?.order;
  const contact = d ? { ...o!.contact, ...(d.client ?? {}) } : null;
  const latest = d?.submissions[0];

  return (
    <div className={acc.drawerBack} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className={`${acc.drawer} ${styles.drawer}`} role="dialog" aria-modal aria-labelledby="admin-order-title">
        <header className={acc.drawerHead}>
          <div>
            <h2 id="admin-order-title">{o?.spec.name ?? reference}</h2>
            <small>{reference}{o && o.revision > 1 ? ` · version ${o.revision}` : ''}{o ? ` · ${day(o.createdAt)}` : ''}</small>
          </div>
          <button type="button" className={acc.close} onClick={onClose} aria-label="Fermer"><Icon name="close" size={18} /></button>
        </header>
        {!o || !contact ? (
          <p className={acc.empty}>Chargement…</p>
        ) : (
          <>
            <div className={styles.top}>
              {o.thumbnail ? <img src={o.thumbnail} alt="" /> : <span className={styles.noThumb}><Icon name="cube" size={36} /></span>}
              <div className={styles.contact}>
                <b>{who(contact)}</b>
                {contact.company && contact.name && <span>{contact.name}</span>}
                <a href={`mailto:${contact.email}?subject=${encodeURIComponent(`Votre demande ${o.reference}`)}`}><Icon name="mail" size={14} /> {contact.email}</a>
                {contact.phone && <a href={`tel:${contact.phone.replace(/\s/g, '')}`}><Icon name="phone" size={14} /> {contact.phone}</a>}
                {contact.zip && <span>Livraison : {contact.zip}</span>}
              </div>
            </div>

            <DownloadMenu inline spec={o.spec} reference={o.reference} revision={o.revision} contact={contact} quote={latest?.quote} order={o} message={latest?.contact.message} data={d} />
            <button type="button" className={styles.editBtn} onClick={() => onOpenInEditor(o, contact)}>
              <Icon name="pencil" size={17} /> Ouvrir dans l’éditeur
            </button>

            {latest?.contact.message && (
              <blockquote className={styles.message}><small>Message du client</small>{latest.contact.message}</blockquote>
            )}
            {o.missing.length > 0 && <p className={acc.missing}>Non confirmé par le client : {o.missing.join(', ')}.</p>}

            <h3>Mise à jour</h3>
            <StatusForm key={o.reference} order={o} onSaved={async () => { await load(); await onSaved(); }} />

            <h3>La pièce</h3>
            <dl className={styles.spec}>
              {specRecap(o.spec).map((l) => <div key={l.label}><dt>{l.label}</dt><dd>{l.value}</dd></div>)}
            </dl>

            {latest && (
              <>
                <h3>Prix estimé en ligne</h3>
                <table className={styles.lines}>
                  <tbody>
                    {latest.quote.lines.map((l) => <tr key={l.id}><td>{l.label}<small>{l.detail}</small></td><td className={styles.num}>{eur(l.amount)}</td></tr>)}
                    <tr className={styles.total}><td>Total HT ({latest.quote.quantity} pc, {eur(latest.quote.unitPrice)} / pc)</td><td className={styles.num}>{eur(latest.quote.subtotal)}</td></tr>
                  </tbody>
                </table>
              </>
            )}

            <h3>Ce que voit le client</h3>
            <Timeline order={o} />

            <h3>Journal interne</h3>
            <ul className={styles.log}>
              {d.log.map((l, i) => (
                <li key={i}>
                  <time>{dayTime(l.at)}</time>
                  <span><b>{l.internalStatus ? INTERNAL_LABEL[l.internalStatus] ?? l.internalStatus : 'Note'}</b>{l.note ? ` — ${l.note}` : ''}<small>{l.source}</small></span>
                </li>
              ))}
              {d.submissions.map((s) => (
                <li key={`s${s.revision}${s.createdAt}`}>
                  <time>{dayTime(s.createdAt)}</time>
                  <span><b>{s.revision > 1 ? `Modification v${s.revision}` : 'Demande envoyée'}</b><small>devis en ligne</small></span>
                </li>
              ))}
            </ul>

            {latest && latest.conversation.length > 0 && (
              <details className={styles.convo}>
                <summary>Conversation avec l’assistant ({latest.conversation.length} messages)</summary>
                {latest.conversation.map((m) => <p key={m.id} className={m.role === 'user' ? styles.fromUser : ''}>{m.text}</p>)}
              </details>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

/** Statut interne, note au client, prix définitif, dates et suivi colis. */
function StatusForm({ order, onSaved }: { order: AdminOrder; onSaved: () => Promise<void> }) {
  const [internal, setInternal] = useState(order.internalStatus);
  const [clientNote, setClientNote] = useState('');
  const [note, setNote] = useState('');
  const [unit, setUnit] = useState(order.price.final ? String(order.price.unitPrice) : '');
  const [ship, setShip] = useState(order.shipDate?.slice(0, 10) ?? '');
  const [deliv, setDeliv] = useState(order.deliveryDate?.slice(0, 10) ?? '');
  const [carrier, setCarrier] = useState(order.tracking?.carrier ?? '');
  const [number, setNumber] = useState(order.tracking?.number ?? '');
  const [url, setUrl] = useState(order.tracking?.url ?? '');
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'err'>('idle');
  const [notifyOverride, setNotify] = useState<boolean | null>(null);
  const [mailInfo, setMailInfo] = useState<string>();

  const next = INTERNAL_TO_CLIENT[internal];
  const backwards = next && next !== 'annulee' && CLIENT_STEPS.findIndex((s) => s.id === next) < CLIENT_STEPS.findIndex((s) => s.id === order.status);
  const willChange = !!next && !backwards && next !== order.status;
  const notify = notifyOverride ?? willChange;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState('busy');
    const price = Number(unit.replace(',', '.'));
    const u: StatusUpdate = {
      internalStatus: internal,
      note: note.trim() || undefined,
      clientNote: clientNote.trim() || undefined,
      shipDate: ship ? new Date(ship).toISOString() : undefined,
      deliveryDate: deliv ? new Date(deliv).toISOString() : undefined,
      tracking: carrier.trim() ? { carrier: carrier.trim(), number: number.trim() || undefined, url: url.trim() || undefined } : undefined,
      finalPrice: unit && price > 0 ? { unitPrice: price, subtotal: Math.round(price * order.price.quantity * 100) / 100 } : undefined,
      notify,
    };
    try {
      const r = await adminApi!.adminStatus(order.reference, u);
      setMailInfo(!r.notified ? undefined : r.emailSent ? `E-mail envoyé à ${order.contact.email}` : 'E-mail préparé (mode test, pas de SMTP) : voir la boîte d’envoi');
      setState('ok');
      setClientNote('');
      setNote('');
      setNotify(null);
      await onSaved();
    } catch {
      setState('err');
    }
  };

  return (
    <form className={styles.form} onSubmit={submit}>
      <label className={styles.wide}>
        <span>Statut atelier</span>
        <select value={internal} onChange={(e) => setInternal(e.target.value)}>
          {GROUPS.map((g) => (
            <optgroup key={g.step} label={`Client : ${STATUS_LABEL[g.step]}`}>
              {g.items.map((k) => <option key={k} value={k}>{INTERNAL_LABEL[k] ?? k}</option>)}
            </optgroup>
          ))}
        </select>
        <small>
          Le client verra : <b>{STATUS_LABEL[backwards ? order.status : next]}</b>
          {backwards ? ' (son étape ne recule jamais)' : ''}
        </small>
      </label>
      <label className={styles.wide}>
        <span>Note visible par le client</span>
        <input value={clientNote} onChange={(e) => setClientNote(e.target.value)} maxLength={200} placeholder="ex. Devis définitif envoyé par e-mail" />
      </label>
      <label className={styles.wide}>
        <span>Note interne</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Jamais montrée au client" />
      </label>
      <label>
        <span>Prix unitaire définitif HT</span>
        <input inputMode="decimal" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder={`estimé ${order.price.unitPrice.toLocaleString('fr-FR')} €`} />
      </label>
      <label>
        <span>Quantité</span>
        <input value={`${order.price.quantity} pc`} disabled />
      </label>
      <label>
        <span>Expédition prévue</span>
        <input type="date" value={ship} onChange={(e) => setShip(e.target.value)} />
      </label>
      <label>
        <span>Livraison prévue</span>
        <input type="date" value={deliv} onChange={(e) => setDeliv(e.target.value)} />
      </label>
      <label>
        <span>Transporteur</span>
        <input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="ex. DB Schenker" />
      </label>
      <label>
        <span>N° de suivi</span>
        <input value={number} onChange={(e) => setNumber(e.target.value)} />
      </label>
      <label className={styles.wide}>
        <span>Lien de suivi colis</span>
        <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
      </label>
      <label className={`${styles.wide} ${styles.notify}`}>
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
        <span>Prévenir le client par e-mail{notify ? ` (${STATUS_LABEL[willChange ? next : order.status].toLowerCase()}${clientNote.trim() ? ', avec la note' : ''})` : ''}</span>
      </label>
      {mailInfo && <p className={`${styles.wide} ${styles.mailInfo}`}>{mailInfo}{mailInfo.includes('mode test') && <> · <a href="/api/dev/outbox" target="_blank" rel="noreferrer">ouvrir</a></>}</p>}
      <footer className={styles.wide}>
        {state === 'ok' && <span className={styles.ok}><Icon name="check" size={14} /> Enregistré</span>}
        {state === 'err' && <span className={styles.err}>Échec de l’enregistrement</span>}
        <button type="submit" className={acc.newBtn} disabled={state === 'busy'}>{state === 'busy' ? 'Enregistrement…' : 'Enregistrer'}</button>
      </footer>
    </form>
  );
}
