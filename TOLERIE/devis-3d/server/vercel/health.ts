// Fonction Vercel (GET /api/health) : la page y lit si l'IA est branchée et la clé publique du captcha.
// Construite dans api/health.js.
import { aiEnabled } from '../ai.ts';
import { captchaSiteKey } from '../captcha.ts';

export function GET(): Response {
  return Response.json({ ok: true, mail: 'none', ai: aiEnabled, captcha: captchaSiteKey ?? null });
}
