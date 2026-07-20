import { publicProcedure } from "../../orpc";
import { widgetRecipientSchema } from "../../schemas/broadcast";
import { loadHistory, resolveContact } from "./helpers";
import type { WidgetRecipient } from "./types";

export const loadRecipient = publicProcedure
  .input(widgetRecipientSchema)
  .handler(
    async ({
      input,
      context,
    }): Promise<{ recipient?: WidgetRecipient; error?: string }> => {
      if (!/^\d+$/.test(input.id)) {
        return { error: "Некорректный ID элемента CRM" };
      }

      const api = await context.getBitrixApi();
      if (!api) {
        return { error: "Нет подключения к Битрикс24 — обновите страницу" };
      }

      try {
        const { contact, error } = await resolveContact(
          api,
          input.entity,
          input.id,
        );
        if (error || !contact) return { error };

        const note =
          contact.channels.length === 0 && contact.telegramUsername
            ? `У контакта только Telegram-username (@${contact.telegramUsername}). Бот может писать лишь тем, кто сам открывал диалог с ботом — нужен числовой ID.`
            : undefined;

        return {
          recipient: {
            contactId: contact.contactId,
            contactName: contact.contactName,
            channels: contact.channels,
            history: await loadHistory(contact.channels),
            note,
          },
        };
      } catch (err) {
        return { error: (err as Error).message };
      }
    },
  );
