import {
	createEmailCampaign,
	finishEmailCampaign,
	getEmailList,
	getLastEmailCampaignForList,
	getLastEmailCampaignForStage,
	insertEmailCampaignRecipients,
} from "@psi-opora/db/queries";
import { enqueueEmailCampaign } from "@psi-opora/jobs";
import {
	buildEmailReport,
	collectEmailRecipients,
	collectListRecipients,
	type EmailRecipient,
} from "../../email-campaign-collect";
import { bitrixProcedure } from "../../orpc";
import { publicOriginFromHeaders } from "../../public-origin";
import { sendEmailCampaignSchema } from "../../schemas/broadcast";
import { getActiveEmailSender } from "./active-sender";
import type { EmailCampaignActionResult } from "./types";

export const send = bitrixProcedure
	.input(sendEmailCampaignSchema)
	.handler(async ({ input, context }): Promise<EmailCampaignActionResult> => {
		if (!input.templateId) return { error: "Не выбран шаблон" };
		const subject = input.subject.trim();
		if (!subject) return { error: "Не задана тема письма" };

		const sender = await getActiveEmailSender();
		if ("error" in sender) return { error: sender.error };

		try {
			let collected: { totalDeals: number; recipients: EmailRecipient[] };
			let audienceLabel: { stageName?: string; listName?: string } = {};
			if (input.audience === "list") {
				if (!input.listId) return { error: "Не выбран список контактов" };
				const list = await getEmailList(input.listId);
				if (!list) return { error: "Список контактов не найден" };
				collected = await collectListRecipients(list.id);
				audienceLabel = { listName: list.name };
			} else {
				if (!input.stageId) return { error: "Не выбрана стадия" };
				const api = await context.getBitrixApi();
				if (!api) return { error: "Bitrix24 не подключён" };
				collected = await collectEmailRecipients(api, input.stageId);
				audienceLabel = { stageName: input.stageName };
			}
			const { totalDeals, recipients } = collected;

			if (input.dryRun) {
				const recent = await (input.audience === "list"
					? getLastEmailCampaignForList(input.listId as string)
					: getLastEmailCampaignForStage(input.stageId as string)
				).catch(() => null);
				return {
					report: buildEmailReport(
						input.audience,
						totalDeals,
						recipients,
						true,
					),
					recentCampaign: recent
						? {
								startedAt: recent.startedAt,
								recipientsCount: recent.recipientsCount,
							}
						: null,
				};
			}

			if (input.expectedRecipients === undefined) {
				return {
					error:
						"Отправка без предпросмотра запрещена — сначала нажмите «Показать получателей»",
				};
			}
			if (input.expectedRecipients !== recipients.length) {
				return {
					error: `Состав получателей изменился с момента предпросмотра (было ${input.expectedRecipients}, стало ${recipients.length}). Обновите предпросмотр и проверьте список ещё раз.`,
				};
			}

			const selectedKeys = input.selectedKeys?.length
				? new Set(input.selectedKeys)
				: null;
			const targetRecipients = selectedKeys
				? recipients.filter((r) => selectedKeys.has(r.key))
				: recipients;

			const pendingCount = targetRecipients.filter(
				(r) => r.status === "pending",
			).length;
			if (pendingCount === 0) {
				return { error: "Среди получателей некому отправлять" };
			}

			const campaignId = crypto.randomUUID();
			await createEmailCampaign({
				id: campaignId,
				audience: input.audience,
				stageId: input.audience === "crm_stage" ? input.stageId : null,
				stageName: audienceLabel.stageName ?? null,
				listId: input.audience === "list" ? input.listId : null,
				listName: audienceLabel.listName ?? null,
				templateId: input.templateId,
				templateName: input.templateName,
				subject,
				senderEmail: sender.senderEmail,
				senderName: sender.senderName,
				provider: sender.provider,
				publicBaseUrl: publicOriginFromHeaders(context.headers),
				totalDeals,
				recipientsCount: pendingCount,
			});
			await insertEmailCampaignRecipients(
				targetRecipients.map((r) => ({
					id: crypto.randomUUID(),
					campaignId,
					contactId: r.contactId,
					contactName: r.contactName || null,
					dealId: r.dealId,
					dealTitle: r.dealTitle,
					email: r.email,
					status: r.status === "pending" ? "pending" : "skipped",
					error: r.error ?? null,
				})),
			);

			try {
				await enqueueEmailCampaign({ campaignId });
			} catch (err) {
				await finishEmailCampaign(campaignId, {
					status: "error",
					error: `Не удалось запустить фоновую задачу: ${(err as Error).message}`,
				});
				return {
					error: `Рассылка не запущена: ${(err as Error).message}. Проверьте подключение Hatchet (HATCHET_CLIENT_TOKEN).`,
				};
			}

			return { queuedCampaignId: campaignId, queuedCount: pendingCount };
		} catch (err) {
			return { error: (err as Error).message };
		}
	});
