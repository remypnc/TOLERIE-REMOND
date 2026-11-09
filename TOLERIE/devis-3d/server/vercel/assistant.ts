// Fonction Vercel (POST /api/assistant) : même assistant IA que le serveur de l'atelier, sans état.
// Construite dans api/assistant.js par `npm run build:api`.
import { AiRefused, aiEnabled, aiTurn } from '../ai.ts';

/** Limite par adresse IP, par instance (anti-abus simple). */
const hits = new Map<string, number[]>();
function tooMany(key: string, max: number, windowMs: number) {
  const t = Date.now();
  const list = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
  list.push(t);
  hits.set(key, list);
  return list.length > max;
}

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

export async function POST(req: Request): Promise<Response> {
  if (!aiEnabled) return Response.json({ error: 'IA non configurée' }, { status: 503 });
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '?';
  if (tooMany(ip, 40, 10 * 60_000)) return Response.json({ error: 'Trop de demandes, réessayez dans quelques minutes' }, { status: 429 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'JSON invalide' }, { status: 400 });
  }
  const text = str(body.text, 4000);
  if (!text) return Response.json({ error: 'Message vide' }, { status: 400 });
  const history = Array.isArray(body.history)
    ? body.history.slice(-12).map((h: { role?: unknown; text?: unknown }) => ({ role: h.role === 'user' ? 'user' : 'assistant', text: str(h.text, 4000) ?? '' })).filter((h) => h.text)
    : [];
  try {
    return Response.json(await aiTurn(str(body.context, 30000) ?? '{}', history, text));
  } catch (e) {
    if (e instanceof AiRefused) return Response.json({ error: 'Demande déclinée' }, { status: 422 });
    console.error('[ia] échec', e);
    return Response.json({ error: 'IA indisponible' }, { status: 502 });
  }
}
