import {
	createBotGuideCampaign,
	deleteBotGuideCampaign,
	listBotGuideCampaigns,
	updateBotGuideCampaign,
} from "@psi-opora/db/queries";
import { publicProcedure, router } from "../orpc";
import {
	createGuideCampaignSchema,
	guideCampaignIdSchema,
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

	create: publicProcedure
		.input(createGuideCampaignSchema)
		.handler(async ({ input }) => {
			try {
				await createBotGuideCampaign({
					id: crypto.randomUUID(),
					keyword: input.keyword,
					title: input.title,
					guideId: input.guideId || null,
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
			const { id, guideId, ...patch } = input;
			try {
				await updateBotGuideCampaign(id, {
					...patch,
					...(guideId !== undefined ? { guideId: guideId || null } : {}),
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
