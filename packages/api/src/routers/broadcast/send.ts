import {
  createBroadcast,
  finishBroadcast,
  getLastBroadcastForStage,
  insertBroadcastRecipients,
} from "@psi-opora/db/queries";
import { enqueueBroadcast } from "@psi-opora/jobs";
import { publicProcedure } from "../../orpc";
import { buildReport, collectRecipients } from "../../broadcast-send";
import { MESSAGE_MAX_LENGTH, sendBroadcastSchema } from "../../schemas/broadcast";
import type { BroadcastActionResult } from "./types";

export const send = publicProcedure
  .input(sendBroadcastSchema)
  .handler(async ({ input, context }): Promise<BroadcastActionResult> => {
    const api = await context.getBitrixApi();
    if (!api) return { error: "Bitrix24 не подключён" };

    if (!input.stageId) return { error: "Не выбрана стадия" };

    const message = input.message.trim();
    if (!input.dryRun && !message) return { error: "Текст сообщения пуст" };
    if (message.length > MESSAGE_MAX_LENGTH) {
      return {
        error: `Сообщение длиннее ${MESSAGE_MAX_LENGTH} символов — Telegram и MAX его не примут`,
      };
    }
    if (!input.dryRun && input.expectedRecipients === undefined) {
      return {
        error:
          "Отправка без предпросмотра запрещена — сначала нажмите «Показать получателей»",
      };
    }

    try {
      const { totalDeals, recipients } = await collectRecipients(
        api,
        input.stageId,
        input.channel,
      );

      if (input.dryRun) {
        const recent = await getLastBroadcastForStage(input.stageId).catch(
          () => null,
        );
        return {
          report: buildReport(totalDeals, recipients, true),
          recentBroadcast: recent
            ? { startedAt: recent.startedAt, sentCount: recent.sentCount }
            : null,
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

      const broadcastId = crypto.randomUUID();
      await createBroadcast({
        id: broadcastId,
        stageId: input.stageId,
        stageName: input.stageName,
        channel: input.channel,
        message,
        totalDeals,
      });
      await insertBroadcastRecipients(
        targetRecipients.map((r) => ({
          id: crypto.randomUUID(),
          broadcastId,
          contactId: r.contactId,
          contactName: r.contactName,
          dealId: r.dealId,
          dealTitle: r.dealTitle,
          messenger: r.messenger,
          messengerUserId: r.userId,
          status: r.status,
          error: r.error,
          sentAt: null,
        })),
      );

      try {
        await enqueueBroadcast({
          broadcastId,
          mode: "initial",
        });
      } catch (err) {
        await finishBroadcast(broadcastId, {
          status: "error",
          error: `Не удалось запустить фоновую задачу: ${(err as Error).message}`,
        });
        return {
          error: `Рассылка не запущена: ${(err as Error).message}. Проверьте подключение Hatchet (HATCHET_CLIENT_TOKEN).`,
        };
      }

      return { queuedBroadcastId: broadcastId, queuedCount: pendingCount };
    } catch (err) {
      return { error: (err as Error).message };
    }
  });
