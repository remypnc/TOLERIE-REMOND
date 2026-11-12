// Captcha côté page (Cloudflare Turnstile) : chargé seulement si le serveur annonce une clé publique,
// et seulement au moment où l'IA est sollicitée. Le plus souvent invisible ; un défi s'affiche si besoin.
// Le laissez-passer renvoyé par le serveur est gardé le temps de l'onglet.

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      remove: (id: string) => void;
    };
  }
}

const PASS_KEY = 'tr-captcha-pass';
let siteKey: string | null | undefined;
let script: Promise<void> | null = null;

/** Mémorise la clé publique lue dans /api/health (null = captcha désactivé). */
export function setCaptchaSiteKey(key: string | null | undefined) {
  siteKey = key ?? null;
}

export function rememberPass(pass: string | null) {
  try {
    if (pass) sessionStorage.setItem(PASS_KEY, pass);
    else sessionStorage.removeItem(PASS_KEY);
  } catch { /* stockage indisponible : un défi par message, rien de bloquant */ }
}

function storedPass(): string | null {
  try {
    const p = sessionStorage.getItem(PASS_KEY);
    return p && Number(p.split('.')[0]) > Date.now() + 30_000 ? p : null;
  } catch {
    return null;
  }
}

function loadScript(): Promise<void> {
  script ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { script = null; reject(new Error('captcha')); };
    document.head.appendChild(s);
  });
  return script;
}

/** Résout le défi Turnstile et renvoie un jeton frais (usage unique). */
async function freshToken(): Promise<string> {
  await loadScript();
  const ts = window.turnstile;
  if (!ts || !siteKey) throw new Error('captcha');
  const box = document.createElement('div');
  box.setAttribute('aria-live', 'polite');
  Object.assign(box.style, { position: 'fixed', right: '16px', bottom: '16px', zIndex: '100' });
  document.body.appendChild(box);
  let id = '';
  try {
    return await new Promise<string>((resolve, reject) => {
      id = ts.render(box, {
        sitekey: siteKey,
        appearance: 'interaction-only',
        language: 'fr',
        callback: resolve,
        'error-callback': () => reject(new Error('captcha')),
        'timeout-callback': () => reject(new Error('captcha')),
      });
    });
  } finally {
    if (id) ts.remove(id);
    box.remove();
  }
}

/** En-têtes anti-robot à joindre à l'appel de l'IA ({} si le captcha est désactivé). */
export async function captchaHeaders(forceFresh = false): Promise<Record<string, string>> {
  if (!siteKey) return {};
  const pass = forceFresh ? null : storedPass();
  if (pass) return { 'x-captcha-pass': pass };
  return { 'x-captcha-token': await freshToken() };
}
