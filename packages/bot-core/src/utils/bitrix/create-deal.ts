import { upsertBitrixCrmLink } from "@psi-opora/db/queries.edge";
import { bitrixPost, getBotId, getEnv } from "./client";
import {
  buildContactFields,
  buildMessengerLinkFields,
  findExistingContactId,
} from "./contact";
import { buildDealFields, linkBitrixTrace } from "./deal";
import { resolveOpenLineDialog } from "./openline";
import type { ContactData, DealData } from "./types";

/**
 * Создаёт или дополняет контакт сразу после того, как клиент оставил email
 * либо телефон. Сделку намеренно не создаёт: она появляется только после
 * завершения соответствующего сценария.
 */
export async function createBitrixContact(data: ContactData): Promise<number> {
  const messenger = data.messenger ?? "telegram";
  const webhookUrl = getEnv(messenger, "BITRIX_WEBHOOK_URL");
  if (!webhookUrl) {
    console.warn(
      `[bitrix] BITRIX_WEBHOOK_URL не задан для ${messenger}, пропускаем`,
    );
    return 0;
  }

  // Автосоздание сделки трекером Открытой линии отключено в настройках
  // линии — сделку всегда создаём сами, ждать её от трекера больше не нужно.
  // Диалог всё равно резолвим: он даёт внутренний ID чата Bitrix для поля IM
  // (imol, см. buildMessengerLinkFields) и для привязки чата к контакту
  // (imopenlines.crm.chat.user.add) — без этого переписка в Открытой линии
  // не будет связана с карточкой CRM. sendMessageToOpenLine к этому моменту
  // уже отработал (вызывается и ожидается до сценария в apps/tg-bot и
  // apps/max-bot), так что диалог на стороне Bitrix уже существует.
  const dialog =
    data.chatId && data.telegramUserId
      ? await resolveOpenLineDialog(messenger, data.telegramUserId, data.chatId)
      : null;

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

  // Запоминаем контакт в своей БД — панель CRM в «Клиенты»
  // (packages/api/src/routers/messages/crm-links.ts) резолвит их отсюда,
  // а не через imopenlines.dialog.get: entity_data_2 заполняет только
  // трекер Открытой линии при автосоздании сущностей, а мы теперь всегда
  // создаём контакт/сделку сами (см. комментарий выше).
  if (data.telegramUserId) {
    try {
      await upsertBitrixCrmLink({
        messenger,
        userId: String(data.telegramUserId),
        contactId: String(contactId),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[bitrix] не удалось сохранить связку CRM в БД: ${message}`);
    }
  }

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

  return contactId;
}

export async function createBitrixDeal(
  data: DealData,
): Promise<{ contactId: number; dealId: number }> {
  const messenger = data.messenger ?? "telegram";
  const contactId = await createBitrixContact(data);
  if (!contactId) return { contactId: 0, dealId: 0 };

  const dealId = await bitrixPost<number>(
    "crm.deal.add",
    {
      fields: buildDealFields(data, contactId),
    },
    messenger,
  );
  console.log(
    `[bitrix] сделка создана id=${dealId} contact=${contactId} name=${data.name} phone=${data.phone}${data.email ? ` email=${data.email}` : ""}${data.source ? ` source=${data.source}` : ""}${data.campaign ? ` campaign=${data.campaign}` : ""} bot=${getBotId(messenger)}`,
  );

  if (data.telegramUserId) {
    try {
      await upsertBitrixCrmLink({
        messenger,
        userId: String(data.telegramUserId),
        contactId: String(contactId),
        dealId: String(dealId),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[bitrix] не удалось сохранить связку CRM в БД: ${message}`);
    }
  }

  await linkBitrixTrace(messenger, contactId, dealId, data);
  return { contactId, dealId };
}
