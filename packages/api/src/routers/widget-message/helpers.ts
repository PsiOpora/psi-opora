import type { BitrixApi } from "@psi-opora/bitrix-client";
import {
  getWhatsappPersonalAccount,
  listBotMessages,
  listTelegramPersonalAccounts,
  listWhatsappPersonalAccounts,
} from "@psi-opora/db/queries";
import { getSendResult, pushOutboundMessage } from "@psi-opora/tg-userbot";
import { jidFromPhone, wahaSendText } from "@psi-opora/waha";
import {
  discoverMessengerFields,
  findMaxId,
  findTelegram,
  getContactPhone,
  type RawContact,
} from "../../broadcast-send";
import type { WidgetChannel, WidgetEntity, WidgetHistoryItem } from "./types";

const SEND_RESULT_POLL_INTERVAL_MS = 300;
const SEND_RESULT_TIMEOUT_MS = 6000;

/**
 * Личный номер (в отличие от бота) не держит соединение в этом процессе —
 * задача уходит в очередь always-on воркера (apps/tg-userbot-worker), а
 * результат (резолв Telegram-пира + сама отправка) ждём здесь коротким
 * поллингом, чтобы вернуть внятный ответ вызывающему, а не «повесить» кнопку.
 * Используется и вкладкой CRM (send.ts), и единым инбоксом
 * (packages/api/src/routers/messages/send.ts).
 */
export async function sendViaPersonalNumber(params: {
  memberId: string;
  openLineId: string;
  target: { kind: "phone" | "username" | "id"; value: string };
  text: string;
}): Promise<{ ok?: true; error?: string }> {
  const jobId = crypto.randomUUID();
  await pushOutboundMessage({
    memberId: params.memberId,
    openLineId: params.openLineId,
    jobId,
    ...(params.target.kind === "phone" ? { phone: params.target.value } : {}),
    ...(params.target.kind === "username"
      ? { telegramUsername: params.target.value }
      : {}),
    ...(params.target.kind === "id"
      ? { telegramUserId: Number(params.target.value) }
      : {}),
    text: params.text,
  });

  const deadline = Date.now() + SEND_RESULT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await getSendResult(jobId);
    if (result) {
      return result.ok
        ? { ok: true }
        : { error: `Не отправлено: ${result.error ?? "неизвестная ошибка"}` };
    }
    await new Promise((resolve) =>
      setTimeout(resolve, SEND_RESULT_POLL_INTERVAL_MS),
    );
  }
  return {
    error:
      "Не удалось дождаться ответа от воркера личного номера — проверьте, что apps/tg-userbot-worker запущен",
  };
}

/**
 * Отправка через личный номер WhatsApp — в отличие от Telegram (личный номер
 * держит соединение в отдельном always-on процессе, apps/tg-userbot-worker),
 * WhatsApp обслуживает контейнер WAHA по REST, поэтому шлём синхронно, без
 * очереди и поллинга результата.
 */
export async function sendViaWhatsappPersonal(params: {
  memberId: string;
  openLineId: string;
  jid: string;
  text: string;
}): Promise<{ ok?: true; error?: string }> {
  const account = await getWhatsappPersonalAccount(
    params.memberId,
    params.openLineId,
  );
  if (!account) return { error: "Личный номер WhatsApp не подключён" };

  try {
    await wahaSendText(account.sessionName, params.jid, params.text);
    return { ok: true };
  } catch (err) {
    return { error: `Не отправлено: ${(err as Error).message}` };
  }
}

export const HISTORY_LIMIT = 30;

export async function loadHistory(
  channels: WidgetChannel[],
): Promise<WidgetHistoryItem[]> {
  const perChannel = await Promise.all(
    channels.map(async (channel) => {
      const rows = await listBotMessages(
        channel.messenger,
        channel.userId,
        HISTORY_LIMIT,
      ).catch(() => []);
      return rows.map((row) => ({
        id: row.id,
        messenger: channel.messenger,
        direction: row.direction === "in" ? ("in" as const) : ("out" as const),
        source: row.source,
        text: row.text,
        createdAt: row.createdAt.toISOString(),
      }));
    }),
  );
  return perChannel
    .flat()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-HISTORY_LIMIT);
}

export interface ResolvedContact {
  contactId: string;
  contactName: string;
  channels: WidgetChannel[];
  telegramUsername?: string;
}

function maskPhone(phone: string): string {
  if (phone.length <= 6) return phone;
  return `${phone.slice(0, 4)}···${phone.slice(-2)}`;
}

interface PersonalTarget {
  kind: "phone" | "username" | "id";
  value: string;
}

/**
 * Чем адресовать личный аккаунт при отправке этому контакту: телефон в
 * приоритете (самый надёжный способ «написать первым»), иначе username или
 * готовый числовой ID из полей контакта — их ищем, только если телефона нет,
 * чтобы не делать лишний запрос crm.contact.fields на каждый показ виджета.
 */
async function resolvePersonalTarget(
  api: BitrixApi,
  contact: RawContact,
  phone: string | undefined,
): Promise<PersonalTarget | undefined> {
  if (phone) return { kind: "phone", value: phone };

  const messengerFields = await discoverMessengerFields(api).catch(() => ({
    telegram: [],
    max: [],
  }));
  const telegram = findTelegram(contact, messengerFields.telegram, {
    includeUf: true,
  });
  if (telegram?.username) return { kind: "username", value: telegram.username };
  if (telegram?.userId) return { kind: "id", value: telegram.userId };
  return undefined;
}

/**
 * Резолвит ID контакта и его каналы из CRM: для сделки сначала берём
 * привязанный контакт. Каналы двух видов:
 * 1. Боты (Telegram/MAX) — только если контакт уже писал (поле IM
 *    «Мессенджер», UF-поля интеграций игнорируются — менеджер видит и
 *    редактирует именно поле Мессенджер).
 * 2. Личные номера Telegram (packages/tg-userbot) — доступны для «написать
 *    первым», независимо от того, писал ли клиент раньше. Адресуем по
 *    первому, что нашлось у контакта: телефон (client.resolvePhoneNumber) →
 *    username (client.resolvePeer/resolveUsername, includeUf — берём и
 *    UF-поля интеграций типа TelegramUsername_WZ, в отличие от бот-канала
 *    выше — MTProto-клиенту, в отличие от Bot API, это доступно) → готовый
 *    числовой Telegram ID (может не резолвиться, если аккаунт никогда не
 *    «видел» этого пользователя — ограничение самого Telegram, не наше).
 *    Один портал может подключить несколько номеров — показываем канал на
 *    каждый подключённый (status="connected"), с номером в подписи.
 * 3. Личные номера WhatsApp (packages/waha) — тоже «написать первым», но
 *    только по телефону: у WhatsApp нет публичных username или устойчивых
 *    числовых ID, которые можно было бы резолвить без предыдущей переписки,
 *    поэтому без телефона в карточке контакта канал не показываем.
 *
 * Используется и для отображения виджета, и для отправки — так отправка
 * никогда не доверяет messenger/userId, присланным из браузера напрямую,
 * а всегда пересчитывает их из актуальных данных CRM.
 */
export async function resolveContact(
  api: BitrixApi,
  entity: WidgetEntity,
  id: string,
  memberId: string | null,
): Promise<{ contact?: ResolvedContact; error?: string }> {
  let contactId = id;
  if (entity === "deal") {
    const deal = await api.call<{ CONTACT_ID?: string | null }>(
      "crm.deal.get",
      { id },
    );
    contactId = deal?.CONTACT_ID ?? "";
    if (!contactId) {
      return { error: "У сделки нет привязанного контакта" };
    }
  }

  const contact = await api.call<RawContact>("crm.contact.get", {
    id: contactId,
  });
  if (!contact) return { error: "Контакт не найден" };

  const channels: WidgetChannel[] = [];
  const telegram = findTelegram(contact, [], { includeUf: false });
  if (telegram?.userId) {
    channels.push({
      messenger: "telegram",
      userId: telegram.userId,
      label: "Telegram",
    });
  }
  const maxId = findMaxId(contact, [], { includeUf: false });
  if (maxId) channels.push({ messenger: "max", userId: maxId, label: "MAX" });

  const phone = getContactPhone(contact);
  if (memberId) {
    const personalAccounts = await listTelegramPersonalAccounts(memberId).catch(
      () => [],
    );
    const connectedAccounts = personalAccounts.filter(
      (account) => account.status === "connected",
    );
    if (connectedAccounts.length) {
      const personalTarget = await resolvePersonalTarget(api, contact, phone);
      if (personalTarget) {
        for (const account of connectedAccounts) {
          channels.push({
            messenger: "telegram-personal",
            userId: personalTarget.value,
            personalTargetKind: personalTarget.kind,
            lineId: account.openLineId,
            label: `Telegram (личный, ${maskPhone(account.phone)})`,
          });
        }
      }
    }

    if (phone) {
      const whatsappAccounts = await listWhatsappPersonalAccounts(
        memberId,
      ).catch(() => []);
      const jid = jidFromPhone(phone);
      for (const account of whatsappAccounts.filter(
        (a) => a.status === "connected",
      )) {
        channels.push({
          messenger: "whatsapp-personal",
          userId: jid,
          lineId: account.openLineId,
          label: `WhatsApp (личный, ${maskPhone(account.phone)})`,
        });
      }
    }
  }

  return {
    contact: {
      contactId,
      contactName:
        [contact.NAME, contact.LAST_NAME].filter(Boolean).join(" ") ||
        `Контакт #${contactId}`,
      channels,
      telegramUsername: telegram?.username,
    },
  };
}
