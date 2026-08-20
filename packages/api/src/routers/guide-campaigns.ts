import {
	createBotGuideCampaign,
	deleteBotGuideCampaign,
	listBotGuideCampaigns,
	listGuideCampaignStats,
	listGuideViewers,
	updateBotGuideCampaign,
} from "@psi-opora/db/queries";
import { publicProcedure, router } from "../orpc";
import {
	createGuideCampaignSchema,
	guideCampaignIdSchema,
	guideViewersSchema,
	updateGuideCampaignSchema,
} from "../schemas/guide-campaigns";

/** Postgres: unique_violation — см. keyword UNIQUE в bot_guide_campaigns. */
function isDuplicateKeywordError(err: unknown): boolean {
	return (err as { code?: string } | null)?.code === "23505";
}

export const guideCampaignsRouter = router({
	/** Кампании гайдов по кодовому слову (см. bot_guide_campaigns), для /settings/bot. */
	list: publicProcedure.handler(async () => {
		return listBotGuideCampaigns();
	}),

	/**
	 * Счётчики выдач/открытий/напоминаний/заявок по каждой кампании
	 * (bot_guide_deliveries) — показываются в строке кампании, чтобы по
	 * кодовому слову было видно не только настройки, но и результат.
	 */
	stats: publicProcedure.handler(async () => {
		return listGuideCampaignStats();
	}),

	/**
	 * Кто открывал материал по ссылке из чата (bot_guide_views) — с контактами
	 * из снимка выдачи, чтобы из дашборда было видно не только «сколько», но и
	 * «кто именно» дошёл до файла.
	 */
	viewers: publicProcedure
		.input(guideViewersSchema)
		.handler(async ({ input }) => {
			return listGuideViewers({
				...(input.campaignId ? { campaignId: input.campaignId } : {}),
				...(input.limit ? { limit: input.limit } : {}),
			});
		}),

	create: publicProcedure
		.input(createGuideCampaignSchema)
		.handler(async ({ input }) => {
			try {
				await createBotGuideCampaign({
					id: crypto.randomUUID(),
					keyword: input.keyword,
					title: input.title,
					guideId: input.guideId || null,
					welcomeMessage: input.welcomeMessage?.trim() || null,
					emailQuestion: input.emailQuestion,
					emailSubject: input.emailSubject,
					emailBody: input.emailBody,
					deliveryMessage: input.deliveryMessage,
					followUpDelayDays: input.followUpDelayDays,
					followUpMessage: input.followUpMessage,
					...(input.diagnosticCtaText
						? { diagnosticCtaText: input.diagnosticCtaText }
						: {}),
					active: input.active ?? true,
				});
			} catch (err) {
				if (isDuplicateKeywordError(err)) {
					throw new Error(
						`Кодовое слово «${input.keyword}» уже занято другой кампанией`,
					);
				}
				throw err;
			}
			return { ok: true };
		}),

	update: publicProcedure
		.input(updateGuideCampaignSchema)
		.handler(async ({ input }) => {
			const { id, guideId, welcomeMessage, ...patch } = input;
			try {
				await updateBotGuideCampaign(id, {
					...patch,
					...(guideId !== undefined ? { guideId: guideId || null } : {}),
					...(welcomeMessage !== undefined
						? { welcomeMessage: welcomeMessage?.trim() || null }
						: {}),
				});
			} catch (err) {
				if (isDuplicateKeywordError(err)) {
					throw new Error(
						`Кодовое слово «${patch.keyword}» уже занято другой кампанией`,
					);
				}
				throw err;
			}
			return { ok: true };
		}),

	remove: publicProcedure
		.input(guideCampaignIdSchema)
		.handler(async ({ input }) => {
			await deleteBotGuideCampaign(input.id);
			return { ok: true };
		}),
});
