import {
	ConcurrencyLimitStrategy,
	CreateTaskWorkflow,
} from "@hatchet-dev/typescript-sdk/v1";
import { sleep } from "../messenger";
import {
	jitteredDelayMs,
	type MessengerChannel,
	type OutreachSender,
	personalizeMessage,
	runCascade,
} from "../outreach/cascade";
import {
	createMaxSender,
	createTelegramSender,
	createWhatsappSender,
} from "../outreach/senders";
import { getHatchetClient } from "./client";
import { deliverEmailCampaign } from "./email-campaign";

export type DeliverOutreachPayload = {
	campaignId: string;
};

/**
 * Сколько задача работает до передачи эстафеты следующему запуску. Паузы
 * между сообщениями личных номеров — десятки секунд, список в тысячу
 * контактов идёт часами; вместо одного многочасового запуска задача
 * перезапускает сама себя (обрабатываются только pending — продолжение,
 * а не повтор).
 */
const RUN_BUDGET_MS = 50 * 60 * 1000;
const BATCH_SIZE = 100;

/** Журнал bot_messages: под этими messenger лежат диалоги личных номеров. */
const JOURNAL_MESSENGER: Record<MessengerChannel, string> = {
	max: "max-personal",
	telegram: "telegram-personal",
	whatsapp: "whatsapp-personal",
};

/**
 * Рассылка по списку контактов через личные номера: каждому получателю
 * сообщение пробуется по приоритету MAX → Telegram → WhatsApp (см.
 * outreach/cascade.ts), а тех, до кого не дошло ни одно, в конце передаём
 * в обычную email-кампанию — так письма получают отписку, стоп-лист и
 * статистику открытий/доставки email-рассылок.
 */
export const deliverOutreach = CreateTaskWorkflow({
	name: "outreach-deliver",
	retries: 0,
	executionTimeout: "1h",
	scheduleTimeout: "24h",
	// Одна рассылка за раз: личные номера общие для всех рассылок, параллельные
	// запуски удвоили бы темп и риск бана номера.
	concurrency: {
		expression: "'outreach-deliver'",
		maxRuns: 1,
		limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
	},
	fn: async (payload: DeliverOutreachPayload) => {
		// Ленивый импорт — см. комментарий в hatchet/broadcast.ts.
		const {
			finishOutreachCampaign,
			getOutreachCampaign,
			insertBotMessage,
			listOutreachRecipientsByStatus,
			markInterruptedOutreachRecipients,
			markOutreachCampaignRunning,
			updateOutreachRecipient,
		} = await import("@psi-opora/db/queries");

		const campaign = await getOutreachCampaign(payload.campaignId);
		if (!campaign) {
			throw new Error(`Рассылка ${payload.campaignId} не найдена`);
		}
		if (campaign.status !== "queued" && campaign.status !== "running") {
			return { skipped: campaign.status };
		}

		const startedAt = Date.now();
		await markOutreachCampaignRunning(campaign.id);
		await markInterruptedOutreachRecipients(campaign.id);

		const senders: OutreachSender[] = [];
		const { accounts, memberId } = campaign;
		if (accounts.max)
			senders.push(createMaxSender({ memberId, ...accounts.max }));
		if (accounts.telegram)
			senders.push(createTelegramSender({ memberId, ...accounts.telegram }));
		if (accounts.whatsapp)
			senders.push(createWhatsappSender({ memberId, ...accounts.whatsapp }));
		const emailEnabled = Boolean(campaign.emailTemplateId);
		const disabled = new Set<MessengerChannel>();

		const isCancelled = async () =>
			(await getOutreachCampaign(campaign.id))?.status === "cancelled";

		try {
			let processed = 0;
			for (;;) {
				const batch = await listOutreachRecipientsByStatus(
					campaign.id,
					"pending",
					BATCH_SIZE,
				);
				if (batch.length === 0) break;

				for (const recipient of batch) {
					if (Date.now() - startedAt > RUN_BUDGET_MS) {
						await getHatchetClient().runNoWait(deliverOutreach, payload);
						return { processed, continued: true };
					}
					if (await isCancelled()) return { processed, cancelled: true };

					await updateOutreachRecipient(recipient.id, { status: "sending" });
					const text = personalizeMessage(campaign.message, recipient.name);
					const result = await runCascade({
						phone: recipient.phone,
						email: recipient.email,
						text,
						senders,
						disabled,
						emailEnabled,
					});

					if (result.status === "sent") {
						await updateOutreachRecipient(recipient.id, {
							status: "sent",
							channel: result.channel,
							attempts: result.attempts,
							externalId: result.externalId ?? null,
							error: null,
							sentAt: new Date(),
						});
						// Журнал сообщений — рассылка видна в истории диалога в инбоксе.
						const account = accounts[result.channel];
						await insertBotMessage({
							messenger: JOURNAL_MESSENGER[result.channel],
							userId: result.userId,
							direction: "out",
							source: "broadcast",
							text,
							status: "sent",
							externalId: result.externalId,
							connectorId: account?.connectorId,
						}).catch((err: unknown) => {
							console.error(
								`[outreach] не удалось записать сообщение в журнал: ${(err as Error).message}`,
							);
						});
					} else if (result.status === "email_pending") {
						await updateOutreachRecipient(recipient.id, {
							status: "email_pending",
							attempts: result.attempts,
							error: null,
						});
					} else {
						await updateOutreachRecipient(recipient.id, {
							status: result.status,
							attempts: result.attempts,
							error: result.error,
						});
					}
					processed++;

					// Пауза только после реальной попытки в мессенджер — контакты
					// без телефона уходят в email без задержки.
					if (result.attempts.length > 0) {
						await sleep(jitteredDelayMs(campaign.intervalSec));
					}
				}
			}

			if (await isCancelled()) return { processed, cancelled: true };
			const emailed = emailEnabled ? await startEmailFallback(campaign.id) : 0;

			await finishOutreachCampaign(campaign.id, { status: "done" });
			return { processed, emailed };
		} catch (err) {
			await finishOutreachCampaign(campaign.id, {
				status: "error",
				error: (err as Error).message,
			});
			throw err;
		}
	},
});

/**
 * Email-фаза: всех email_pending отдаём одной email-кампанией (шаблон и
 * тема — из настроек рассылки). Получатель рассылки связывается со строкой
 * email-кампании — по ней в отчёте виден статус письма (доставлено, открыто,
 * отписался), а ссылка отписки в письме работает как в обычной рассылке.
 */
async function startEmailFallback(campaignId: string): Promise<number> {
	const {
		createEmailCampaign,
		finishEmailCampaign,
		getOutreachCampaign,
		insertEmailCampaignRecipients,
		listOutreachRecipientsByStatus,
		setOutreachEmailCampaign,
		updateOutreachRecipient,
	} = await import("@psi-opora/db/queries");

	const campaign = await getOutreachCampaign(campaignId);
	if (!campaign?.emailTemplateId || !campaign.emailSubject) return 0;
	if (!campaign.emailSenderEmail || !campaign.emailProvider) {
		throw new Error("Не задан отправитель писем — проверьте /settings/email");
	}

	const pending: Array<{
		outreachId: string;
		name: string | null;
		email: string;
	}> = [];
	for (const r of await listOutreachRecipientsByStatus(
		campaignId,
		"email_pending",
		100_000,
	)) {
		if (r.email)
			pending.push({ outreachId: r.id, name: r.name, email: r.email });
	}
	if (pending.length === 0) return 0;

	const emailCampaignId = crypto.randomUUID();
	await createEmailCampaign({
		id: emailCampaignId,
		audience: "list",
		listId: campaign.listId,
		listName: campaign.listName
			? `${campaign.listName} (не дошло в мессенджеры)`
			: "Рассылка по списку: не дошло в мессенджеры",
		templateId: campaign.emailTemplateId,
		templateName: campaign.emailTemplateName ?? undefined,
		subject: campaign.emailSubject,
		senderEmail: campaign.emailSenderEmail,
		senderName: campaign.emailSenderName ?? undefined,
		provider: campaign.emailProvider === "unisender" ? "unisender" : "rusender",
		publicBaseUrl: campaign.publicBaseUrl,
		totalDeals: pending.length,
		recipientsCount: pending.length,
	});

	const rows = pending.map((p) => ({
		...p,
		emailRecipientId: crypto.randomUUID(),
	}));
	await insertEmailCampaignRecipients(
		rows.map((r) => ({
			id: r.emailRecipientId,
			campaignId: emailCampaignId,
			contactName: r.name,
			email: r.email,
			status: "pending",
		})),
	);
	for (const r of rows) {
		await updateOutreachRecipient(r.outreachId, {
			status: "email",
			channel: "email",
			emailRecipientId: r.emailRecipientId,
			sentAt: new Date(),
		});
	}
	await setOutreachEmailCampaign(campaignId, emailCampaignId);

	try {
		await getHatchetClient().runNoWait(deliverEmailCampaign, {
			campaignId: emailCampaignId,
		});
	} catch (err) {
		await finishEmailCampaign(emailCampaignId, {
			status: "error",
			error: `Не удалось запустить фоновую задачу: ${(err as Error).message}`,
		});
		throw err;
	}
	return rows.length;
}
