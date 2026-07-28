import {
  ConcurrencyLimitStrategy,
  CreateTaskWorkflow,
} from "@hatchet-dev/typescript-sdk";

export interface DeliverEmailCampaignPayload {
  campaignId: string;
}

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
      getUnisenderSettings,
      listEmailCampaignRecipients,
      setEmailCampaignUnisenderIds,
      updateEmailCampaignRecipient,
    } = await import("@psi-opora/db/queries");
    const { createUnisenderClient } = await import(
      "@psi-opora/unisender-client"
    );

    const campaign = await getEmailCampaign(payload.campaignId);
    if (!campaign) {
      throw new Error(`Email-кампания ${payload.campaignId} не найдена`);
    }

    try {
      const settings = await getUnisenderSettings();
      if (!settings?.apiKey) {
        throw new Error(
          "Unisender не настроен — укажите API-ключ на странице /settings/email",
        );
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
        templateId: campaign.templateId,
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
 * Опрос статуса запущенных email-кампаний раз в 5 минут: Unisender не шлёт
 * вебхук о завершении рассылки, поэтому статистику (отправлено/открыто/
 * перешли/отписались) и финальный статус приходится подтягивать поллингом.
 *
 * Значение status из getCampaignStatus проверено по документации лишь
 * частично — при первом реальном запуске сверить, что регэксп ниже
 * действительно ловит финальный статус, и уточнить при необходимости.
 */
export const pollEmailCampaigns = CreateTaskWorkflow({
  name: "email-campaign-poll",
  on: { cron: "*/5 * * * *" },
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
