// Suivi des pièces côté client : modèle partagé entre l'interface, l'API de l'atelier et l'ERP.
//
// Deux niveaux de statut :
// - le statut INTERNE vient de l'atelier (ERP / Altior, Excel…) et peut être très détaillé ;
// - le statut CLIENT est une étape simple, la seule montrée au client. On ne lui expose jamais
//   le poste de travail, l'opérateur, les aléas ou les marges : seulement où en est sa pièce.
import type { ChatMessage, PartSpec, Quote } from './types';

/** Coordonnées du client : où envoyer le devis définitif. Seul l'e-mail est obligatoire. */
export interface ClientContact {
  email: string;
  company?: string;
  name?: string;
  phone?: string;
  /** Adresse de livraison (rue), code postal et ville : la zone de transport en dépend. */
  address?: string;
  zip?: string;
  city?: string;
  /** Retrait à l'atelier (Crépand) au lieu d'une livraison. */
  pickup?: boolean;
  message?: string;
}

export type ClientStatus = 'recue' | 'verification' | 'devis_envoye' | 'validee' | 'fabrication' | 'expediee' | 'livree' | 'annulee';

/** Étapes affichées au client, dans l'ordre. */
export const CLIENT_STEPS: { id: Exclude<ClientStatus, 'annulee'>; label: string; help: string }[] = [
  { id: 'recue', label: 'Demande reçue', help: 'Votre demande est enregistrée.' },
  { id: 'verification', label: 'Vérification', help: 'Un technicien contrôle les cotes et la faisabilité.' },
  { id: 'devis_envoye', label: 'Devis envoyé', help: 'Le devis définitif vous attend : validez-le pour lancer la fabrication.' },
  { id: 'validee', label: 'Commande validée', help: 'Commande confirmée, la fabrication est planifiée.' },
  { id: 'fabrication', label: 'En fabrication', help: 'Votre pièce est en cours de fabrication à l’atelier.' },
  { id: 'expediee', label: 'Expédiée', help: 'Votre colis est en route.' },
  { id: 'livree', label: 'Livrée', help: 'Pièce livrée.' },
];

export const STATUS_LABEL: Record<ClientStatus, string> = {
  ...(Object.fromEntries(CLIENT_STEPS.map((s) => [s.id, s.label])) as Record<Exclude<ClientStatus, 'annulee'>, string>),
  annulee: 'Annulée',
};

/**
 * Statuts internes de l'atelier → étape client. Les clés seront alignées sur les statuts réels de
 * l'ERP (Altior) au moment du branchement ; un statut inconnu ne fait jamais reculer le client.
 */
export const INTERNAL_TO_CLIENT: Record<string, ClientStatus> = {
  a_verifier: 'recue',
  en_etude: 'verification',
  chiffrage: 'verification',
  devis_envoye: 'devis_envoye',
  commande: 'validee',
  planifie: 'validee',
  approvisionnement: 'fabrication',
  decoupe_laser: 'fabrication',
  pliage: 'fabrication',
  soudure: 'fabrication',
  finition: 'fabrication',
  controle: 'fabrication',
  pret_expedition: 'fabrication',
  expedie: 'expediee',
  livre: 'livree',
  annule: 'annulee',
};

/** Libellés des statuts internes, pour le back-office (jamais montrés au client). */
export const INTERNAL_LABEL: Record<string, string> = {
  a_verifier: 'À vérifier',
  en_etude: 'En étude',
  chiffrage: 'Chiffrage',
  devis_envoye: 'Devis envoyé',
  commande: 'Commande reçue',
  planifie: 'Planifiée',
  approvisionnement: 'Approvisionnement',
  decoupe_laser: 'Découpe laser',
  pliage: 'Pliage',
  soudure: 'Soudure',
  finition: 'Finition',
  controle: 'Contrôle',
  pret_expedition: 'Prête à expédier',
  expedie: 'Expédiée',
  livre: 'Livrée',
  annule: 'Annulée',
};

export const stepIndex = (s: ClientStatus) => CLIENT_STEPS.findIndex((x) => x.id === s);

/** Le client peut encore modifier sa pièce tant que la commande n'est pas validée. */
export const canEdit = (s: ClientStatus) => s === 'recue' || s === 'verification' || s === 'devis_envoye';

/** Événement visible par le client (jamais de détail interne). */
export interface OrderEvent {
  at: string;
  status: ClientStatus;
  /** Texte court pour le client, ex. « Modification envoyée (version 2) ». */
  note?: string;
}

export interface ClientOrder {
  reference: string;
  /** 1 à la création, +1 à chaque modification envoyée par le client. */
  revision: number;
  createdAt: string;
  updatedAt: string;
  contact: ClientContact;
  spec: PartSpec;
  price: {
    quantity: number;
    unitPrice: number;
    /** Total HT du lot. */
    subtotal: number;
    /** false = estimation en ligne ; true = prix du devis définitif validé par l'atelier. */
    final: boolean;
  };
  /** Délai de fabrication en jours ouvrés, à partir de la validation de commande. */
  leadTimeDays: number;
  /** Durée de transport en jours ouvrés. */
  deliveryDays: number;
  /** Dates prévues (ISO), recalculées par l'atelier au fil de l'eau. */
  shipDate?: string;
  deliveryDate?: string;
  tracking?: { carrier: string; url?: string; number?: string };
  status: ClientStatus;
  history: OrderEvent[];
  /** Informations que le client n'a pas confirmées : le technicien les lui demandera. */
  missing: string[];
  thumbnail?: string;
}

/** Ajoute des jours ouvrés (lundi → vendredi) à une date. */
export function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from);
  let left = Math.max(0, Math.round(days));
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d;
}

/** Jours ouvrés prévus pour la vérification et l'envoi du devis définitif. */
export const REVIEW_DAYS = 2;
/** Transport standard France métropolitaine. */
export const DELIVERY_DAYS = 2;

/** Dates prévisionnelles à partir d'une date de départ (création ou validation de commande). */
export function plannedDates(start: Date, leadTimeDays: number, alreadyValidated: boolean) {
  const ship = addBusinessDays(start, leadTimeDays + (alreadyValidated ? 0 : REVIEW_DAYS));
  return { shipDate: ship.toISOString(), deliveryDate: addBusinessDays(ship, DELIVERY_DAYS).toISOString() };
}

// --- Envoi d'une demande (commun au navigateur et au serveur) ---------------------------------

export interface QuoteSubmission {
  reference: string;
  /** Référence d'une demande existante que le client modifie (nouvelle version, même référence). */
  replaces?: string;
  contact: ClientContact;
  createdAt: string;
  spec: PartSpec;
  quote: Quote;
  /** Infos non confirmées par le client : à vérifier en priorité par le technicien. */
  missing: string[];
  conversation: ChatMessage[];
  thumbnail?: string;
}

export interface SubmitResult {
  order: ClientOrder;
  /** true seulement si l'e-mail de confirmation est réellement parti. */
  emailSent: boolean;
  /** Où la demande est enregistrée : base de l'atelier ou navigateur seul. */
  stored: 'server' | 'browser';
  /** Test sans SMTP uniquement : le lien « Suivre ma pièce » de l'e-mail, à ouvrir directement. */
  devLink?: string;
}

/** Version « client » d'une demande, à la création ou après une modification. */
export function buildOrder(s: QuoteSubmission, previous?: ClientOrder): ClientOrder {
  const now = s.createdAt;
  return {
    reference: previous?.reference ?? s.reference,
    revision: (previous?.revision ?? 0) + 1,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    contact: s.contact,
    spec: s.spec,
    price: { quantity: s.quote.quantity, unitPrice: s.quote.unitPrice, subtotal: s.quote.subtotal, final: false },
    leadTimeDays: s.quote.leadTimeDays,
    deliveryDays: DELIVERY_DAYS,
    ...plannedDates(new Date(now), s.quote.leadTimeDays, false),
    // Une modification renvoie la demande en vérification.
    status: previous ? 'verification' : 'recue',
    history: [
      ...(previous?.history ?? []),
      previous
        ? { at: now, status: 'verification', note: `Modification envoyée (version ${previous.revision + 1})` }
        : { at: now, status: 'recue', note: 'Demande envoyée depuis le devis en ligne' },
    ],
    missing: s.missing,
    thumbnail: s.thumbnail,
  };
}

/**
 * Applique un statut interne (ERP, back-office) : l'étape client avance, ne recule jamais
 * (sauf annulation), et un événement n'est ajouté que si l'étape visible change.
 */
export function applyInternalStatus(o: ClientOrder, internal: string, at: string, note?: string): { order: ClientOrder; changed: boolean } {
  const next = INTERNAL_TO_CLIENT[internal];
  if (!next) return { order: o, changed: false };
  const forward = next === 'annulee' || stepIndex(next) > stepIndex(o.status);
  if (!forward) return { order: o, changed: false };
  return {
    order: { ...o, status: next, updatedAt: at, history: [...o.history, { at, status: next, ...(note ? { note } : {}) }] },
    changed: true,
  };
}
