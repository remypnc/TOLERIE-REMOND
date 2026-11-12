import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import { createHmac, timingSafeEqual } from "node:crypto";
// server/ai.ts
const aiEnabled = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const MODEL = process.env.ASSISTANT_MODEL?.trim() || "claude-opus-5-5";
const HAIKU = MODEL.includes("haiku");
const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
const client = aiEnabled ? new Anthropic(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}) : null;
/** Réponse attendue : tous les champs sont présents, `null` = inchangé. */
const AiTurn = z.object({
	reply: z.string().describe("Réponse au client, en français, courte et concrète ; finit par la question suivante utile."),
	choices: z.array(z.string()).describe("0 à 5 réponses rapides que le client peut toucher (textes courts)."),
	target: z.enum([
		"keep",
		"simple",
		"product",
		"custom"
	]).describe("keep = rien à changer ; simple = pièce de tôle simple ; product = produit du catalogue ; custom = objet hors catalogue que tu dessines panneau par panneau."),
	simple: z.object({
		shape: z.enum([
			"plaque",
			"corniere",
			"u",
			"caisson"
		]).nullable(),
		width: z.number().nullable(),
		depth: z.number().nullable(),
		flangeHeight: z.number().nullable(),
		flangeAngle: z.number().nullable(),
		holeCount: z.number().nullable(),
		holeDiameter: z.number().nullable()
	}).describe("Pièce simple : seulement ce qui change, sinon null."),
	product: z.object({
		kind: z.string().nullable().describe("Clé du produit dans le catalogue (ex. \"locker\"), null = produit en cours."),
		width: z.number().nullable(),
		height: z.number().nullable(),
		depth: z.number().nullable(),
		options: z.array(z.object({
			key: z.string(),
			number: z.number().nullable(),
			flag: z.boolean().nullable(),
			choice: z.string().nullable()
		})).describe("Réglages modifiés du produit (clés du catalogue) : number, flag (oui/non) ou choice (valeur d’un réglage à choix)."),
		panelColors: z.array(z.object({
			panel: z.string(),
			ral: z.string()
		})).describe("Couleur d’une partie du produit : mot qui la désigne (ex. \"rideau\", \"porte\", \"toit\") et code RAL à 4 chiffres.")
	}),
	custom: z.object({
		label: z.string(),
		panels: z.array(z.object({
			label: z.string(),
			size: z.array(z.number()).describe("[x, y, z] en mm : la plus petite cote est l’épaisseur de la tôle."),
			at: z.array(z.number()).describe("Centre [x, y, z] en mm : x à droite, y en haut (sol à 0), z vers l’avant."),
			rot: z.array(z.number()).describe("Rotation [x, y, z] en degrés, [0,0,0] si aucune."),
			look: z.enum([
				"tole",
				"bois",
				"verre",
				"noir",
				"galva",
				"interieur",
				"blanc"
			]),
			bends: z.number().describe("Plis de ce panneau (0 si plat).")
		}))
	}).nullable().describe("Objet hors catalogue (target custom) : nom et panneaux qui se touchent bord à bord, posés au sol, sans se traverser."),
	material: z.enum([
		"acier",
		"galva",
		"inox304",
		"inox316",
		"alu5754"
	]).nullable(),
	thickness: z.number().nullable(),
	finish: z.enum([
		"brut",
		"epoxy",
		"galvanisation",
		"brossage",
		"anodisation"
	]).nullable(),
	ral: z.string().nullable(),
	quantity: z.number().nullable(),
	cadProvided: z.boolean().nullable().describe("true si le client a déjà ses fichiers CAO, false s’il n’en a pas."),
	cadDeliver: z.boolean().nullable().describe("true si le client veut recevoir les fichiers CAO."),
	answered: z.array(z.enum([
		"shape",
		"dimensions",
		"material",
		"thickness",
		"flanges",
		"holes",
		"finish",
		"quantity"
	])).describe("Informations que ce message a données ou confirmées.")
});
const SYSTEM = `Tu t'appelles Camille et tu réponds aux clients dans le devis en ligne de Tôlerie Rémond (tôlerie fine près de Dijon : découpe laser, poinçonnage, pliage, soudure, thermolaquage, goujonnage ; acier, inox, galva, alu de 0,5 à 6 mm).
Tu aides un client à décrire une pièce ou un produit en tôle ; la 3D et le prix se mettent à jour avec ta réponse.
- Le CONTEXTE donne l'état actuel de la pièce, le catalogue des produits assemblés (avec leurs réglages et bornes) et ce qui manque encore.
- Chaque message peut tout changer : forme, produit, dimensions (mm), réglages, matière, finition, quantité. Si le client revient en arrière ("finalement…", "plus de…", "pas en coin mais de face"), applique-le en mettant le réglage concerné à la bonne valeur.
- Produit assemblé : target "product", kind = clé exacte du catalogue, options = uniquement les clés listées pour ce produit (number pour les nombres, flag pour les oui/non). Encombrement : largeur × hauteur × profondeur.
- Pièce simple (plaque, cornière, U, caisson) : target "simple". Si rien ne change dans la forme : target "keep".
- Objet hors catalogue (fauteuil particulier, présentoir, sculpture, support…) : target "custom", dessine-le en panneaux de tôle (10 à 80) jointifs, avec des tôles pliées réalistes (épaisseur 1,5 à 3 mm), reposant au sol, sans pièce qui flotte ni qui en traverse une autre.
- Chaque détail se règle : réglages à choix (type de siège, mur où poser l'écran, place du siège…) avec choice = valeur listée ; couleur d'une partie avec panelColors (RAL), de toute la pièce avec finish "epoxy" + ral.
- Ne mets que ce qui change ; le reste à null. N'invente pas de cote que le client n'a pas donnée.
- Réponds en français, en 1 à 3 phrases : ce que tu as compris, puis la question suivante la plus utile parmi ce qui manque. Le prix affiché reste indicatif et sera vérifié par un technicien.`;
/** Historique au format de l'API : commence par le client, rôles alternés (les messages consécutifs sont fusionnés). */
function toMessages(history, context, text) {
	const out = [];
	for (const h of history.slice(-12)) {
		const role = h.role === "user" ? "user" : "assistant";
		if (!out.length && role === "assistant") continue;
		const last = out[out.length - 1];
		if (last && last.role === role) last.content = `${last.content}\n${h.text}`;
		else out.push({
			role,
			content: h.text.slice(0, 4e3)
		});
	}
	const msg = `CONTEXTE (JSON) :\n${context.slice(0, 3e4)}\n\nMESSAGE DU CLIENT :\n${text.slice(0, 4e3)}`;
	const last = out[out.length - 1];
	if (last?.role === "user") last.content = `${last.content}\n\n${msg}`;
	else out.push({
		role: "user",
		content: msg
	});
	return out;
}
var AiRefused = class extends Error {};
async function aiTurn(context, history, text) {
	if (!client) throw new Error("IA non configurée");
	const res = await client.beta.messages.parse({
		model: MODEL,
		max_tokens: 4e3,
		...HAIKU ? {} : {
			betas: ["server-side-fallback-2026-07-01"],
			fallbacks: "default"
		},
		output_config: {
			effort: "low",
			format: betaZodOutputFormat(AiTurn)
		},
		system: [{
			type: "text",
			text: SYSTEM,
			cache_control: { type: "ephemeral" }
		}],
		messages: toMessages(history, context, text)
	});
	if (res.stop_reason === "refusal") throw new AiRefused("Demande déclinée");
	if (!res.parsed_output) throw new Error("Réponse illisible");
	return res.parsed_output;
}
// server/captcha.ts
const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
/** Clé publique du widget, transmise à la page par /api/health (pas besoin de reconstruire le site). */
const captchaSiteKey = secret ? process.env.TURNSTILE_SITE_KEY?.trim() || void 0 : void 0;
const captchaEnabled = !!(secret && captchaSiteKey);
const PASS_MS = 72e5;
const sign = (exp) => createHmac("sha256", secret).update(`laissez-passer:${exp}`).digest("base64url");
function validPass(pass) {
	if (!pass) return false;
	const [e, sig] = pass.split(".");
	const exp = Number(e);
	if (!Number.isFinite(exp) || exp < Date.now() || !sig) return false;
	const want = Buffer.from(sign(exp));
	const got = Buffer.from(sig);
	return want.length === got.length && timingSafeEqual(want, got);
}
async function verifyToken(token, ip) {
	try {
		return (await (await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
			method: "POST",
			body: new URLSearchParams({
				secret,
				response: token.slice(0, 2048),
				...ip !== "?" ? { remoteip: ip } : {}
			})
		})).json()).success === true;
	} catch {
		return false;
	}
}
/**
* Le demandeur est-il passé par le captcha ? `pass` : nouveau laissez-passer à renvoyer au navigateur.
* En-têtes lus : `x-captcha-pass` (laissez-passer) ou `x-captcha-token` (jeton Turnstile frais).
*/
async function checkHuman(headers, ip) {
	if (!captchaEnabled) return { ok: true };
	if (validPass(headers.get("x-captcha-pass"))) return { ok: true };
	const token = headers.get("x-captcha-token");
	if (!token || !await verifyToken(token, ip)) return { ok: false };
	const exp = Date.now() + PASS_MS;
	return {
		ok: true,
		pass: `${exp}.${sign(exp)}`
	};
}
// server/vercel/assistant.ts
/** Limite par adresse IP, par instance (anti-abus simple). */
const hits = /* @__PURE__ */ new Map();
function tooMany(key, max, windowMs) {
	const t = Date.now();
	const list = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
	list.push(t);
	hits.set(key, list);
	return list.length > max;
}
const str = (v, max) => typeof v === "string" && v.trim() ? v.trim().slice(0, max) : void 0;
async function POST(req) {
	if (!aiEnabled) return Response.json({ error: "IA non configurée" }, { status: 503 });
	const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "?";
	if (tooMany(ip, 40, 6e5)) return Response.json({ error: "Trop de demandes, réessayez dans quelques minutes" }, { status: 429 });
	const human = await checkHuman(req.headers, ip);
	if (!human.ok) return Response.json({
		error: "Vérification anti-robot requise",
		captcha: true
	}, { status: 403 });
	const passHeader = human.pass ? { "x-captcha-pass": human.pass } : {};
	let body;
	try {
		body = await req.json();
	} catch {
		return Response.json({ error: "JSON invalide" }, { status: 400 });
	}
	const text = str(body.text, 4e3);
	if (!text) return Response.json({ error: "Message vide" }, { status: 400 });
	const history = Array.isArray(body.history) ? body.history.slice(-12).map((h) => ({
		role: h.role === "user" ? "user" : "assistant",
		text: str(h.text, 4e3) ?? ""
	})).filter((h) => h.text) : [];
	try {
		return Response.json(await aiTurn(str(body.context, 3e4) ?? "{}", history, text), { headers: passHeader });
	} catch (e) {
		if (e instanceof AiRefused) return Response.json({ error: "Demande déclinée" }, { status: 422 });
		console.error("[ia] échec", e);
		return Response.json({ error: "IA indisponible" }, { status: 502 });
	}
}
export { POST };
