// Base de données de l'atelier (SQLite, fichier unique) : clients, pièces, demandes complètes, connexions.
// SQLite suffit largement au démarrage ; le schéma se transpose tel quel vers PostgreSQL si besoin.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ClientContact, ClientOrder, QuoteSubmission } from '../src/lib/orders.ts';
import { config } from './config.ts';

mkdirSync(dirname(config.dbPath), { recursive: true });
const db = new DatabaseSync(config.dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS clients (
    email       TEXT PRIMARY KEY,
    company     TEXT,
    name        TEXT,
    phone       TEXT,
    zip         TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  -- Une ligne par pièce (référence DEV-…) : l'état visible par le client + le statut interne de l'atelier.
  CREATE TABLE IF NOT EXISTS orders (
    reference        TEXT PRIMARY KEY,
    email            TEXT NOT NULL REFERENCES clients(email),
    revision         INTEGER NOT NULL,
    status           TEXT NOT NULL,
    internal_status  TEXT NOT NULL DEFAULT 'a_verifier',
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    data             TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS orders_email ON orders(email, updated_at);

  -- Chaque envoi du client, intégral (pièce, conversation, message, prix estimé) : la trace de la demande.
  CREATE TABLE IF NOT EXISTS submissions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    reference   TEXT NOT NULL REFERENCES orders(reference),
    revision    INTEGER NOT NULL,
    created_at  TEXT NOT NULL,
    payload     TEXT NOT NULL
  );

  -- Journal interne (jamais montré au client) : changements de statut ERP, notes atelier.
  CREATE TABLE IF NOT EXISTS internal_log (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    reference        TEXT NOT NULL REFERENCES orders(reference),
    at               TEXT NOT NULL,
    internal_status  TEXT,
    note             TEXT,
    source           TEXT NOT NULL
  );

  -- Liens de connexion et sessions : seules les empreintes SHA-256 sont stockées.
  CREATE TABLE IF NOT EXISTS login_tokens (
    hash        TEXT PRIMARY KEY,
    email       TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    used_at     TEXT
  );
  CREATE TABLE IF NOT EXISTS sessions (
    hash        TEXT PRIMARY KEY,
    email       TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    expires_at  TEXT NOT NULL
  );
`);

// Colonnes ajoutées après coup (bases déjà créées) : adresse de livraison.
const clientCols = (db.prepare('PRAGMA table_info(clients)').all() as { name: string }[]).map((c) => c.name);
for (const col of ['address', 'city']) if (!clientCols.includes(col)) db.exec(`ALTER TABLE clients ADD COLUMN ${col} TEXT`);

const now = () => new Date().toISOString();

// --- Clients ---------------------------------------------------------------------------------

export function upsertClient(c: ClientContact) {
  const t = now();
  // Un champ laissé vide ne remplace pas une valeur déjà connue.
  db.prepare(`
    INSERT INTO clients (email, company, name, phone, address, zip, city, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      company = COALESCE(excluded.company, company),
      name = COALESCE(excluded.name, name),
      phone = COALESCE(excluded.phone, phone),
      address = COALESCE(excluded.address, address),
      zip = COALESCE(excluded.zip, zip),
      city = COALESCE(excluded.city, city),
      updated_at = excluded.updated_at
  `).run(c.email, c.company ?? null, c.name ?? null, c.phone ?? null, c.address ?? null, c.zip ?? null, c.city ?? null, t, t);
}

export function getClient(email: string): ClientContact | null {
  const r = db.prepare('SELECT email, company, name, phone, address, zip, city FROM clients WHERE email = ?').get(email) as Record<string, string | null> | undefined;
  if (!r) return null;
  return Object.fromEntries(Object.entries(r).filter(([, v]) => v)) as unknown as ClientContact;
}

// --- Pièces ----------------------------------------------------------------------------------

export function getOrder(reference: string): (ClientOrder & { internalStatus: string; email: string }) | null {
  const r = db.prepare('SELECT data, internal_status, email FROM orders WHERE reference = ?').get(reference) as { data: string; internal_status: string; email: string } | undefined;
  return r ? { ...(JSON.parse(r.data) as ClientOrder), internalStatus: r.internal_status, email: r.email } : null;
}

export function listOrders(email: string): ClientOrder[] {
  const rows = db.prepare('SELECT data FROM orders WHERE email = ? ORDER BY updated_at DESC').all(email) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as ClientOrder);
}

/** Enregistre une pièce et la demande complète qui l'a créée ou modifiée, en une transaction. */
export function saveSubmission(order: ClientOrder, submission: QuoteSubmission) {
  const email = order.contact.email;
  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO orders (reference, email, revision, status, internal_status, created_at, updated_at, data)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(reference) DO UPDATE SET
        revision = excluded.revision, status = excluded.status, internal_status = excluded.internal_status,
        updated_at = excluded.updated_at, data = excluded.data
    `).run(order.reference, email, order.revision, order.status, order.revision > 1 ? 'en_etude' : 'a_verifier', order.createdAt, order.updatedAt, JSON.stringify(order));
    db.prepare('INSERT INTO submissions (reference, revision, created_at, payload) VALUES (?, ?, ?, ?)')
      .run(order.reference, order.revision, order.updatedAt, JSON.stringify(submission));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function updateOrder(order: ClientOrder, internalStatus: string, note: string | undefined, source: string) {
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE orders SET status = ?, internal_status = ?, updated_at = ?, data = ? WHERE reference = ?')
      .run(order.status, internalStatus, order.updatedAt, JSON.stringify(order), order.reference);
    db.prepare('INSERT INTO internal_log (reference, at, internal_status, note, source) VALUES (?, ?, ?, ?, ?)')
      .run(order.reference, now(), internalStatus, note ?? null, source);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// --- Back-office ------------------------------------------------------------------------------

export interface AdminOrder extends ClientOrder {
  email: string;
  internalStatus: string;
}

export function listAllOrders(): AdminOrder[] {
  const rows = db.prepare('SELECT data, internal_status, email FROM orders ORDER BY updated_at DESC').all() as { data: string; internal_status: string; email: string }[];
  return rows.map((r) => ({ ...(JSON.parse(r.data) as ClientOrder), internalStatus: r.internal_status, email: r.email }));
}

export function listClients() {
  return db.prepare(`
    SELECT c.email, c.company, c.name, c.phone, c.address, c.zip, c.city, c.created_at AS createdAt,
           COUNT(o.reference) AS orders, MAX(o.updated_at) AS lastOrderAt
    FROM clients c LEFT JOIN orders o ON o.email = c.email
    GROUP BY c.email ORDER BY COALESCE(MAX(o.updated_at), c.created_at) DESC
  `).all() as unknown as (ClientContact & { createdAt: string; orders: number; lastOrderAt: string | null })[];
}

/** Toutes les demandes envoyées pour une pièce (la plus récente d'abord) et le journal interne. */
export function orderTrail(reference: string) {
  const submissions = (db.prepare('SELECT revision, created_at, payload FROM submissions WHERE reference = ? ORDER BY id DESC').all(reference) as { revision: number; created_at: string; payload: string }[])
    .map((r) => ({ ...(JSON.parse(r.payload) as QuoteSubmission), revision: r.revision }));
  const log = db.prepare('SELECT at, internal_status AS internalStatus, note, source FROM internal_log WHERE reference = ? ORDER BY id DESC').all(reference) as { at: string; internalStatus: string | null; note: string | null; source: string }[];
  return { submissions, log };
}

// --- Connexion ---------------------------------------------------------------------------------

export function saveLoginToken(hash: string, email: string, expiresAt: Date) {
  db.prepare('INSERT INTO login_tokens (hash, email, expires_at) VALUES (?, ?, ?)').run(hash, email, expiresAt.toISOString());
}

/** Consomme un lien de connexion : valable une seule fois, avant expiration. Renvoie l'e-mail. */
export function consumeLoginToken(hash: string): string | null {
  const r = db.prepare('SELECT email, expires_at, used_at FROM login_tokens WHERE hash = ?').get(hash) as { email: string; expires_at: string; used_at: string | null } | undefined;
  if (!r || r.used_at || r.expires_at < now()) return null;
  db.prepare('UPDATE login_tokens SET used_at = ? WHERE hash = ?').run(now(), hash);
  return r.email;
}

export function createSession(hash: string, email: string, expiresAt: Date) {
  db.prepare('INSERT INTO sessions (hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)').run(hash, email, now(), expiresAt.toISOString());
}

export function sessionEmail(hash: string): string | null {
  const r = db.prepare('SELECT email, expires_at FROM sessions WHERE hash = ?').get(hash) as { email: string; expires_at: string } | undefined;
  return r && r.expires_at > now() ? r.email : null;
}

export function deleteSession(hash: string) {
  db.prepare('DELETE FROM sessions WHERE hash = ?').run(hash);
}

/** Ménage : liens et sessions expirés. */
export function purgeExpired() {
  db.prepare('DELETE FROM login_tokens WHERE expires_at < ?').run(now());
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
}
