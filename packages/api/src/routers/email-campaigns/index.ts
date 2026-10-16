import { ORPCError } from "@orpc/server";
import {
	getEmailCampaign,
	getEmailCampaignFunnel,
	getEmailCampaignRecipient,
	listEmailCampaignRecipients,
	listEmailCampaignRecipientsPage,
	listEmailCampaignsWithStats,
	listEmailEventsForRecipient,
} from "@psi-opora/db/queries";
import { bitrixProcedure, router } from "../../orpc";
import {
	emailCampaignIdSchema,
	emailCampaignRecipientsQuerySchema,
	emailRecipientIdSchema,
} from "../../schemas/email-lists";

/** История email-рассылок и статистика доставки по каждому получателю. */
export const emailCampaignsRouter = router({
	list: bitrixProcedure.handler(() => listEmailCampaignsWithStats(50)),

	get: bitrixProcedure
		.input(emailCampaignIdSchema)
		.handler(async ({ input }) => {
			const campaign = await getEmailCampaign(input.id);
			if (!campaign) {
				throw new ORPCError("NOT_FOUND", { message: "Рассылка не найдена" });
			}
			const funnel = await getEmailCampaignFunnel(input.id);
			return { campaign, funnel };
		}),

	recipients: bitrixProcedure
		.input(emailCampaignRecipientsQuerySchema)
		.handler(({ input }) =>
			listEmailCampaignRecipientsPage({
				campaignId: input.id,
				filter: input.filter,
				search: input.search,
				limit: input.pageSize,
				offset: input.page * input.pageSize,
			}),
		),

	/** Хронология событий письма конкретного получателя. */
	recipientEvents: bitrixProcedure
		.input(emailRecipientIdSchema)
		.handler(async ({ input }) => {
			const recipient = await getEmailCampaignRecipient(input.recipientId);
			if (!recipient) {
				throw new ORPCError("NOT_FOUND", { message: "Получатель не найден" });
			}
			const events = await listEmailEventsForRecipient(recipient.id);
			return {
				recipient,
				events: events.map((e) => ({
					id: e.id,
					type: e.type,
					provider: e.provider,
					occurredAt: e.occurredAt,
					details: e.details,
				})),
			};
		}),

	/** Все получатели со статусами — для выгрузки отчёта в CSV. */
	exportRecipients: bitrixProcedure
		.input(emailCampaignIdSchema)
		.handler(async ({ input }) => {
			const rows = await listEmailCampaignRecipients(input.id);
			return rows.map((r) => ({
				email: r.email,
				name: r.contactName,
				deal: r.dealTitle,
				status: r.status,
				error: r.error,
				sentAt: r.sentAt,
				deliveredAt: r.deliveredAt,
				openedAt: r.openedAt,
				clickedAt: r.clickedAt,
				openCount: r.openCount,
				clickCount: r.clickCount,
				bouncedAt: r.bouncedAt,
				complainedAt: r.complainedAt,
				unsubscribedAt: r.unsubscribedAt,
			}));
		}),
});
