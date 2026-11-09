import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode, type Ref } from 'react';
import gsap from 'gsap';
import type { FlatPattern, PartSpec, PriceLine, PriceTier, Quote } from '../lib/types';
import { MATERIALS, FINISHES } from '../lib/catalog';
import { LOGO_URL, LOGO_WHITE_URL, Icon } from './Icons';
import { Viewer3D } from './Viewer3D';
import { View3DModal } from './View3DModal';
import styles from './QuoteCard.module.css';

// ---- Réglages du mouvement : un téléphone pliant qui s'ouvre vers la droite ----
const OPEN_DURATION = 1.5;
const OPEN_EASE = 'sine.inOut';
const STATS_AT = 1.08;
const STATS_STAGGER = 0.09;
const ROWS_AT = 0.95;
const ROWS_STAGGER = 0.04;
const CLOSE_SPEED = 1.35;
const LOAD_FADE = 0.5;
const AUTO_OPEN_DELAY = 0.45;
const REDUCED_FADE = 0.15;

const round = (n: number) => Math.round(n * 10000) / 10000;
const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const num = (n: number, d = 1) => n.toLocaleString('fr-FR', { maximumFractionDigits: d });
const phoneQuery = '(width < 760px)';
const instant = () => matchMedia(phoneQuery).matches || matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface QuoteCardHandle {
  /** Replie le devis (animation complète), puis résout. */
  close: () => Promise<void>;
}

interface Props {
  spec: PartSpec;
  flat: FlatPattern;
  quote: Quote;
  reference: string;
  missing: string[];
  images: { day: string; night: string } | null;
  onQuantity: (q: number) => void;
  ref?: Ref<QuoteCardHandle>;
}

/**
 * Lignes telles que le client les voit : ce qui est inclus, sans temps machine, taux horaires,
 * kilos ni taux de chute (le détail complet part dans la BDD pour l'atelier).
 */
function clientLines(lines: PriceLine[], spec: PartSpec, flat: FlatPattern): { id: string; label: string; detail: string; amount: number }[] {
  const mat = MATERIALS[spec.material];
  const fin = FINISHES[spec.finish];
  const bends = flat.bendLines.length;
  const holes = spec.holes.length;
  const cuts = spec.cuts?.length ?? 0;
  const text: Record<string, [string, string]> = {
    matiere: ['Matière', `${mat.label}, ép. ${num(spec.thickness)} mm`],
    cao: ['Programmation FAO', 'Programmes laser et plieuse'],
    laser: ['Découpe laser', [
      'Contour',
      holes ? `${holes} perçage${holes > 1 ? 's' : ''}` : '',
      cuts ? `${cuts} découpe${cuts > 1 ? 's' : ''} d'angle` : '',
    ].filter(Boolean).join(', ')],
    pliage: ['Pliage', `${bends} pli${bends > 1 ? 's' : ''} par pièce`],
    finition: ['Finition', `${fin.label}${spec.ral ? ` RAL ${spec.ral}` : ''}`],
    prototype: ['Mise en route', 'Pièce unitaire'],
    controle: ['Contrôle qualité', 'Contrôle dimensionnel'],
  };
  return lines.map((l) => {
    const [label, detail] = text[l.id] ?? [l.label, l.detail];
    return { id: l.id, label, detail, amount: l.amount };
  });
}

export function QuoteCard({ spec, flat, quote, reference, missing, images, onQuantity, ref }: Props) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const tlRef = useRef<gsap.core.Timeline | null>(null);
  const ctxRef = useRef<gsap.Context | null>(null);
  const [open, setOpen] = useState(false);
  /** Ouvert et immobile : le blueprint devient une vraie 3D manipulable. */
  const [settled, setSettled] = useState(false);
  const [big3d, setBig3d] = useState(false);
  const ready = images !== null;

  // Timeline : tout dérive de l'angle du feuillet droit (−180° replié sur la gauche → 0° ouvert).
  useLayoutEffect(() => {
    const el = cardRef.current!;
    const state = { p: 0 };
    const apply = () => {
      const angle = state.p * Math.PI;
      const cos = Math.cos(angle);
      el.style.setProperty('--turn', `${round(-180 + state.p * 180)}deg`);
      el.style.setProperty('--spread', String(round(Math.max(0, -cos))));
      el.style.setProperty('--blur-cover', String(round(Math.sin(angle))));
      el.style.setProperty('--shade', String(round(Math.sin(angle))));
      el.style.setProperty('--hinge-k', String(round(Math.max(0, cos))));
      el.dataset.state = state.p === 0 ? 'folded' : state.p === 1 ? 'open' : 'moving';
    };
    apply();
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ paused: true, onComplete: () => setSettled(true) });
      tl.to(state, { p: 1, duration: OPEN_DURATION, ease: OPEN_EASE, onUpdate: apply }, 0);
      tl.fromTo('[data-stat]', { '--reveal': 0 }, { '--reveal': 1, duration: 0.2, ease: 'power2.out', stagger: STATS_STAGGER }, STATS_AT);
      tl.fromTo('[data-row]', { '--reveal': 0 }, { '--reveal': 1, duration: 0.3, ease: 'power2.out', stagger: ROWS_STAGGER }, ROWS_AT);
      tlRef.current = tl;
      if (import.meta.env.DEV) (window as unknown as { __quoteTl?: gsap.core.Timeline }).__quoteTl = tl;
    }, el);
    ctxRef.current = ctx;
    return () => ctx.revert();
  }, []);

  /** Joue l'ouverture ou la fermeture ; renvoie une promesse résolue à la fin du mouvement. */
  const animate = (next: boolean) =>
    new Promise<void>((resolve) => {
      const tl = tlRef.current;
      if (!ready || !tl) return resolve();
      setOpen(next);
      setSettled(false);
      if (instant()) {
        ctxRef.current?.add(() => {
          gsap.timeline({ onComplete: () => resolve() })
            .to(sceneRef.current, { opacity: 0, duration: REDUCED_FADE, ease: 'power1.in' })
            .add(() => { tl.pause().progress(next ? 1 : 0); setSettled(next); })
            .to(sceneRef.current, { opacity: 1, duration: REDUCED_FADE, ease: 'power1.out' });
        });
        return;
      }
      if (next) {
        tl.timeScale(1).eventCallback('onReverseComplete', null).play();
        tl.eventCallback('onComplete', () => { setSettled(true); resolve(); });
      } else {
        tl.timeScale(CLOSE_SPEED).eventCallback('onReverseComplete', () => resolve()).reverse();
      }
    });
  const toggle = (next = !open) => void animate(next);

  useImperativeHandle(ref, () => ({
    close: () => (tlRef.current && tlRef.current.progress() > 0 ? animate(false) : Promise.resolve()),
  }));

  // Glisser le bord libre : vers la droite pour ouvrir (couverture), vers la gauche pour refermer (devis).
  const drag = useRef<{ x: number; p0: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const onDragStart = (e: PointerEvent<HTMLElement>) => {
    const tl = tlRef.current;
    if (!ready || !tl || matchMedia(phoneQuery).matches) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, p0: Math.min(1, tl.time() / OPEN_DURATION), moved: false };
  };
  const onDragMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    const tl = tlRef.current;
    if (!d || !tl) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 6) return;
    if (!d.moved) {
      d.moved = true;
      setSettled(false);
    }
    // Le bord libre parcourt deux largeurs de feuillet entre fermé et ouvert.
    const leaf = (cardRef.current?.parentElement?.offsetWidth ?? 800) / 2;
    const p = Math.min(1, Math.max(0, d.p0 + dx / (leaf * 1.6)));
    tl.pause().time(p * OPEN_DURATION);
  };
  const onDragEnd = () => {
    const d = drag.current;
    const tl = tlRef.current;
    drag.current = null;
    if (!d?.moved || !tl) return;
    suppressClick.current = true;
    // Un quart de course suffit pour basculer.
    void animate(tl.time() / OPEN_DURATION > (d.p0 > 0.5 ? 0.75 : 0.25));
  };
  const dragProps = { onPointerDown: onDragStart, onPointerMove: onDragMove, onPointerUp: onDragEnd, onPointerCancel: onDragEnd };
  const clickUnlessDragged = (fn: () => void) => () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    fn();
  };

  // Apparition puis ouverture automatique.
  useEffect(() => {
    if (!ready) return;
    const t = gsap.to(sceneRef.current, { opacity: 1, duration: LOAD_FADE, ease: 'power1.out' });
    const d = gsap.delayedCall(LOAD_FADE + AUTO_OPEN_DELAY, () => toggle(true));
    return () => { t.kill(); d.kill(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Les lignes recalculées (changement de quantité) restent visibles une fois ouvert.
  useEffect(() => {
    if (tlRef.current?.progress() === 1) {
      cardRef.current?.querySelectorAll<HTMLElement>('[data-row]').forEach((n) => n.style.setProperty('--reveal', '1'));
    }
  }, [quote]);

  const mat = MATERIALS[spec.material];
  const fin = FINISHES[spec.finish];
  const shapeLine = `${num(spec.width)} × ${num(spec.depth)}${spec.flanges.length ? ` × ${num(Math.max(...spec.flanges.map((f) => f.height)))}` : ''} mm`;
  const date = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  const imgVars = { '--img-day': images ? `url(${images.day})` : 'none', '--img-night': images ? `url(${images.night})` : 'none' } as CSSProperties;
  const lines = clientLines(quote.lines, spec, flat);

  const stats = [
    { value: `${flat.bendLines.length}`, label: 'plis' },
    { value: `${spec.holes.length}`, label: 'perçages' },
    { value: `${quote.leadTimeDays} j`, label: 'délai\nindicatif' },
  ];

  return (
    <div ref={sceneRef} className={styles.scene} style={imgVars}>
      <div className={styles.cardWrap}>
        <div ref={cardRef} className={styles.card} data-state="folded">
          {/* Feuillet gauche, fixe : le plan (blueprint) */}
          <div className={`${styles.face} ${styles.left}`} aria-hidden={!open}>
            <span className={styles.photo} style={{ backgroundImage: 'var(--img-night)' }} />
            {settled && (
              <div className={styles.live}>
                <Viewer3D spec={spec} variant="blueprint" showDims />
              </div>
            )}
            <span className={styles.insideTitle}>{spec.name}<small>{shapeLine}</small></span>
            <span className={styles.stats}>
              {stats.map((s) => (
                <span key={s.label} className={styles.stat} data-stat>
                  <span className={styles.circle}>{s.value}</span>
                  <span className={styles.statLabel}>{s.label}</span>
                </span>
              ))}
            </span>
            <span className={styles.specList}>
              <span><b>Matière</b>{mat.label}</span>
              <span><b>Épaisseur</b>{num(spec.thickness)} mm</span>
              <span><b>Finition</b>{fin.label}{spec.ral ? ` RAL ${spec.ral}` : ''}</span>
              {(spec.cuts?.length ?? 0) > 0 && <span><b>Découpes</b>{spec.cuts!.length}</span>}
            </span>
            <span className={styles.leafActions}>
              <span className={styles.dragHint}>{settled ? 'Glissez pour tourner le plan' : ''}</span>
              <button type="button" className={styles.open3d} onClick={() => setBig3d(true)} tabIndex={open ? 0 : -1}>
                <Icon name="cube" size={16} /> Voir en 3D
              </button>
            </span>
          </div>

          {/* Feuillet droit, mobile : charnière à gauche ; dessus = devis, dos = couverture */}
          <div className={styles.flap}>
            <div className={`${styles.face} ${styles.screen}`} aria-hidden={!open}>
              <header className={styles.paperHead}>
                <img src={LOGO_URL} alt="Tôlerie Rémond" className={styles.logo} />
                <div>
                  <h2>Devis estimatif</h2>
                  <p>N° {reference} · {date}</p>
                </div>
              </header>

              <p className={styles.notice}>
                <Icon name="warn" size={14} />
                <span>Estimation indicative, vérifiée par un technicien avant fabrication.{missing.length > 0 && <> À confirmer : {missing.join(', ')}.</>}</span>
              </p>

              <ul className={styles.lines}>
                {lines.map((l) => (
                  <li key={l.id} data-row>
                    <span className={styles.lineText}><b>{l.label}</b>{l.detail && <small>{l.detail}</small>}</span>
                    <span className={styles.amount}>{eur(l.amount)}</span>
                  </li>
                ))}
              </ul>

              <footer className={styles.total}>
                <span className={styles.totalLeft}>
                  <small>{quote.quantity} pièce{quote.quantity > 1 ? 's' : ''} · délai indicatif {quote.leadTimeDays} j ouvrés</small>
                  <small>Total {eur(quote.subtotal)} HT · {eur(quote.total)} TTC</small>
                </span>
                <span className={styles.unit}>
                  <small>Prix unitaire</small>
                  <strong>{eur(quote.unitPrice)}<em> HT</em></strong>
                </span>
              </footer>
              {/* Ombre portée du pli pendant le mouvement */}
              <span className={styles.shade} aria-hidden />
            </div>

            <button
              type="button"
              className={`${styles.face} ${styles.cover}`}
              {...dragProps}
              onClick={clickUnlessDragged(() => toggle(true))}
              aria-expanded={open}
              aria-hidden={open}
              tabIndex={open ? -1 : 0}
              aria-label="Ouvrir le devis"
            >
              <ProgressiveBlur k="var(--blur-cover)">
                <span className={styles.photo} style={{ backgroundImage: 'var(--img-day)' }} />
                <span className={styles.coverShade} />
                <img className={styles.coverLogo} src={LOGO_WHITE_URL} alt="" />
                <span className={styles.coverTitle}>Votre devis<br /><small>{reference}</small></span>
                <span className={styles.coverBody}>
                  {spec.name} · {shapeLine}<br />{mat.label} ép. {num(spec.thickness)} mm · {spec.quantity} pc
                  <em>Toucher ou glisser vers la droite</em>
                </span>
              </ProgressiveBlur>
            </button>
          </div>

          {/* Poignées sur le bord libre : à gauche fermé (tirer à droite), à droite ouvert (tirer à gauche) */}
          <button type="button" className={`${styles.grip} ${styles.gripOpen}`} {...dragProps} onClick={clickUnlessDragged(() => toggle(true))} tabIndex={-1} aria-hidden>
            <span />
          </button>
          <button
            type="button"
            className={`${styles.grip} ${styles.gripClose}`}
            {...dragProps}
            onClick={clickUnlessDragged(() => toggle(false))}
            tabIndex={settled ? 0 : -1}
            aria-label="Refermer le devis"
            title="Glisser vers la gauche pour refermer"
          >
            <span />
          </button>
        </div>
      </div>

      <QuantityRail tiers={quote.tiers} quantity={quote.quantity} unitPrice={quote.unitPrice} visible={open} onQuantity={onQuantity} />
      <View3DModal spec={spec} open={big3d} onClose={() => setBig3d(false)} />
    </div>
  );
}

/** Rail vertical à droite du devis : proto, séries, ou quantité libre. */
function QuantityRail({ tiers, quantity, unitPrice, visible, onQuantity }: { tiers: PriceTier[]; quantity: number; unitPrice: number; visible: boolean; onQuantity: (q: number) => void }) {
  const isTier = tiers.some((t) => t.quantity === quantity);
  const [custom, setCustom] = useState(isTier ? '' : String(quantity));
  const proto = tiers.find((t) => t.quantity === 1)?.unitPrice ?? 0;

  const commit = (raw: string) => {
    const n = Math.round(Number(raw.replace(/\s/g, '').replace(',', '.')));
    if (Number.isFinite(n) && n >= 1 && n <= 100000) onQuantity(n);
  };

  return (
    <aside className={`${styles.rail} ${visible ? styles.railOn : ''}`} aria-label="Quantité">
      <h3>Quantité</h3>
      <p className={styles.railHint}>Plus la série est grande, plus le prix unitaire baisse.</p>
      {tiers.map((t) => {
        const save = proto && t.quantity > 1 ? Math.round((1 - t.unitPrice / proto) * 100) : 0;
        return (
          <button key={t.quantity} type="button" className={`${styles.tier} ${t.quantity === quantity ? styles.tierOn : ''}`} onClick={() => { setCustom(''); onQuantity(t.quantity); }} aria-pressed={t.quantity === quantity}>
            <span className={styles.tierQty}>{t.quantity === 1 ? 'Proto · 1 pièce' : `× ${t.quantity} pièces`}</span>
            <span className={styles.tierPrice}>{eur(t.unitPrice)}<small> / pc</small></span>
            {save > 0 && <span className={styles.tierSave}>−{save} %</span>}
          </button>
        );
      })}
      <label className={`${styles.tier} ${styles.custom} ${!isTier ? styles.tierOn : ''}`}>
        <span className={styles.tierQty}>Autre quantité</span>
        <span className={styles.customRow}>
          <span>×</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            enterKeyHint="done"
            placeholder="ex. 35"
            value={custom}
            onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); setCustom(v); commit(v); }}
          />
          <span>pièces</span>
        </span>
        {!isTier && <span className={styles.tierPrice}>{eur(unitPrice)}<small> / pc</small></span>}
      </label>
    </aside>
  );
}

/** Le contenu dessiné trois fois : net, puis deux copies floutées masquées vers le bord libre (à gauche). */
function ProgressiveBlur({ k, children }: { k: string; children: ReactNode }) {
  return (
    <span className={styles.pb} style={{ '--k': k } as CSSProperties}>
      <span className={styles.pbSharp}>{children}</span>
      <span className={styles.pbSoft} aria-hidden>{children}</span>
      <span className={styles.pbHard} aria-hidden>{children}</span>
    </span>
  );
}
