// Anti-robots de l'assistant IA : Cloudflare Turnstile (gratuit, sans cookie publicitaire, souvent invisible).
// Actif seulement si TURNSTILE_SECRET_KEY et TURNSTILE_SITE_KEY sont définies (Vercel ou server/.env).
// Le jeton Turnstile ne sert qu'une fois : après vérification, on remet au navigateur un laissez-passer signé
// (HMAC, 2 h) pour que le client n'ait pas un défi à chaque message.
import { createHmac, timingSafeEqual } from 'node:crypto';

const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
/** Clé publique du widget, transmise à la page par /api/health (pas besoin de reconstruire le site). */
export const captchaSiteKey = secret ? process.env.TURNSTILE_SITE_KEY?.trim() || undefined : undefined;
export const captchaEnabled = !!(secret && captchaSiteKey);

const PASS_MS = 2 * 60 * 60_000;
const sign = (exp: number) => createHmac('sha256', secret!).update(`laissez-passer:${exp}`).digest('base64url');

function validPass(pass: string | null): boolean {
  if (!pass) return false;
  const [e, sig] = pass.split('.');
  const exp = Number(e);
  if (!Number.isFinite(exp) || exp < Date.now() || !sig) return false;
  const want = Buffer.from(sign(exp));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

async function verifyToken(token: string, ip: string): Promise<boolean> {
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret: secret!, response: token.slice(0, 2048), ...(ip !== '?' ? { remoteip: ip } : {}) }),
    });
    const out = (await r.json()) as { success?: boolean };
    return out.success === true;
  } catch {
    return false;
  }
}

/**
 * Le demandeur est-il passé par le captcha ? `pass` : nouveau laissez-passer à renvoyer au navigateur.
 * En-têtes lus : `x-captcha-pass` (laissez-passer) ou `x-captcha-token` (jeton Turnstile frais).
 */
export async function checkHuman(headers: Headers, ip: string): Promise<{ ok: boolean; pass?: string }> {
  if (!captchaEnabled) return { ok: true };
  if (validPass(headers.get('x-captcha-pass'))) return { ok: true };
  const token = headers.get('x-captcha-token');
  if (!token || !(await verifyToken(token, ip))) return { ok: false };
  const exp = Date.now() + PASS_MS;
  return { ok: true, pass: `${exp}.${sign(exp)}` };
}
