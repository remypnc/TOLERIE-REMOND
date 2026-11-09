// Serveur de l'atelier : reçoit les demandes du devis en ligne, les enregistre, envoie les e-mails,
// gère l'espace client (lien de connexion + session) et expose une route back-office pour l'ERP.
// Lancement : `npm run server` (ou automatiquement avec `npm run dev`). Toutes les routes sont sous /api.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { applyInternalStatus, buildOrder, canEdit, INTERNAL_TO_CLIENT, type ClientContact, type ClientOrder, type QuoteSubmission, type SubmitResult } from '../src/lib/orders.ts';
import { config, devLinks } from './config.ts';
import * as db from './db.ts';
import { AiRefused, aiEnabled, aiTurn } from './ai.ts';
import { confirmationMail, loginMail, outbox, send, statusMail, workshopMail } from './mail.ts';

const COOKIE = 'trs_session';
const MAX_BODY = 3 * 1024 * 1024;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// --- Outils ---------------------------------------------------------------------------------

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const normEmail = (e: unknown) => {
  const v = typeof e === 'string' ? e.trim().toLowerCase() : '';
  if (!EMAIL.test(v)) throw new HttpError(400, 'E-mail invalide');
  return v;
};
const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

function cleanContact(raw: unknown): ClientContact {
  const c = (raw ?? {}) as Record<string, unknown>;
  return {
    email: normEmail(c.email),
    company: str(c.company, 120),
    name: str(c.name, 120),
    phone: str(c.phone, 30),
    address: str(c.address, 200),
    zip: str(c.zip, 12),
    city: str(c.city, 80),
    pickup: c.pickup === true ? true : undefined,
    message: str(c.message, 2000),
  };
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'Demande trop volumineuse');
    chunks.push(chunk as Buffer);
  }
  try {
    return chunks.length ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>) : {};
  } catch {
    throw new HttpError(400, 'JSON invalide');
  }
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function redirect(res: ServerResponse, url: string, headers: Record<string, string | string[]> = {}) {
  res.writeHead(302, { Location: url, 'Cache-Control': 'no-store', ...headers });
  res.end();
}

function cookies(req: IncomingMessage): Record<string, string> {
  return Object.fromEntries((req.headers.cookie ?? '').split(';').map((c) => c.trim().split('=')).filter(([k, v]) => k && v).map(([k, v]) => [k, decodeURIComponent(v)]));
}

function sessionCookie(value: string, maxAgeSeconds: number) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${config.production ? '; Secure' : ''}`;
}

const sessionOf = (req: IncomingMessage) => {
  const raw = cookies(req)[COOKIE];
  return raw ? db.sessionEmail(sha(raw)) : null;
};

function requireSession(req: IncomingMessage) {
  const email = sessionOf(req);
  if (!email) throw new HttpError(401, 'Connexion requise');
  return email;
}

const isAdmin = (email: string | null) => !!email && config.adminEmails.includes(email);

/** Back-office : compte atelier connecté, ou ERP avec le jeton. Renvoie l'origine pour le journal interne. */
function requireAdmin(req: IncomingMessage): string {
  if (config.adminToken && req.headers.authorization === `Bearer ${config.adminToken}`) return 'erp';
  const email = sessionOf(req);
  if (!email) throw new HttpError(401, 'Connexion requise');
  if (!isAdmin(email)) throw new HttpError(403, 'Réservé à l’atelier');
  return email;
}

/** Lien de connexion à usage unique (dans un e-mail). */
function loginUrl(email: string, minutes: number) {
  const t = token();
  db.saveLoginToken(sha(t), email, new Date(Date.now() + minutes * 60_000));
  return `${config.appUrl}/api/auth/callback?token=${t}`;
}

/** Limite simple : `max` demandes par clé sur la fenêtre (anti-abus du formulaire et des liens). */
const hits = new Map<string, number[]>();
function limit(key: string, max: number, windowMs: number) {
  const t = Date.now();
  const list = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
  if (list.length >= max) throw new HttpError(429, 'Trop de demandes, réessayez dans quelques minutes');
  list.push(t);
  hits.set(key, list);
}
const ip = (req: IncomingMessage) => (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim() ?? req.socket.remoteAddress ?? '?';

// --- Routes -----------------------------------------------------------------------------------

/** Nouvelle demande, ou nouvelle version d'une demande existante (client connecté). */
async function postQuote(req: IncomingMessage, res: ServerResponse) {
  limit(`quote:${ip(req)}`, 20, 60 * 60_000);
  const body = await readJson(req);
  const contact = cleanContact(body.contact);
  if (!body.spec || typeof body.spec !== 'object' || !body.quote || typeof body.quote !== 'object') throw new HttpError(400, 'Pièce manquante');
  const thumb = typeof body.thumbnail === 'string' && /^data:image\/(jpeg|png);base64,/.test(body.thumbnail) && body.thumbnail.length < 400_000 ? body.thumbnail : undefined;

  let previous: ClientOrder | undefined;
  let reference = typeof body.reference === 'string' && /^DEV-\d{8}-[A-Z0-9]{4}$/.test(body.reference) ? body.reference : '';
  if (body.replaces) {
    // Modifier une pièce : uniquement la sienne, connecté, et tant que la commande n'est pas validée.
    // L'atelier peut corriger la pièce de n'importe quel client : la demande reste au nom du client.
    const email = requireSession(req);
    const admin = isAdmin(email);
    const existing = db.getOrder(String(body.replaces));
    if (!existing || (existing.email !== email && !admin)) throw new HttpError(404, 'Pièce introuvable');
    if (!canEdit(existing.status) && !admin) throw new HttpError(409, 'Cette pièce est déjà en production : elle ne peut plus être modifiée');
    previous = existing;
    reference = existing.reference;
    if (existing.email !== email) Object.assign(contact, { ...existing.contact, message: contact.message });
    else contact.email = email;
  }
  // La référence est attribuée par le serveur si elle manque ou est déjà prise.
  while (!reference || (!previous && db.getOrder(reference))) {
    const d = new Date();
    reference = `DEV-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${randomBytes(3).toString('hex').slice(0, 4).toUpperCase()}`;
  }

  const submission: QuoteSubmission = {
    reference,
    replaces: previous?.reference,
    contact,
    createdAt: new Date().toISOString(),
    spec: body.spec as QuoteSubmission['spec'],
    quote: body.quote as QuoteSubmission['quote'],
    missing: Array.isArray(body.missing) ? body.missing.filter((m): m is string => typeof m === 'string').slice(0, 20) : [],
    // Les aperçus de pièces jointes (adresses locales du navigateur) ne servent à rien côté atelier.
    conversation: Array.isArray(body.conversation) ? (body.conversation as QuoteSubmission['conversation']).slice(-200).map((m) => ({ ...m, attachments: m.attachments?.map((a) => ({ ...a, url: undefined })) })) : [],
    thumbnail: thumb,
  };
  const { message, ...publicContact } = contact;
  const order = buildOrder({ ...submission, contact: publicContact }, previous);

  db.upsertClient(publicContact);
  db.saveSubmission(order, submission);

  const link = loginUrl(order.contact.email, config.confirmLinkDays * 24 * 60);
  const emailSent = await send(confirmationMail(order, link));
  if (config.workshopEmail) void send(workshopMail(order, message));

  const result: SubmitResult = { order, emailSent, stored: 'server', ...(devLinks ? { devLink: link } : {}) };
  json(res, 201, result);
}

/** Assistant IA : un tour de conversation → modification structurée de la pièce (la page la contrôle et l'applique). */
async function postAssistant(req: IncomingMessage, res: ServerResponse) {
  if (!aiEnabled) return json(res, 503, { error: 'IA non configurée' });
  limit(`ai:${ip(req)}`, 40, 10 * 60_000);
  const body = await readJson(req);
  const text = str(body.text, 4000);
  if (!text) throw new HttpError(400, 'Message vide');
  const history = Array.isArray(body.history)
    ? body.history.slice(-12).map((h: { role?: unknown; text?: unknown }) => ({ role: h.role === 'user' ? 'user' : 'assistant', text: str(h.text, 4000) ?? '' })).filter((h) => h.text)
    : [];
  try {
    json(res, 200, await aiTurn(str(body.context, 30000) ?? '{}', history, text));
  } catch (e) {
    if (e instanceof AiRefused) return json(res, 422, { error: 'Demande déclinée' });
    console.error('[ia] échec', e);
    json(res, 502, { error: 'IA indisponible' });
  }
}

async function postAuthLink(req: IncomingMessage, res: ServerResponse) {
  const body = await readJson(req);
  const email = normEmail(body.email);
  limit(`link:${email}`, 5, 15 * 60_000);
  limit(`link-ip:${ip(req)}`, 20, 15 * 60_000);
  // Même réponse que l'e-mail soit connu ou non : on ne révèle pas qui est client.
  const link = loginUrl(email, config.loginLinkMinutes);
  const sent = await send(loginMail(email, link));
  json(res, 200, { linkSent: sent || !config.production, ...(devLinks ? { devLink: link } : {}) });
}

function getAuthCallback(url: URL, res: ServerResponse) {
  const t = url.searchParams.get('token') ?? '';
  const email = t ? db.consumeLoginToken(sha(t)) : null;
  if (!email) return redirect(res, `${config.appUrl}/#lien-expire`);
  db.upsertClient({ email });
  const s = token();
  db.createSession(sha(s), email, new Date(Date.now() + config.sessionDays * 86_400_000));
  redirect(res, `${config.appUrl}/#mes-pieces`, { 'Set-Cookie': sessionCookie(s, config.sessionDays * 86_400) });
}

async function adminStatus(req: IncomingMessage, res: ServerResponse, reference: string) {
  const who = requireAdmin(req);
  const body = await readJson(req);
  const current = db.getOrder(reference);
  if (!current) throw new HttpError(404, 'Pièce introuvable');
  const internal = String(body.internalStatus ?? '');
  if (!(internal in INTERNAL_TO_CLIENT)) throw new HttpError(400, `Statut interne inconnu : ${internal}`);
  const at = new Date().toISOString();
  const { internalStatus: _i, email: _e, ...base } = current;
  let { order, changed } = applyInternalStatus(base, internal, at, str(body.clientNote, 200));
  // Dates, suivi colis et prix définitif : mis à jour même sans changement d'étape.
  order = {
    ...order,
    shipDate: str(body.shipDate, 40) ?? order.shipDate,
    deliveryDate: str(body.deliveryDate, 40) ?? order.deliveryDate,
    tracking: body.tracking && typeof body.tracking === 'object' ? (body.tracking as ClientOrder['tracking']) : order.tracking,
    price: body.finalPrice && typeof body.finalPrice === 'object' ? { ...order.price, ...(body.finalPrice as object), final: true } : order.price,
    updatedAt: at,
  };
  db.updateOrder(order, internal, str(body.note, 2000), str(body.source, 40) ?? who);
  // E-mail au client : à chaque nouvelle étape par défaut, ou à la demande de l'atelier (`notify`), même sans changement d'étape.
  const notify = typeof body.notify === 'boolean' ? body.notify : changed;
  let emailSent = false;
  let devLink: string | undefined;
  if (notify) {
    const link = loginUrl(order.contact.email, config.confirmLinkDays * 24 * 60);
    emailSent = await send(statusMail(order, link, str(body.clientNote, 200)));
    if (devLinks) devLink = link;
  }
  json(res, 200, { order, clientStepChanged: changed, emailSent, notified: notify, ...(devLink ? { devLink } : {}) });
}

function devOutbox(res: ServerResponse) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const items = outbox()
    .map((m) => `<details><summary><b>${esc(m.subject)}</b> → ${esc(m.to)} <small>${new Date(m.at).toLocaleString('fr-FR')}</small></summary><iframe srcdoc="${esc(m.html)}" style="width:100%;height:560px;border:0"></iframe></details>`)
    .join('');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset="utf-8"><title>Boîte d'envoi (dev)</title><body style="font:14px system-ui;max-width:760px;margin:24px auto;display:grid;gap:10px"><h1>E-mails non envoyés (pas de SMTP)</h1>${items || '<p>Aucun e-mail.</p>'}</body>`);
}

async function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname.replace(/^\/api/, '');
  const m = req.method ?? 'GET';

  if (m === 'GET' && path === '/health') return json(res, 200, { ok: true, mail: config.smtp ? 'smtp' : 'outbox', ai: aiEnabled });
  if (m === 'POST' && path === '/assistant') return postAssistant(req, res);
  if (m === 'POST' && path === '/quotes') return postQuote(req, res);
  if (m === 'POST' && path === '/auth/link') return postAuthLink(req, res);
  if (m === 'GET' && path === '/auth/callback') return getAuthCallback(url, res);
  if (m === 'POST' && path === '/auth/logout') {
    const raw = cookies(req)[COOKIE];
    if (raw) db.deleteSession(sha(raw));
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  }
  if (m === 'GET' && path === '/me') {
    const email = requireSession(req);
    return json(res, 200, { ...(db.getClient(email) ?? { email }), role: isAdmin(email) ? 'admin' : 'client' });
  }
  if (m === 'PUT' && path === '/me') {
    const email = requireSession(req);
    const c = cleanContact({ ...(await readJson(req)), email });
    db.upsertClient(c);
    return json(res, 200, db.getClient(email));
  }
  if (m === 'GET' && path === '/me/orders') return json(res, 200, db.listOrders(requireSession(req)));
  const admin = /^\/admin\/orders\/(DEV-[\w-]+)\/status$/.exec(path);
  if (m === 'POST' && admin) return adminStatus(req, res, admin[1]);
  if (m === 'GET' && path === '/admin/orders') {
    requireAdmin(req);
    return json(res, 200, db.listAllOrders());
  }
  if (m === 'GET' && path === '/admin/clients') {
    requireAdmin(req);
    return json(res, 200, db.listClients());
  }
  const detail = /^\/admin\/orders\/(DEV-[\w-]+)$/.exec(path);
  if (m === 'GET' && detail) {
    requireAdmin(req);
    const order = db.getOrder(detail[1]);
    if (!order) throw new HttpError(404, 'Pièce introuvable');
    return json(res, 200, { order, client: db.getClient(order.email), ...db.orderTrail(order.reference) });
  }
  if (m === 'GET' && path === '/dev/outbox' && !config.production) return devOutbox(res);
  throw new HttpError(404, 'Route inconnue');
}

createServer((req, res) => {
  route(req, res).catch((e: unknown) => {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    json(res, status, { error: e instanceof HttpError ? e.message : 'Erreur serveur' });
  });
}).listen(config.port, () => {
  console.log(`[atelier] API sur http://localhost:${config.port}/api · e-mails : ${config.smtp ? 'SMTP' : 'boîte d’envoi locale (/api/dev/outbox)'} · atelier : ${config.adminEmails.join(', ') || 'aucun compte (ADMIN_EMAILS)'}`);
});

db.purgeExpired();
setInterval(db.purgeExpired, 6 * 3600_000).unref();
