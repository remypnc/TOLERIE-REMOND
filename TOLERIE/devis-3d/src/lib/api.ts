// Point de branchement vers le serveur de l'atelier (base de données, e-mails, back-office).
//
// L'interface `Backend` est le contrat : la page ne parle qu'à elle.
// - `HttpBackend` : le vrai serveur, activé dès que VITE_API_URL est défini (voir docs/BACKOFFICE.md).
// - `LocalBackend` : en attendant le serveur, tout est gardé dans CE navigateur ; aucun e-mail n'est
//   envoyé et l'atelier ne reçoit rien. Ne pas mettre en production sans le serveur.
import type { PartSpec, Quote } from './types';
import { buildOrder, plannedDates, type ClientContact, type ClientOrder, type QuoteSubmission, type SubmitResult } from './orders';

export type { ClientContact, QuoteSubmission, SubmitResult } from './orders';

/** Client connecté. `admin` = compte de l'atelier : édition complète et back-office. */
export type Account = ClientContact & { role?: 'admin' | 'client' };

/** Réponse à une demande de lien. `devLink` : test sans SMTP, le lien à ouvrir directement. */
export interface AccessResult {
  linkSent: boolean;
  devLink?: string;
}

// --- Back-office (compte atelier) ---------------------------------------------------------------

export interface AdminOrder extends ClientOrder {
  email: string;
  internalStatus: string;
}
export interface AdminClient extends ClientContact {
  createdAt: string;
  orders: number;
  lastOrderAt: string | null;
}
export interface AdminSubmission extends QuoteSubmission {
  revision: number;
}
export interface AdminOrderDetail {
  order: AdminOrder;
  client: ClientContact | null;
  submissions: AdminSubmission[];
  log: { at: string; internalStatus: string | null; note: string | null; source: string }[];
}
export interface StatusUpdate {
  internalStatus: string;
  note?: string;
  clientNote?: string;
  shipDate?: string;
  deliveryDate?: string;
  tracking?: ClientOrder['tracking'];
  finalPrice?: { unitPrice: number; subtotal: number };
  /** Prévenir le client par e-mail (par défaut : seulement si son étape change). */
  notify?: boolean;
}

export interface Backend {
  readonly kind: 'http' | 'local';
  submitQuote(s: QuoteSubmission): Promise<SubmitResult>;
  /** Pièces du client connecté, la plus récente d'abord. */
  listOrders(email: string): Promise<ClientOrder[]>;
  /** Accès à l'espace client : envoie un lien de connexion par e-mail (serveur) ou ouvre directement (local). */
  requestAccess(email: string): Promise<AccessResult>;
  /** Client connecté (session), ou null. */
  me(): Promise<Account | null>;
  updateProfile(c: ClientContact): Promise<void>;
  logout(): Promise<void>;
}

/** Session absente ou expirée : il faut se reconnecter. */
export class NotLoggedIn extends Error {}

export function newReference(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `DEV-${ymd}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

// --- Serveur de l'atelier ------------------------------------------------------------------

class HttpBackend implements Backend {
  readonly kind = 'http' as const;
  private base: string;
  constructor(base: string) {
    this.base = base;
  }
  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      credentials: 'include', // session de l'espace client (cookie posé par le lien de connexion)
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
    if (res.status === 401) throw new NotLoggedIn();
    if (!res.ok) throw new Error(`API ${res.status} sur ${path}`);
    return (await res.json()) as T;
  }
  submitQuote(s: QuoteSubmission) {
    return this.call<SubmitResult>('/quotes', { method: 'POST', body: JSON.stringify(s) });
  }
  listOrders() {
    // Le serveur répond selon la session : on ne liste jamais les pièces d'un e-mail sans connexion.
    return this.call<ClientOrder[]>('/me/orders');
  }
  requestAccess(email: string) {
    return this.call<AccessResult>('/auth/link', { method: 'POST', body: JSON.stringify({ email }) });
  }
  async me() {
    try {
      return await this.call<Account>('/me');
    } catch {
      return null;
    }
  }
  async updateProfile(c: ClientContact) {
    await this.call('/me', { method: 'PUT', body: JSON.stringify(c) });
  }
  async logout() {
    await this.call('/auth/logout', { method: 'POST' }).catch(() => undefined);
  }
  // Back-office : le serveur refuse si la session n'est pas celle d'un compte atelier.
  adminOrders() {
    return this.call<AdminOrder[]>('/admin/orders');
  }
  adminClients() {
    return this.call<AdminClient[]>('/admin/clients');
  }
  adminOrder(reference: string) {
    return this.call<AdminOrderDetail>(`/admin/orders/${encodeURIComponent(reference)}`);
  }
  adminStatus(reference: string, u: StatusUpdate) {
    return this.call<{ order: ClientOrder; emailSent: boolean; notified: boolean; devLink?: string }>(`/admin/orders/${encodeURIComponent(reference)}/status`, { method: 'POST', body: JSON.stringify(u) });
  }
}

// --- Navigateur (en attendant le serveur) ----------------------------------------------------

const KEY = 'tolerie-remond:orders';

class LocalBackend implements Backend {
  readonly kind = 'local' as const;
  private read(): ClientOrder[] {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? '[]') as ClientOrder[];
    } catch {
      return [];
    }
  }
  private write(list: ClientOrder[]) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
    } catch {
      // Stockage plein ou indisponible : on retire les vignettes, puis on abandonne sans bloquer le client.
      try {
        localStorage.setItem(KEY, JSON.stringify(list.map((o) => ({ ...o, thumbnail: undefined }))));
      } catch { /* navigation privée */ }
    }
  }
  async submitQuote(s: QuoteSubmission): Promise<SubmitResult> {
    const list = this.read();
    const prev = s.replaces ? list.find((o) => o.reference === s.replaces) : undefined;
    const order = buildOrder(s, prev);
    this.write([order, ...list.filter((o) => o.reference !== order.reference)]);
    await new Promise((r) => setTimeout(r, 600));
    return { order, emailSent: false, stored: 'browser' };
  }
  async listOrders(email: string) {
    const e = email.trim().toLowerCase();
    return this.read()
      .filter((o) => o.contact.email.trim().toLowerCase() === e)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async requestAccess() {
    return { linkSent: false };
  }
  async me() {
    return loadClient();
  }
  async updateProfile(c: ClientContact) {
    saveClient(c);
  }
  async logout() {
    saveClient(null);
  }
  /** Développement : quelques pièces à différentes étapes, pour voir l'espace client rempli. */
  seedDemo(email: string, spec: PartSpec, quote: Quote) {
    const day = 24 * 3600 * 1000;
    const at = (d: number) => new Date(Date.now() - d * day).toISOString();
    const make = (ref: string, name: string, ago: number, steps: ClientOrder['history'], extra: Partial<ClientOrder> = {}): ClientOrder => ({
      ...buildOrder({ reference: ref, contact: { email }, createdAt: at(ago), spec: { ...spec, name }, quote, missing: [], conversation: [] }),
      status: steps[steps.length - 1].status,
      history: steps,
      updatedAt: steps[steps.length - 1].at,
      ...extra,
    });
    const demo = [
      make('DEV-DEMO-A1', 'Équerre de fixation', 24, [
        { at: at(24), status: 'recue', note: 'Demande envoyée depuis le devis en ligne' },
        { at: at(23), status: 'verification' },
        { at: at(22), status: 'devis_envoye', note: 'Devis définitif envoyé par e-mail' },
        { at: at(21), status: 'validee' },
        { at: at(16), status: 'fabrication' },
        { at: at(9), status: 'expediee', note: 'Colis remis au transporteur' },
        { at: at(7), status: 'livree' },
      ], { price: { quantity: 20, unitPrice: 6.4, subtotal: 128, final: true } }),
      make('DEV-DEMO-B2', 'Capot inox', 8, [
        { at: at(8), status: 'recue', note: 'Demande envoyée depuis le devis en ligne' },
        { at: at(7), status: 'verification' },
        { at: at(6), status: 'devis_envoye', note: 'Devis définitif envoyé par e-mail' },
        { at: at(5), status: 'validee' },
        { at: at(2), status: 'fabrication' },
      ], { price: { quantity: 5, unitPrice: 41.9, subtotal: 209.5, final: true }, ...plannedDates(new Date(at(5)), 8, true) }),
    ];
    this.write([...this.read().filter((o) => !o.reference.startsWith('DEV-DEMO')), ...demo]);
  }
}

const apiUrl = import.meta.env.VITE_API_URL as string | undefined;
export const backend: Backend = apiUrl ? new HttpBackend(apiUrl.replace(/\/$/, '')) : new LocalBackend();
export const localBackend = backend instanceof LocalBackend ? backend : null;
/** Back-office : uniquement avec le serveur de l'atelier. */
export const adminApi = backend instanceof HttpBackend ? backend : null;

// --- Coordonnées mémorisées sur l'appareil -----------------------------------------------------
const CLIENT_KEY = 'tolerie-remond:client';

export function loadClient(): ClientContact | null {
  try {
    const c = JSON.parse(localStorage.getItem(CLIENT_KEY) ?? 'null') as ClientContact | null;
    return c?.email ? c : null;
  } catch {
    return null;
  }
}

export function saveClient(c: ClientContact | null) {
  try {
    if (c) localStorage.setItem(CLIENT_KEY, JSON.stringify({ ...c, message: undefined }));
    else localStorage.removeItem(CLIENT_KEY);
  } catch {
    // stockage indisponible : tant pis, le client retapera ses coordonnées
  }
}
