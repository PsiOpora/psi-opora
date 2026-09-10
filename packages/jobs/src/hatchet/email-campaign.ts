import {
	ConcurrencyLimitStrategy,
	CreateTaskWorkflow,
} from "@hatchet-dev/typescript-sdk/v1";

export type DeliverEmailCampaignPayload = {
	campaignId: string;
};

// Ограничение размера пачки importContacts — держим запросы небольшими,
// чтобы не упереться в лимит тела запроса Unisender (32 МБ) на крупных стадиях.
const IMPORT_BATCH_SIZE = 500;

/**
 * Фоновая задача: создаёт одноразовый список в Unisender, импортирует в него
 * получателей, создаёт письмо из выбранного шаблона и запускает кампанию.
 * Дальнейший статус (доставлено/открыто/отписалось) обновляет pollEmailCampaigns.
 */
export const deliverEmailCampaign = CreateTaskWorkflow({
	name: "email-campaign-deliver",
	retries: 0,
	executionTimeout: "30m",
	scheduleTimeout: "24h",
	// Одна кампания за раз — createList/importContacts на Unisender не
	// рассчитаны на параллельные запуски по одному аккаунту.
	concurrency: {
		expression: "'email-campaign-deliver'",
		maxRuns: 1,
		limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
	},
	fn: async (payload: DeliverEmailCampaignPayload) => {
		// Ленивый импорт: клиент БД подключается на верхнем уровне модуля
		// (top-level await + проверка POSTGRES_URL), поэтому статический импорт
		// ронял бы индексацию задач при деплое, где БД недоступна.
		const {
			finishEmailCampaign,
			getEmailCampaign,
			getEmailTemplate,
			getRusenderSettings,
			getUnisenderSettings,
			listEmailCampaignRecipients,
			renderEmailTemplate,
			setEmailCampaignUnisenderIds,
			toUnisenderTags,
			updateEmailCampaignRecipient,
		} = await import("@psi-opora/db/queries");
		const { createUnisenderClient } = await import(
			"@psi-opora/unisender-client"
		);
		const { renderCampaignTemplate } = await import("@psi-opora/emails");

		const campaign = await getEmailCampaign(payload.campaignId);
		if (!campaign) {
			throw new Error(`Email-кампания ${payload.campaignId} не найдена`);
		}

		if (campaign.provider === "rusender") {
			// У Rusender нет API списков/кампаний — только поштучная отправка,
			// поэтому рассылка выполняется циклом индивидуальных запросов, а не
			// через createList/createCampaign, как у Unisender ниже.
			const { createRusenderClient } = await import(
				"@psi-opora/rusender-client"
			);
			try {
				const settings = await getRusenderSettings();
				if (!settings?.apiKey || !settings.keyId) {
					throw new Error(
						"Rusender не настроен — укажите API-ключ и key ID на странице /settings/email",
					);
				}
				const template = await getEmailTemplate(campaign.templateId);
				if (!template) {
					throw new Error("Шаблон письма не найден — возможно, был удалён");
				}
				const html = await renderCampaignTemplate(
					template.templateKey,
					template.fields,
				);
				if (!html) {
					throw new Error(`Неизвестный тип шаблона: ${template.templateKey}`);
				}

				const rusenderClient = createRusenderClient(
					settings.apiKey,
					settings.keyId,
				);

				const recipients = (
					await listEmailCampaignRecipients(payload.campaignId)
				).filter(
					(r): r is typeof r & { email: string } =>
						r.status === "pending" && !!r.email,
				);
				if (recipients.length === 0) {
					throw new Error("Среди получателей некому отправлять");
				}

				let sent = 0;
				for (const r of recipients) {
					try {
						await rusenderClient.sendEmail({
							email: r.email,
							senderName: campaign.senderName ?? settings.senderName ?? "",
							senderEmail: campaign.senderEmail,
							subject: campaign.subject,
							body: renderEmailTemplate(html, {
								name: r.contactName,
								email: r.email,
							}),
						});
						await updateEmailCampaignRecipient(r.id, {
							status: "sent",
							error: null,
						});
						sent++;
					} catch (err) {
						await updateEmailCampaignRecipient(r.id, {
							status: "error",
							error: (err as Error).message,
						});
					}
				}

				if (sent === 0) {
					throw new Error("Ни одно письмо не удалось отправить через Rusender");
				}

				await finishEmailCampaign(campaign.id, {
					status: "done",
					sentCount: sent,
				});

				return { imported: sent, campaignId: null };
			} catch (err) {
				await finishEmailCampaign(campaign.id, {
					status: "error",
					error: (err as Error).message,
				});
				throw err;
			}
		}

		try {
			const settings = await getUnisenderSettings();
			if (!settings?.apiKey) {
				throw new Error(
					"Unisender не настроен — укажите API-ключ на странице /settings/email",
				);
			}
			const template = await getEmailTemplate(campaign.templateId);
			if (!template) {
				throw new Error("Шаблон письма не найден — возможно, был удалён");
			}
			const html = await renderCampaignTemplate(
				template.templateKey,
				template.fields,
			);
			if (!html) {
				throw new Error(`Неизвестный тип шаблона: ${template.templateKey}`);
			}
			const client = createUnisenderClient(settings.apiKey);

			const recipients = (
				await listEmailCampaignRecipients(payload.campaignId)
			).filter(
				(r): r is typeof r & { email: string } =>
					r.status === "pending" && !!r.email,
			);
			if (recipients.length === 0) {
				throw new Error("Среди получателей некому отправлять");
			}

			const list = await client.createList(
				`CRM: ${campaign.stageName ?? campaign.stageId} — ${new Date().toISOString()}`,
			);

			let imported = 0;
			for (let i = 0; i < recipients.length; i += IMPORT_BATCH_SIZE) {
				const batch = recipients.slice(i, i + IMPORT_BATCH_SIZE);
				const result = await client.importContacts({
					fieldNames: ["email", "Name"],
					data: batch.map((r) => [r.email, r.contactName ?? ""]),
					listIds: [list.id],
					doubleOptin: 0,
				});
				const invalidEmails = new Set(result.invalid_emails ?? []);
				for (const r of batch) {
					const ok = !invalidEmails.has(r.email);
					await updateEmailCampaignRecipient(r.id, {
						status: ok ? "imported" : "error",
						error: ok ? null : "Unisender отклонил email как невалидный",
					});
					if (ok) imported++;
				}
			}

			if (imported === 0) {
				throw new Error("Ни один email не был импортирован в Unisender");
			}

			const message = await client.createEmailMessage({
				senderName: campaign.senderName ?? settings.senderName ?? "",
				senderEmail: campaign.senderEmail,
				subject: campaign.subject,
				body: toUnisenderTags(html),
				listId: list.id,
			});

			const created = await client.createCampaign({
				messageId: message.message_id,
			});

			await setEmailCampaignUnisenderIds(campaign.id, {
				unisenderListId: String(list.id),
				unisenderMessageId: String(message.message_id),
				unisenderCampaignId: String(created.campaign_id),
				recipientsCount: imported,
			});

			return { imported, campaignId: created.campaign_id };
		} catch (err) {
			await finishEmailCampaign(campaign.id, {
				status: "error",
				error: (err as Error).message,
			});
			throw err;
		}
	},
});

/**
 * Опрос статуса запущенных email-кампаний раз в 15 минут: Unisender не шлёт
 * вебхук о завершении рассылки, поэтому статистику (отправлено/открыто/
 * перешли/отписались) и финальный статус приходится подтягивать поллингом.
 *
 * Значение status из getCampaignStatus проверено по документации лишь
 * частично — при первом реальном запуске сверить, что регэксп ниже
 * действительно ловит финальный статус, и уточнить при необходимости.
 */
export const pollEmailCampaigns = CreateTaskWorkflow({
	name: "email-campaign-poll",
	// Сдвиг от */15 — чтобы не стартовать в ту же минуту, что другие крон-задачи.
	on: { cron: "9-59/15 * * * *" },
	retries: 0,
	executionTimeout: "5m",
	fn: async () => {
		const {
			finishEmailCampaign,
			getUnisenderSettings,
			listRunningEmailCampaigns,
			updateEmailCampaignStats,
		} = await import("@psi-opora/db/queries");
		const { createUnisenderClient } = await import(
			"@psi-opora/unisender-client"
		);

		const settings = await getUnisenderSettings();
		if (!settings?.apiKey) return { checked: 0 };

		const client = createUnisenderClient(settings.apiKey);
		const running = await listRunningEmailCampaigns();

		for (const campaign of running) {
			if (!campaign.unisenderCampaignId) continue;
			try {
				const campaignId = Number(campaign.unisenderCampaignId);
				const [status, stats] = await Promise.all([
					client.getCampaignStatus(campaignId),
					client.getCampaignCommonStats(campaignId).catch(() => null),
				]);

				const counts = stats
					? {
							sentCount: stats.sent ?? stats.total,
							openedCount: stats.read_unique,
							clickedCount: stats.clicked_unique,
							unsubscribedCount: stats.unsubscribed,
						}
					: {};

				const isFinished = /sent|finish|complete|done/i.test(
					status.status ?? "",
				);
				if (isFinished) {
					await finishEmailCampaign(campaign.id, {
						status: "done",
						...counts,
					});
				} else {
					await updateEmailCampaignStats(campaign.id, counts);
				}
			} catch (err) {
				console.error(
					`[email-campaign-poll] ${campaign.id}: ${(err as Error).message}`,
				);
			}
		}

		return { checked: running.length };
	},
});
