import {
  createEmailCampaign,
  finishEmailCampaign,
  getLastEmailCampaignForStage,
  insertEmailCampaignRecipients,
} from "@psi-opora/db/queries";
import { enqueueEmailCampaign } from "@psi-opora/jobs";
import { publicProcedure } from "../../orpc";
import {
  buildEmailReport,
  collectEmailRecipients,
} from "../../email-campaign-collect";
import { sendEmailCampaignSchema } from "../../schemas/broadcast";
import { getUnisenderContext } from "./unisender-context";
import type { EmailCampaignActionResult } from "./types";

export const send = publicProcedure
  .input(sendEmailCampaignSchema)
  .handler(async ({ input, context }): Promise<EmailCampaignActionResult> => {
    const api = await context.getBitrixApi();
    if (!api) return { error: "Bitrix24 не подключён" };
    if (!input.stageId) return { error: "Не выбрана стадия" };
    if (!input.templateId) return { error: "Не выбран шаблон" };

    const subject = input.subject.trim();
    if (!subject) return { error: "Не задана тема письма" };

    const ctx = await getUnisenderContext();
    if (!ctx) {
      return { error: "Unisender не настроен — см. /settings/email" };
    }
    if (!ctx.settings.senderEmail) {
      return { error: "Не задан email отправителя — см. /settings/email" };
    }

    try {
      const { totalDeals, recipients } = await collectEmailRecipients(
        api,
        input.stageId,
      );

      if (input.dryRun) {
        const recent = await getLastEmailCampaignForStage(
          input.stageId,
        ).catch(() => null);
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
