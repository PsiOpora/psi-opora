import {
	createMarketingCampaign,
	deleteMarketingCampaign,
	isGuideCampaignKeywordTaken,
	listMarketingCampaigns,
	updateMarketingCampaign,
} from "@psi-opora/db/queries";
import { bitrixProcedure, router } from "../orpc";
import {
	createMarketingCampaignSchema,
	marketingCampaignIdSchema,
	updateMarketingCampaignSchema,
} from "../schemas/marketing-campaigns";

/**
 * Слова с собственным сценарием бота (предзаказ книги, запись на консультацию):
 * бот обрабатывает их раньше маркетинговых кампаний, ссылка с таким словом
 * вела бы не в стандартный сценарий.
 */
const RESERVED_CODES = new Set(["TELO", "TELOPAY", "TELOBOOK", "CONSULT"]);

/** Postgres: unique_violation — см. code UNIQUE в marketing_campaigns. */
function isDuplicateCodeError(err: unknown): boolean {
	return (err as { code?: string } | null)?.code === "23505";
}

function uniqueSources(sources: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const source of sources) {
		const key = source.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(source);
	}
	return result;
}

async function assertCodeAvailable(code: string): Promise<void> {
	if (RESERVED_CODES.has(code.toUpperCase())) {
		throw new Error(
			`Слово «${code}» зарезервировано под отдельный сценарий бота — выберите другое`,
		);
	}
	if (await isGuideCampaignKeywordTaken(code)) {
		throw new Error(
			`Слово «${code}» уже занято кампанией по кодовому слову (Сценарий бота) — выберите другое`,
		);
	}
}

export const marketingCampaignsRouter = router({
	/** Маркетинговые кампании: метка в ссылке на бота, сценарий стандартный. */
	list: bitrixProcedure.handler(async () => {
		return listMarketingCampaigns();
	}),

	create: bitrixProcedure
		.input(createMarketingCampaignSchema)
		.handler(async ({ input }) => {
			await assertCodeAvailable(input.code);
			try {
				await createMarketingCampaign({
					id: crypto.randomUUID(),
					code: input.code,
					title: input.title,
					sources: uniqueSources(input.sources),
					active: input.active ?? true,
				});
			} catch (err) {
				if (isDuplicateCodeError(err)) {
					throw new Error(
						`Кодовое слово «${input.code}» уже занято другой кампанией`,
					);
				}
				throw err;
			}
			return { ok: true };
		}),

	update: bitrixProcedure
		.input(updateMarketingCampaignSchema)
		.handler(async ({ input }) => {
			const { id, sources, ...patch } = input;
			if (patch.code) await assertCodeAvailable(patch.code);
			try {
				await updateMarketingCampaign(id, {
					...patch,
					...(sources ? { sources: uniqueSources(sources) } : {}),
				});
			} catch (err) {
				if (isDuplicateCodeError(err)) {
					throw new Error(
						`Кодовое слово «${patch.code}» уже занято другой кампанией`,
					);
				}
				throw err;
			}
			return { ok: true };
		}),

	remove: bitrixProcedure
		.input(marketingCampaignIdSchema)
		.handler(async ({ input }) => {
			await deleteMarketingCampaign(input.id);
			return { ok: true };
		}),
});

