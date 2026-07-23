import { bitrixPost, getBotId, getEnv } from "./client";
import {
  buildContactFields,
  buildMessengerLinkFields,
  findExistingContactId,
} from "./contact";
import { buildDealFields, linkBitrixTrace } from "./deal";
import { waitForOpenLineDialog } from "./openline";
import type { DealData } from "./types";

export async function createBitrixDeal(
  data: DealData,
): Promise<{ contactId: number; dealId: number }> {
  const messenger = data.messenger ?? "telegram";
  const webhookUrl = getEnv(messenger, "BITRIX_WEBHOOK_URL");
  if (!webhookUrl) {
    console.warn(
      `[bitrix] BITRIX_WEBHOOK_URL не задан для ${messenger}, пропускаем`,
    );
    return { contactId: 0, dealId: 0 };
  }

  // Бот дублирует переписку в Открытую линию (sendMessageToOpenLine), и её
  // CRM-трекер сам заводит контакт+сделку по первому сообщению чата. Чтобы не
  // плодить вторую сделку, дожидаемся (с коротким ретраем), что линия создала
  // по этому диалогу, — и обновляем её сущности вместо создания новых.
  const dialog =
    data.chatId && data.telegramUserId
      ? await waitForOpenLineDialog(messenger, data.telegramUserId, data.chatId)
      : null;
  if (dialog && !dialog.dealId && !dialog.leadId) {
    console.warn(
      `[bitrix] трекер Открытой линии так и не создал сделку по чату ${dialog.chatId} — создаём собственную`,
    );
  }
  if (dialog?.leadId) {
    console.warn(
      `[bitrix] по чату уже создан лид id=${dialog.leadId} (Открытая линия работает в классическом режиме CRM) — возможен дубль с создаваемой сделкой`,
    );
  }

  let contactId = dialog?.contactId ?? null;
  if (contactId) {
    // Контакт трекера линии — «пустышка» с именем из мессенджера: дополняем
    // его собранными ботом данными (телефон, email, согласие, профиль).
    // IM-привязку не передаём (imol: null) — трекер уже проставил её сам.
    console.log(
      `[bitrix] используем контакт Открытой линии id=${contactId} (phone=${data.phone}${data.email ? ` email=${data.email}` : ""})`,
    );
    try {
      await bitrixPost(
        "crm.contact.update",
        { id: contactId, fields: buildContactFields(data, null) },
        messenger,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[bitrix] не удалось обновить контакт Открытой линии ${contactId}: ${message}`,
      );
    }
  } else {
    contactId = await findExistingContactId(data);
    if (contactId) {
      console.log(
        `[bitrix] используем существующий контакт id=${contactId} вместо создания нового (phone=${data.phone}${data.email ? ` email=${data.email}` : ""})`,
      );
      const messengerLink = buildMessengerLinkFields(data, dialog?.imol);
      if (messengerLink) {
        try {
          await bitrixPost(
            "crm.contact.update",
            { id: contactId, fields: messengerLink },
            messenger,
          );
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(
            `[bitrix] не удалось привязать мессенджер к контакту ${contactId}: ${message}`,
          );
        }
      }
    } else {
      contactId = await bitrixPost<number>(
        "crm.contact.add",
        {
          fields: buildContactFields(data, dialog?.imol),
        },
        messenger,
      );
    }
  }

  let dealId = 0;
  if (dialog?.dealId) {
    // Сделку уже создал трекер Открытой линии — наполняем её данными бота
    // вместо создания дубля. При сбое обновления (сделку могли удалить)
    // откатываемся на прежнее поведение — создаём новую.
    try {
      await bitrixPost(
        "crm.deal.update",
        { id: dialog.dealId, fields: buildDealFields(data, contactId) },
        messenger,
      );
      dealId = dialog.dealId;
      console.log(
        `[bitrix] обновлена сделка Открытой линии id=${dealId} contact=${contactId} name=${data.name} phone=${data.phone}${data.email ? ` email=${data.email}` : ""}${data.source ? ` source=${data.source}` : ""}${data.campaign ? ` campaign=${data.campaign}` : ""} bot=${getBotId(messenger)}`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[bitrix] не удалось обновить сделку Открытой линии ${dialog.dealId}, создаём новую: ${message}`,
      );
    }
  }
  if (!dealId) {
    dealId = await bitrixPost<number>(
      "crm.deal.add",
      {
        fields: buildDealFields(data, contactId),
      },
      messenger,
    );
    console.log(
      `[bitrix] сделка создана id=${dealId} contact=${contactId} name=${data.name} phone=${data.phone}${data.email ? ` email=${data.email}` : ""}${data.source ? ` source=${data.source}` : ""}${data.campaign ? ` campaign=${data.campaign}` : ""} bot=${getBotId(messenger)}`,
    );
  }

  await linkBitrixTrace(messenger, contactId, dealId, data);

  // Привязка чата к контакту нужна, только если контакт не от трекера линии
  // (свой чат трекер привязывает сам при создании).
  if (dialog && dialog.contactId !== contactId) {
    try {
      await bitrixPost(
        "imopenlines.crm.chat.user.add",
        {
          CRM_ENTITY_TYPE: "contact",
          CRM_ENTITY: contactId,
          USER_ID: 0,
          CHAT_ID: dialog.chatId,
        },
        messenger,
      );
      console.log(
        `[bitrix] чат ${dialog.chatId} привязан к контакту ${contactId}`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[bitrix] не удалось привязать чат к контакту: ${message}`);
    }
  }

  return { contactId, dealId };
}
