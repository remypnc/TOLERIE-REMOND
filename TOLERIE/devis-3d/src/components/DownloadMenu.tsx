import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { PartSpec, Quote } from '../lib/types';
import type { ClientContact, ClientOrder } from '../lib/orders';
import { download, flatDxf, flatSvg, holesCsv, openFabricationSheet, openQuoteSheet, partStep, partStl, type SheetInput } from '../lib/exports';
import { renderSnapshot } from '../lib/snapshot';
import { nomenclatureCsv } from '../lib/products';
import { Icon, LOGO_URL } from './Icons';
import { createPortal } from 'react-dom';
import styles from './DownloadMenu.module.css';

interface Props {
  spec: PartSpec;
  reference: string;
  revision?: number;
  contact?: ClientContact;
  quote?: Quote;
  order?: ClientOrder;
  message?: string;
  /** Données brutes (export JSON). */
  data?: unknown;
  /** true : liste affichée directement (fiche du back-office) ; sinon un bouton qui ouvre la liste. */
  inline?: boolean;
}

/** Tous les fichiers d'une pièce : fiches PDF, plans et modèles pour les machines de l'atelier. */
export function DownloadMenu({ spec, reference, revision, contact, quote, order, message, data, inline }: Props) {
  const [open, setOpen] = useState(false);
  // Menu posé en fixe à gauche du bouton, recalé pour tenir entièrement dans l'écran, au-dessus du chat.
  const pop = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<CSSProperties>({ visibility: 'hidden' });
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open || inline) return;
    const fit = () => {
      const r = root.current!.getBoundingClientRect();
      const maxHeight = Math.min(560, window.innerHeight - 32);
      const h = Math.min(pop.current!.scrollHeight, maxHeight);
      const top = Math.max(16, Math.min(r.top, window.innerHeight - h - 16));
      setPlace({ top, right: window.innerWidth - r.left + 12, maxHeight });
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [open, inline]);
  const toggle = () => {
    if (open) setPlace({ visibility: 'hidden' });
    setOpen((o) => !o);
  };
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!root.current?.contains(t) && !pop.current?.contains(t)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  const sheet = (): SheetInput => ({
    reference, revision, spec, quote, order, message,
    date: order?.updatedAt ?? new Date().toISOString(),
    contact: contact ?? { email: '—' },
    image: renderSnapshot(spec, 'day', 640, 480, 1),
    logoUrl: LOGO_URL,
  });
  const groups: { title: string; items: { label: string; sub: string; ext: string; run: () => void }[] }[] = [
    {
      title: 'Documents',
      items: [
        { label: 'Fiche devis', sub: 'pour le client', ext: 'PDF', run: () => openQuoteSheet(sheet()) },
        { label: 'Fiche de fabrication', sub: 'gamme, pliage, inserts', ext: 'PDF', run: () => openFabricationSheet(sheet()) },
      ],
    },
    {
      title: 'Machines',
      // Produit assemblé : la nomenclature des tôles ; les plans pièce par pièce viennent du bureau d'études.
      // Fichier importé : c'est le fichier du client qui part en fabrication, rien à régénérer ici.
      items: spec.imported ? [] : spec.product ? [
        { label: 'Nomenclature des tôles', sub: 'développés, plis, matière', ext: 'CSV', run: () => download(`${reference}-nomenclature.csv`, nomenclatureCsv(spec), 'text/csv') },
      ] : [
        { label: 'Patron déplié', sub: 'laser, poinçonnage, combiné', ext: 'DXF', run: () => download(`${reference}-patron.dxf`, flatDxf(spec, reference), 'application/dxf') },
        { label: 'Modèle 3D plié', sub: 'CAO, programmation pliage', ext: 'STEP', run: () => download(`${reference}.step`, partStep(spec, reference), 'application/step') },
        { label: 'Perçages et inserts', sub: 'poinçonnage, sertissage', ext: 'CSV', run: () => download(`${reference}-percages.csv`, holesCsv(spec), 'text/csv') },
        { label: 'Maillage 3D', sub: 'visualisation, impression 3D', ext: 'STL', run: () => download(`${reference}.stl`, partStl(spec, reference), 'model/stl') },
        { label: 'Patron vectoriel', sub: 'à l’échelle, en mm', ext: 'SVG', run: () => download(`${reference}-patron.svg`, flatSvg(spec, true), 'image/svg+xml') },
      ],
    },
    ...(data ? [{ title: 'Données', items: [{ label: 'Demande complète', sub: 'pièce, client, conversation', ext: 'JSON', run: () => download(`${reference}.json`, JSON.stringify(data, null, 2), 'application/json') }] }] : []),
  ];

  const list = (
    <div
      ref={pop}
      className={inline ? styles.inline : styles.pop}
      style={inline ? undefined : place}
      role={inline ? undefined : 'menu'}
    >
      {groups.filter((g) => g.items.length).map((g) => (
        <div key={g.title} className={styles.group}>
          <h4>{g.title}</h4>
          {g.items.map((it) => (
            <button key={it.label} type="button" role={inline ? undefined : 'menuitem'} onClick={() => { it.run(); setOpen(false); }}>
              <em>{it.ext}</em>
              <span><b>{it.label}</b><small>{it.sub}</small></span>
              <Icon name="download" size={16} />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
  if (inline) return list;
  return (
    <div ref={root} className={styles.root}>
      <button type="button" className={`${styles.trigger} ${open ? styles.triggerOn : ''}`} onClick={toggle} aria-expanded={open} title="Télécharger : fiches, DXF, STEP…" aria-label="Télécharger les fichiers de la pièce">
        <Icon name="download" />
      </button>
      {/* Portail : un parent avec flou d'arrière-plan fausserait la position fixe. */}
      {open && createPortal(list, document.body)}
    </div>
  );
}
