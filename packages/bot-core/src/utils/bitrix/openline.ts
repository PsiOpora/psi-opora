import { getBotConnector } from "@psi-opora/db/queries.edge";
import { bitrixPost } from "./client";
import type { BitrixApiLike } from "./types";

export interface OpenLineDialog {
  /** Внутренний ID чата Bitrix (для imopenlines.crm.chat.user.add). */
  chatId: number;
  /** Значение для мультиполя IM контакта (тип OPENLINE):
   * `imol|{connector}|{line}|{chat_id}|{внутренний id чата Bitrix}` —
   * см. buildMessengerLinkFields. */
  imol: string;
  /** Контакт, который CRM-трекер Открытой линии создал по чату. */
  contactId: number | null;
  /** Сделка, которую CRM-трекер Открытой линии создал по чату. */
  dealId: number | null;
  leadId: number | null;
}

/**
 * entity_data_2 диалога — привязки CRM парами `TYPE|ID`:
 * `LEAD|0|COMPANY|0|CONTACT|123|DEAL|456` (0 = привязки нет).
 */
function parseDialogCrmBindings(
  raw: string | undefined,
): Pick<OpenLineDialog, "contactId" | "dealId" | "leadId"> {
  const bindings: Record<string, number> = {};
  const parts = (raw ?? "").split("|");
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const type = parts[i];
    const id = Number(parts[i + 1]);
    if (type && Number.isFinite(id) && id > 0) bindings[type] = id;
  }
  return {
    contactId: bindings.CONTACT ?? null,
    dealId: bindings.DEAL ?? null,
    leadId: bindings.LEAD ?? null,
  };
}

/**
 * Резолвит диалог Открытой линии через imopenlines.dialog.get по USER_CODE:
 * настоящий внутренний ID чата Bitrix (нужен для imopenlines.crm.chat.user.add —
 * CHAT_ID там означает внутренний ID чата, а не наш внешний user_id/chat_id)
 * плюс CRM-сущности, которые трекер линии уже успел создать по этому чату
 * (entity_data_2) — их используем вместо создания дублей.
 * Формат USER_CODE — `{connector}|{line}|{chat_id}|{user_id}` —
 * это то же самое, что мы уже передаём в imconnector.send.messages
 * (chat.id/user.id), так что дополнительно ничего не нужно хранить.
 * ACCESS_ERROR — нормальная ситуация, если диалог ещё не создан (сообщение
 * через коннектор ещё не отправлялось) — не логируем как ошибку.
 */
export async function resolveOpenLineDialog(
  messenger: string,
  userId: number,
  chatId: number,
): Promise<OpenLineDialog | null> {
  const config = await getBotConnector(messenger);
  if (!config) return null;
  const userCode = `${config.connectorId}|${config.openLineId}|${chatId}|${userId}`;
  try {
    const result = await bitrixPost<{ id?: number; entity_data_2?: string }>(
      "imopenlines.dialog.get",
      { USER_CODE: userCode },
      messenger,
    );
    if (!result?.id) return null;
    return {
      chatId: result.id,
      imol: `imol|${config.connectorId}|${config.openLineId}|${chatId}|${result.id}`,
      ...parseDialogCrmBindings(result.entity_data_2),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("ACCESS_ERROR")) {
      console.error(
        `[bitrix] не удалось получить диалог по USER_CODE ${userCode}: ${message}`,
      );
    }
    return null;
  }
}

// Bitrix отклоняет весь вызов imconnector.send.messages, если user.name не
// проходит валидацию (только буквы, пробелы, дефисы, апострофы, ≤25 символов) —
// имена из Telegram/MAX могут содержать эмодзи и цифры, поэтому подставляем
// поле, только если оно точно пройдёт проверку.
function sanitizeOpenLineName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().slice(0, 25);
  return /^[\p{L}\s'-]+$/u.test(trimmed) ? trimmed : undefined;
}

export interface OpenLineMessageData {
  messenger: string;
  userId: number;
  /** ID чата в мессенджере (Telegram chat_id / MAX chat_id) — по этому
   * значению Bitrix сопоставляет сообщение с уже открытым диалогом. */
  chatId: number;
  text: string;
  /** Имя клиента для отображения в диалоге (необязательно). */
  name?: string;
  /** Собственный ID сообщения во внешней системе (Telegram message_id) —
   * делает внешний ID сообщения в Bitrix детерминированным, чтобы потом
   * адресно обновить его через updateMessageInOpenLine (правка сообщения
   * в Telegram). Без него используется текущее время — обновить такое
   * сообщение позже уже нельзя. */
  messageId?: number;
  /** Вложения (фото/документ/голосовое) — прямая ссылка и имя файла. */
  files?: { url: string; name: string }[];
}

function buildExternalMessageId(
  data: Pick<OpenLineMessageData, "messenger" | "userId" | "messageId">,
): string {
  return data.messageId != null
    ? `${data.messenger}-${data.userId}-${data.messageId}`
    : `${data.messenger}-${data.userId}-${Date.now()}`;
}

/**
 * Дублирует сообщение клиента в Открытую линию Bitrix24 через
 * imconnector.send.messages — так оператор видит переписку из бота и
 * может ответить прямо в Открытой линии. Ответ оператора прилетает
 * обратным вебхуком (событие ONIMCONNECTORMESSAGEADD) — см.
 * apps/bitrix-webhook, который пересылает его через sendMessengerMessage.
 *
 * Требует OAuth-клиент (см. BitrixApiLike) — вызывающая сторона резолвит
 * его через `resolveBitrixApi(memberId)` из `@psi-opora/bitrix-client`.
 * CONNECTOR/LINE берутся из bot_connectors (packages/db) — заполняется
 * автоматически при активации канала бота в Контакт-центре (см.
 * packages/api/src/routers/bot-connector), а не из .env. Без `api` или
 * без записи в БД тихо пропускаем (канал ещё не активирован — не
 * критично для остальной работы бота).
 */
export async function sendMessageToOpenLine(
  api: BitrixApiLike | undefined,
  data: OpenLineMessageData,
): Promise<void> {
  if (!api) return;
  const config = await getBotConnector(data.messenger);
  if (!config) return;

  const name = sanitizeOpenLineName(data.name);

  try {
    await api.call("imconnector.send.messages", {
      CONNECTOR: config.connectorId,
      LINE: Number(config.openLineId),
      MESSAGES: [
        {
          user: {
            id: String(data.userId),
            ...(name ? { name } : {}),
            skip_phone_validate: "Y",
          },
          message: {
            id: buildExternalMessageId(data),
            date: Math.floor(Date.now() / 1000),
            text: data.text,
            ...(data.files?.length ? { files: data.files } : {}),
          },
          chat: {
            id: String(data.chatId),
            name: data.name || `${data.messenger} #${data.userId}`,
          },
        },
      ],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[bitrix] не удалось переслать сообщение в Открытую линию: ${message}`,
    );
  }
}

/**
 * Пересылает правку уже отправленного сообщения (Telegram edited_message)
 * в Открытую линию через imconnector.update.messages — находит нужное
 * сообщение по тому же внешнему ID, что был использован при исходной
 * отправке (см. buildExternalMessageId), поэтому messageId здесь обязателен:
 * без него нечего обновлять — id совпадёт лишь случайно.
 */
export async function updateMessageInOpenLine(
  api: BitrixApiLike | undefined,
  data: OpenLineMessageData & { messageId: number },
): Promise<void> {
  if (!api) return;
  const config = await getBotConnector(data.messenger);
  if (!config) return;

  const name = sanitizeOpenLineName(data.name);

  try {
    await api.call("imconnector.update.messages", {
      CONNECTOR: config.connectorId,
      LINE: Number(config.openLineId),
      MESSAGES: [
        {
          user: {
            id: String(data.userId),
            ...(name ? { name } : {}),
            skip_phone_validate: "Y",
          },
          message: {
            id: buildExternalMessageId(data),
            date: Math.floor(Date.now() / 1000),
            text: data.text,
          },
          chat: {
            id: String(data.chatId),
            name: data.name || `${data.messenger} #${data.userId}`,
          },
        },
      ],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[bitrix] не удалось переслать правку сообщения в Открытую линию: ${message}`,
    );
  }
}

