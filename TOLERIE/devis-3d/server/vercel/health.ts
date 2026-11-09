// Fonction Vercel (GET /api/health) : la page y lit si l'IA est branchée. Construite dans api/health.js.
import { aiEnabled } from '../ai.ts';

export function GET(): Response {
  return Response.json({ ok: true, mail: 'none', ai: aiEnabled });
}
