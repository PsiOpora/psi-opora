import { type BitrixApi, createWebhookApi } from "@psi-opora/bitrix-client";
import {
  getBitrixCrmLink,
  getBotConnector,
  listMaxPersonalAccounts,
  listTelegramPersonalAccounts,
  listWhatsappPersonalAccounts,
} from "@psi-opora/db/queries";
import type { InboxMessenger } from "./types";

/** Ошибки прав/скоупа — повод попробовать другой ключ, а не падать. */
export function isCredentialsError(message: string): boolean {
  return /INVALID_CREDENTIALS|insufficient_scope|ACCESS_DENIED/i.test(message);
}

/**
 * Вебхук ботов для методов Открытых линий — та же логика выбора env, что у
 * bot-core (getWebhookBase): {TG|MAX}_BITRIX_WEBHOOK_URL, иначе общий
 * BITRIX_WEBHOOK_URL. Нужен как фолбэк: у вебхука дашборда (локальная
 * разработка) обычно нет скоупа imopenlines, а у вебхука ботов — есть.
 */
function botWebhookUrl(messenger: string): string | null {
  if (messenger !== "telegram" && messenger !== "max") {
    // Личные номера (telegram-personal/whatsapp-personal) не имеют своего
    // вебхука бота — фолбэка для них нет, есть только OAuth-сессия дашборда.
    return null;
  }
  const prefix = messenger === "telegram" ? "TG" : "MAX";
  return (
    process.env[`${prefix}_BITRIX_WEBHOOK_URL`] ??
    process.env.BITRIX_WEBHOOK_URL ??
    null
  );
}

export interface OpenLineDialogRaw {
  id?: number;
  entity_data_2?: string;
}

/**
 * Диалог Открытой линии по USER_CODE: сперва через основной API (OAuth в
 * проде), при нехватке прав — через вебхук ботов. ACCESS_ERROR означает
 * «диалога ещё нет» (клиент не писал через коннектор) — это null, не сбой.
 */
export async function getOpenLineDialog(
  api: BitrixApi,
  messenger: string,
  userCode: string,
): Promise<OpenLineDialogRaw | null> {
  const call = (a: BitrixApi) =>
    a.call<OpenLineDialogRaw>("imopenlines.dialog.get", {
      USER_CODE: userCode,
    });

  try {
    return await call(api);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("ACCESS_ERROR")) return null;
    if (!isCredentialsError(message)) throw err;

    const webhookUrl = botWebhookUrl(messenger);
    if (!webhookUrl) throw err;
    try {
      return await call(createWebhookApi(webhookUrl));
    } catch (retryErr) {
      const retryMessage =
        retryErr instanceof Error ? retryErr.message : String(retryErr);
      if (retryMessage.includes("ACCESS_ERROR")) return null;
      throw retryErr;
    }
  }
}

/**
 * entity_data_2 диалога Открытой линии — привязки CRM парами `TYPE|ID`:
 * `LEAD|0|COMPANY|0|CONTACT|123|DEAL|456` (0 = привязки нет). Тот же формат
 * разбирает бот при создании сделки — см.
 * packages/bot-core/src/utils/bitrix/openline.ts (parseDialogCrmBindings).
 */
export function parseCrmBindings(raw: string | undefined): {
  contactId: string | null;
  dealId: string | null;
  leadId: string | null;
} {
  const bindings: Record<string, number> = {};
  const parts = (raw ?? "").split("|");
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const type = parts[i];
    const id = Number(parts[i + 1]);
    if (type && Number.isFinite(id) && id > 0) bindings[type] = id;
  }
  return {
    contactId: bindings.CONTACT ? String(bindings.CONTACT) : null,
    dealId: bindings.DEAL ? String(bindings.DEAL) : null,
    leadId: bindings.LEAD ? String(bindings.LEAD) : null,
  };
}

/**
 * Резолвит диалог Открытой линии для личного номера (telegram-personal /
 * whatsapp-personal): в отличие от ботов, каждый номер — своя пара
 * connector/line (packages/db telegram_personal_accounts /
 * whatsapp_personal_accounts), поэтому единого коннектора на весь мессенджер
 * нет. USER_CODE — `{connector}|{line}|{userId}|{userId}`. Проверяем все
 * подключённые номера портала (обычно один) — первый, у которого нашёлся
 * диалог с этим userId.
 */
export async function resolvePersonalDialog(
  api: BitrixApi,
  messenger: "telegram-personal" | "whatsapp-personal" | "max-personal",
  memberId: string | null,
  userId: string,
): Promise<OpenLineDialogRaw | null> {
  if (!memberId) return null;
  const accounts =
    messenger === "telegram-personal"
      ? await listTelegramPersonalAccounts(memberId)
      : messenger === "whatsapp-personal"
        ? await listWhatsappPersonalAccounts(memberId)
        : await listMaxPersonalAccounts(memberId);

  for (const account of accounts.filter((a) => a.status === "connected")) {
    const userCode = `${account.connectorId}|${account.openLineId}|${userId}|${userId}`;
    const dialog = await getOpenLineDialog(api, messenger, userCode);
    if (dialog?.id) return dialog;
  }
  return null;
}

export interface CrmBindings {
  contactId: string | null;
  dealId: string | null;
  leadId: string | null;
}

const EMPTY_CRM_BINDINGS: CrmBindings = {
  contactId: null,
  dealId: null,
  leadId: null,
};

/**
 * CRM-привязки диалога (контакт/сделка/лид) для messenger+userId:
 * Для всех каналов сперва проверяем bitrix_crm_links:
 * - telegram-personal/whatsapp-personal: связь пишет CRM-виджет при первой
 *   исходящей отправке, когда contactId уже известен. Диалог Открытой линии
 *   остаётся фолбэком для старых и входящих переписок.
 * - telegram/max (боты): таблицу заполняет
 *   createBitrixDeal при создании сделки (packages/bot-core/src/utils/bitrix/create-deal.ts),
 *   который теперь всегда создаёт контакт/сделку сам, а не ждёт трекера
 *   Открытой линии. Диалог (entity_data_2) — фолбэк для сделок, созданных
 *   до этой миграции: entity_data_2 заполняет только сам трекер при
 *   автосоздании сущностей, которое в текущих настройках линии отключено,
 *   так что для новых диалогов там нет ни контакта, ни сделки.
 */
export async function resolveDialogCrmBindings(
  api: BitrixApi,
  memberId: string | null,
  messenger: InboxMessenger,
  userId: string,
): Promise<CrmBindings> {
  const link = await getBitrixCrmLink(messenger, userId).catch(() => null);
  if (link) {
    return {
      contactId: link.contactId,
      dealId: link.dealId ?? null,
      leadId: null,
    };
  }

  if (
    messenger === "telegram-personal" ||
    messenger === "whatsapp-personal" ||
    messenger === "max-personal"
  ) {
    const dialog = await resolvePersonalDialog(api, messenger, memberId, userId);
    return dialog?.id
      ? parseCrmBindings(dialog.entity_data_2)
      : EMPTY_CRM_BINDINGS;
  }

  const connector = await getBotConnector(messenger);
  if (!connector) return EMPTY_CRM_BINDINGS;
  const userCode = `${connector.connectorId}|${connector.openLineId}|${userId}|${userId}`;
  const dialog = await getOpenLineDialog(api, messenger, userCode);
  return dialog?.id
    ? parseCrmBindings(dialog.entity_data_2)
    : EMPTY_CRM_BINDINGS;
}

interface RawDeal {
  CONTACT_ID?: string | number | null;
}

interface RawContact {
  NAME?: string;
  LAST_NAME?: string;
}

/**
 * Имя CRM-контакта, привязанного к диалогу клиента (тот же путь резолвинга,
 * что использует правая панель профиля — см. crm-links.ts): CRM-привязки
 * диалога (resolveDialogCrmBindings) → CONTACT (либо через CONTACT_ID
 * сделки) → crm.contact.get. `null`, если диалога/контакта нет или
 * обращение к Bitrix не удалось — вызывающая сторона в этом случае
 * оставляет текущий фолбэк.
 */
export async function resolveCrmContactName(
  api: BitrixApi,
  memberId: string | null,
  messenger: InboxMessenger,
  userId: string,
): Promise<string | null> {
  try {
    let { contactId, dealId } = await resolveDialogCrmBindings(
      api,
      memberId,
      messenger,
      userId,
    );

    if (!contactId && dealId) {
      const deal = await api
        .call<RawDeal>("crm.deal.get", { id: dealId })
        .catch(() => null);
      contactId = deal?.CONTACT_ID ? String(deal.CONTACT_ID) : null;
    }

    if (!contactId) return null;

    const contact = await api.call<RawContact>("crm.contact.get", {
      id: contactId,
    });
    const name = [contact?.NAME, contact?.LAST_NAME].filter(Boolean).join(" ");
    return name || null;
  } catch {
    return null;
  }
}
