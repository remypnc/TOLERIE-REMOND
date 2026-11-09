// E-mails : envoi réel par SMTP si configuré, sinon « boîte d'envoi » locale (server/data/outbox),
// consultable en développement sur /api/dev/outbox. `send` ne renvoie true que pour un envoi réel.
import nodemailer from 'nodemailer';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { ClientOrder } from '../src/lib/orders.ts';
import { STATUS_LABEL } from '../src/lib/orders.ts';
import { config } from './config.ts';

const transport = config.smtp ? nodemailer.createTransport(config.smtp) : null;
// Vérifie la connexion au démarrage : un mot de passe refusé se voit tout de suite dans les journaux.
transport?.verify().then(
  () => console.log(`[mail] SMTP connecté (${config.smtp!.host}) : les e-mails partent réellement`),
  (e: Error) => console.error(`[mail] SMTP refusé (${config.smtp!.host}) : ${e.message}`),
);

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function send(mail: Mail): Promise<boolean> {
  if (!transport) {
    mkdirSync(config.outboxDir, { recursive: true });
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    writeFileSync(`${config.outboxDir}/${id}.json`, JSON.stringify({ ...mail, at: new Date().toISOString() }));
    console.log(`[mail] (non envoyé, pas de SMTP) → ${mail.to} : ${mail.subject}`);
    return false;
  }
  try {
    await transport.sendMail({ from: config.mailFrom, ...mail });
    return true;
  } catch (e) {
    console.error(`[mail] échec d'envoi à ${mail.to}`, e);
    return false;
  }
}

/** Développement : derniers e-mails de la boîte d'envoi locale. */
export function outbox(limit = 30): (Mail & { at: string })[] {
  try {
    return readdirSync(config.outboxDir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, limit)
      .map((f) => JSON.parse(readFileSync(`${config.outboxDir}/${f}`, 'utf8')) as Mail & { at: string });
  } catch {
    return [];
  }
}

// --- Modèles ------------------------------------------------------------------------------------

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const eur = (n: number) => n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) : '—');

function layout(title: string, body: string, cta?: { label: string; url: string }) {
  const button = cta
    ? `<p style="margin:28px 0"><a href="${esc(cta.url)}" style="display:inline-block;padding:14px 26px;border-radius:999px;background:#00a2a3;color:#fff;font-weight:600;text-decoration:none">${esc(cta.label)}</a></p>`
    : '';
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f5f6f8;font-family:Roboto,Arial,sans-serif;color:#1d2433">
<div style="max-width:560px;margin:0 auto;padding:32px 20px">
  <p style="margin:0 0 20px;font-weight:700;color:#112d63;letter-spacing:.04em">TÔLERIE RÉMOND</p>
  <div style="background:#fff;border-radius:18px;padding:28px">
    <h1 style="margin:0 0 16px;font-size:22px;color:#112d63">${esc(title)}</h1>
    ${body}${button}
  </div>
  <p style="margin:18px 4px 0;font-size:12px;color:#5b6475">Cet e-mail vous est envoyé suite à votre demande sur tolerie-remond.com.</p>
</div></body></html>`;
}

function recap(o: ClientOrder) {
  return `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:8px 0">
  <tr><td style="padding:6px 0;color:#5b6475">Référence</td><td style="text-align:right"><b>${esc(o.reference)}</b>${o.revision > 1 ? ` · version ${o.revision}` : ''}</td></tr>
  <tr><td style="padding:6px 0;color:#5b6475">Pièce</td><td style="text-align:right">${esc(o.spec.name)}</td></tr>
  <tr><td style="padding:6px 0;color:#5b6475">Quantité</td><td style="text-align:right">${o.price.quantity} pc</td></tr>
  <tr><td style="padding:6px 0;color:#5b6475">${o.price.final ? 'Prix' : 'Estimation'}</td><td style="text-align:right">${eur(o.price.subtotal)} HT</td></tr>
  <tr><td style="padding:6px 0;color:#5b6475">Livraison estimée</td><td style="text-align:right">${day(o.deliveryDate)}</td></tr>
</table>`;
}

export function confirmationMail(o: ClientOrder, trackUrl: string): Mail {
  const modified = o.revision > 1;
  const title = modified ? 'Modification bien reçue' : 'Votre demande de devis est bien reçue';
  return {
    to: o.contact.email,
    subject: `${modified ? 'Modification reçue' : 'Demande reçue'} · ${o.reference}`,
    html: layout(
      title,
      `<p>Bonjour${o.contact.name ? ` ${esc(o.contact.name)}` : ''},</p>
<p>Un technicien vérifie les cotes, la faisabilité et le prix, puis vous envoie le devis définitif sous 48 h ouvrées.</p>
${recap(o)}
<p style="font-size:13px;color:#5b6475">Le prix affiché en ligne est une estimation : seul le devis définitif fait foi.</p>`,
      { label: 'Suivre ma pièce', url: trackUrl },
    ),
    text: `${title}\n\nRéférence ${o.reference}. Un technicien vous envoie le devis définitif sous 48 h ouvrées.\nSuivre ma pièce : ${trackUrl}`,
  };
}

export function loginMail(email: string, url: string): Mail {
  return {
    to: email,
    subject: 'Votre lien de connexion · Tôlerie Rémond',
    html: layout(
      'Accéder à mes pièces',
      `<p>Cliquez sur le bouton pour retrouver vos pièces et leur suivi. Ce lien est valable ${config.loginLinkMinutes} minutes et ne sert qu’une fois.</p>
<p style="font-size:13px;color:#5b6475">Vous n’avez rien demandé ? Ignorez simplement cet e-mail.</p>`,
      { label: 'Voir mes pièces', url },
    ),
    text: `Votre lien de connexion (valable ${config.loginLinkMinutes} min) : ${url}`,
  };
}

/** Ce que chaque étape veut dire pour le client, en une phrase. */
function statusIntro(o: ClientOrder): string {
  switch (o.status) {
    case 'verification': return 'Bonne nouvelle : un technicien a bien regardé votre demande. Il vérifie les cotes, la faisabilité et le prix.';
    case 'devis_envoye': return `Votre devis définitif est prêt : ${eur(o.price.subtotal)} HT pour ${o.price.quantity} pièce${o.price.quantity > 1 ? 's' : ''}. Validez-le pour lancer la fabrication.`;
    case 'validee': return `Votre commande est confirmée et la fabrication est planifiée. Expédition prévue le ${day(o.shipDate)}.`;
    case 'fabrication': return `Votre pièce est en cours de fabrication à l’atelier. Expédition prévue le ${day(o.shipDate)}.`;
    case 'expediee': return `Votre colis est en route${o.tracking ? ` avec ${esc(o.tracking.carrier)}${o.tracking.number ? ` (n° ${esc(o.tracking.number)})` : ''}` : ''}. Livraison estimée le ${day(o.deliveryDate)}.`;
    case 'livree': return 'Votre pièce a été livrée. Merci de votre confiance, à bientôt pour une prochaine pièce.';
    case 'annulee': return 'Votre demande a été annulée. Contactez-nous si c’est une erreur.';
    default: return 'Votre demande est bien enregistrée.';
  }
}

/** E-mail de suivi : nouvelle étape, ou simple message de l'atelier (`note`). */
export function statusMail(o: ClientOrder, trackUrl: string, note?: string): Mail {
  const label = STATUS_LABEL[o.status];
  const intro = statusIntro(o);
  return {
    to: o.contact.email,
    subject: `${label} · ${o.spec.name} · ${o.reference}`,
    html: layout(
      `${esc(o.spec.name)} : ${label.toLowerCase()}`,
      `<p>Bonjour${o.contact.name ? ` ${esc(o.contact.name)}` : ''},</p><p>${intro}</p>
${note ? `<p style="padding:12px 14px;border-left:3px solid #00a2a3;background:#f2fafa">${esc(note)}</p>` : ''}${recap(o)}`,
      { label: 'Voir le suivi', url: trackUrl },
    ),
    text: `${o.reference} : ${label}.\n${intro.replace(/<[^>]+>/g, '')}${note ? `\n${note}` : ''}\nSuivi : ${trackUrl}`,
  };
}

export function workshopMail(o: ClientOrder, message?: string): Mail {
  const c = o.contact;
  const where = c.pickup ? 'Retrait à l’atelier' : [c.address, [c.zip, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const who = [c.company, c.name, c.email, c.phone, where && `Livraison : ${where}`].filter(Boolean).map((x) => esc(String(x))).join(' · ');
  return {
    to: config.workshopEmail!,
    subject: `[Devis en ligne] ${o.revision > 1 ? `Modification v${o.revision}` : 'Nouvelle demande'} ${o.reference} · ${c.company ?? c.email}`,
    html: layout(
      `${o.revision > 1 ? 'Modification' : 'Nouvelle demande'} ${o.reference}`,
      `<p>${who}</p>${recap(o)}
${message ? `<p><b>Message du client :</b><br>${esc(message)}</p>` : ''}
${o.missing.length ? `<p style="color:#b26b00"><b>À confirmer :</b> ${esc(o.missing.join(', '))}</p>` : ''}`,
    ),
    text: `${o.reference} · ${who}${message ? `\nMessage : ${message}` : ''}`,
  };
}
