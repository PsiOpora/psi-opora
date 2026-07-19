"use server";

import {
  createEmailCampaign,
  finishEmailCampaign,
  getLastEmailCampaignForStage,
  getUnisenderSettings,
  insertEmailCampaignRecipients,
  type UnisenderSettings,
} from "@psi-opora/db/queries";
import type { deliverEmailCampaign } from "@psi-opora/jobs";
import {
  createUnisenderClient,
  type UnisenderClient,
} from "@psi-opora/unisender-client";
import { tasks } from "@trigger.dev/sdk";
import { revalidatePath } from "next/cache";
import { getBitrixApi } from "@/lib/bitrix/session";
import {
  buildEmailReport,
  collectEmailRecipients,
  type EmailRecipientsReport,
} from "@/lib/email-campaign/collect";

async function getUnisenderContext(): Promise<{
  client: UnisenderClient;
  settings: UnisenderSettings;
} | null> {
  const settings = await getUnisenderSettings();
  if (!settings?.apiKey) return null;
  return { client: createUnisenderClient(settings.apiKey), settings };
}

export async function getTemplatePreviewAction(templateId: string): Promise<{
  subject?: string;
  body?: string;
  error?: string;
}> {
  const ctx = await getUnisenderContext();
  if (!ctx) return { error: "Unisender не настроен — см. /settings/email" };
  try {
    const details = await ctx.client.getTemplate(templateId);
    return { subject: details.subject, body: details.body };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export interface RecentEmailCampaignInfo {
  startedAt: Date | null;
  recipientsCount: number | null;
}

export interface EmailCampaignActionResult {
  report?: EmailRecipientsReport;
  /** Последняя кампания по этой же стадии — предупреждение о возможном дубле. */
  recentCampaign?: RecentEmailCampaignInfo | null;
  /** ID кампании, поставленной в очередь trigger.dev. */
  queuedCampaignId?: string;
  /** Сколько получателей будет отправлено фоновой задачей. */
  queuedCount?: number;
  error?: string;
}

/** Тестовая отправка письма шаблона на один адрес — минуя список/кампанию Unisender. */
export async function sendTestEmailAction(input: {
  email: string;
  templateId: string;
  subject: string;
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getUnisenderContext();
  if (!ctx) return { ok: false, error: "Unisender не настроен" };
  if (!ctx.settings.senderEmail) {
    return { ok: false, error: "Не задан email отправителя — см. /settings/email" };
  }
  const subject = input.subject.trim();
  if (!subject) return { ok: false, error: "Тема письма пуста" };
  if (!input.email) return { ok: false, error: "У контакта нет email" };

  try {
    const template = await ctx.client.getTemplate(input.templateId);
    await ctx.client.sendEmail({
      email: input.email,
      senderName: ctx.settings.senderName ?? "",
      senderEmail: ctx.settings.senderEmail,
      subject,
      body: template.body,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function sendEmailCampaignAction(input: {
  stageId: string;
  stageName?: string;
  templateId: string;
  templateName?: string;
  subject: string;
  dryRun: boolean;
  /**
   * Число получателей из предпросмотра. Для реальной отправки обязательно:
   * если состав изменился с момента предпросмотра — рассылка не запускается.
   */
  expectedRecipients?: number;
  /**
   * ID контактов, отмеченных чекбоксами в предпросмотре. Если не задано или
   * пусто — письмо уходит всем подходящим получателям стадии.
   */
  selectedContactIds?: string[];
}): Promise<EmailCampaignActionResult> {
  const api = await getBitrixApi();
  if (!api) return { error: "Bitrix24 не подключён" };
  if (!input.stageId) return { error: "Не выбрана стадия" };
  if (!input.templateId) return { error: "Не выбран шаблон" };

  const subject = input.subject.trim();
  if (!subject) return { error: "Не задана тема письма" };

  const ctx = await getUnisenderContext();
  if (!ctx) return { error: "Unisender не настроен — см. /settings/email" };
  if (!ctx.settings.senderEmail) {
    return { error: "Не задан email отправителя — см. /settings/email" };
  }

  try {
    const { totalDeals, recipients } = await collectEmailRecipients(
      api,
      input.stageId,
    );

    if (input.dryRun) {
      const recent = await getLastEmailCampaignForStage(input.stageId).catch(
        () => null,
      );
      return {
        report: buildEmailReport(totalDeals, recipients, true),
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

    const selectedIds = input.selectedContactIds?.length
      ? new Set(input.selectedContactIds)
      : null;
    const targetRecipients = selectedIds
      ? recipients.filter((r) => selectedIds.has(r.contactId))
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
      stageId: input.stageId,
      stageName: input.stageName,
      templateId: input.templateId,
      templateName: input.templateName,
      subject,
      senderEmail: ctx.settings.senderEmail,
      senderName: ctx.settings.senderName ?? undefined,
      totalDeals,
    });
    await insertEmailCampaignRecipients(
      targetRecipients.map((r) => ({
        id: crypto.randomUUID(),
        campaignId,
        contactId: r.contactId,
        contactName: r.contactName,
        dealId: r.dealId,
        dealTitle: r.dealTitle,
        email: r.email,
        status: r.status === "pending" ? "pending" : "skipped",
        error: r.error ?? null,
      })),
    );

    try {
      await tasks.trigger<typeof deliverEmailCampaign>(
        "email-campaign-deliver",
        { campaignId },
      );
    } catch (err) {
      await finishEmailCampaign(campaignId, {
        status: "error",
        error: `Не удалось запустить фоновую задачу: ${(err as Error).message}`,
      });
      revalidatePath("/email-broadcast");
      return {
        error: `Рассылка не запущена: ${(err as Error).message}. Проверьте настройку trigger.dev (TRIGGER_SECRET_KEY).`,
      };
    }

    revalidatePath("/email-broadcast");
    return { queuedCampaignId: campaignId, queuedCount: pendingCount };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
