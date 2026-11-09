import Anthropic from "@anthropic-ai/sdk";
import "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
// server/ai.ts
const aiEnabled = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
process.env.ASSISTANT_MODEL;
const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
aiEnabled && new Anthropic(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {});
z.object({
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
// server/vercel/health.ts
function GET() {
	return Response.json({
		ok: true,
		mail: "none",
		ai: aiEnabled
	});
}
export { GET };
