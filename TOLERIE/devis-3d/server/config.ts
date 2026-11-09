// Réglages du serveur, lus dans les variables d'environnement (fichier server/.env en local).
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const env = process.env;

export const config = {
  port: Number(env.PORT ?? 8787),
  /** Adresse publique de la page devis : base des liens envoyés par e-mail. */
  appUrl: (env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  production: env.NODE_ENV === 'production',
  dbPath: env.DB_PATH ?? `${here}data/atelier.sqlite`,
  outboxDir: `${here}data/outbox`,
  /** Expéditeur des e-mails. */
  mailFrom: env.MAIL_FROM ?? 'Tôlerie Rémond <devis@tolerie-remond.com>',
  /** Boîte de l'atelier qui reçoit une alerte à chaque demande. */
  workshopEmail: env.WORKSHOP_EMAIL,
  // SMTP actif seulement s'il est complet : un mot de passe encore vide laisse le mode test.
  smtp: env.SMTP_HOST && (!env.SMTP_USER || env.SMTP_PASS)
    ? {
        host: env.SMTP_HOST,
        port: Number(env.SMTP_PORT ?? 587),
        secure: env.SMTP_SECURE === 'true',
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } : undefined,
      }
    : null,
  /** Jeton du back-office / de l'ERP pour mettre à jour les statuts (en-tête Authorization: Bearer …). */
  adminToken: env.ADMIN_TOKEN,
  /** Comptes de l'atelier (séparés par des virgules) : édition complète et back-office une fois connectés. */
  adminEmails: (env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
  loginLinkMinutes: 30,
  /** Lien « Suivre ma pièce » de l'e-mail de confirmation. */
  confirmLinkDays: 7,
  sessionDays: 30,
};

/**
 * Test sans SMTP (hors production) : le lien de connexion est aussi renvoyé à la page, qui propose de
 * l'ouvrir directement. Ainsi on peut tester tout le parcours sans boîte mail.
 */
export const devLinks = !config.production && !config.smtp;
