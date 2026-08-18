import type { BitrixApi } from "@psi-opora/bitrix-client";
import {
  getWhatsappPersonalAccountByConnector,
  listBotMessages,
  listTelegramPersonalAccounts,
  listWhatsappPersonalAccounts,
  setWhatsappPersonalAccountStateBySession,
  upsertBotUserPresence,
} from "@psi-opora/db/queries";
import { getSendResult, pushOutboundMessage } from "@psi-opora/tg-userbot";
import {
  jidFromPhone,
  wahaGetChatPresence,
  wahaGetSession,
  wahaSendText,
  wahaSessionHealth,
} from "@psi-opora/waha";
import {
  discoverMessengerFields,
  findMaxId,
  findTelegram,
  getContactPhone,
  type MessengerFieldCodes,
  type RawContact,
} from "../../broadcast-send";
import type { WidgetChannel, WidgetEntity, WidgetHistoryItem } from "./types";

const SEND_RESULT_POLL_INTERVAL_MS = 300;
const SEND_RESULT_TIMEOUT_MS = 6000;

export async function captureWhatsappPresence(
  session: string,
  chatId: string,
): Promise<void> {
  const snapshot = await wahaGetChatPresence(session, chatId);
  const presence =
    snapshot.presences.find((item) => item.participant === chatId) ??
    snapshot.presences[0];
  if (!presence) return;
  await upsertBotUserPresence({
    messenger: "whatsapp-personal",
    userId: chatId,
    status: presence.lastKnownPresence,
    lastSeenAt:
      presence.lastSeen == null ? null : new Date(presence.lastSeen * 1000),
  });
}

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
  connectorId: string;
  target: { kind: "phone" | "username" | "id"; value: string };
  text: string;
}): Promise<{
  ok?: true;
  error?: string;
  telegramUserId?: string;
  externalId?: string;
}> {
  const jobId = crypto.randomUUID();
  await pushOutboundMessage({
    memberId: params.memberId,
    openLineId: params.openLineId,
    connectorId: params.connectorId,
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
        ? {
            ok: true,
            telegramUserId: result.telegramUserId,
            externalId: result.externalId,
          }
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
  connectorId: string;
  jid: string;
  text: string;
}): Promise<{ ok?: true; error?: string; externalId?: string }> {
  const account = await getWhatsappPersonalAccountByConnector(
    params.connectorId,
    params.openLineId,
  );
  if (!account) return { error: "Личный номер WhatsApp не подключён" };

  try {
    const { id } = await wahaSendText(
      account.sessionName,
      params.jid,
      params.text,
    );
    await captureWhatsappPresence(account.sessionName, params.jid).catch(
      (err) =>
        console.error(
          `[whatsapp-personal] не удалось получить presence ${params.jid}: ${(err as Error).message}`,
        ),
    );
    return { ok: true, externalId: id };
  } catch (err) {
    const health = wahaSessionHealth(
      await wahaGetSession(account.sessionName).catch(() => null),
    );
    if (health.status !== "connected") {
      await setWhatsappPersonalAccountStateBySession(
        account.sessionName,
        health.status,
        health.error,
      ).catch(() => {});
    }
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
        status: row.status,
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
 * готовый числовой ID из полей контакта.
 */
function resolvePersonalTarget(
  contact: RawContact,
  phone: string | undefined,
  messengerFields: MessengerFieldCodes,
): PersonalTarget | undefined {
  if (phone) return { kind: "phone", value: phone };

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

  // UF-поля интеграций (Wazzup и др.: TelegramId_WZ, TelegramUsername_WZ…)
  // находятся динамически по всем полям контакта — они нужны и для канала
  // бота (числовой ID ниже), и для личного номера (username/ID, см.
  // resolvePersonalTarget). Раньше канал бота их игнорировал, так что
  // исторические контакты, пришедшие через сторонние интеграции (например,
  // старый Wazzup), не получали канал «Telegram»/«MAX» даже при наличии
  // числового ID, с которым бот технически уже может переписываться.
  const messengerFields = await discoverMessengerFields(api).catch(() => ({
    telegram: [],
    max: [],
  }));

  const channels: WidgetChannel[] = [];
  const telegram = findTelegram(contact, messengerFields.telegram);
  if (telegram?.userId) {
    channels.push({
      messenger: "telegram",
      userId: telegram.userId,
      label: "Telegram",
    });
  }
  const maxId = findMaxId(contact, messengerFields.max);
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
      const personalTarget = resolvePersonalTarget(
        contact,
        phone,
        messengerFields,
      );
      if (personalTarget) {
        for (const account of connectedAccounts) {
          channels.push({
            messenger: "telegram-personal",
            userId: personalTarget.value,
            personalTargetKind: personalTarget.kind,
            lineId: account.openLineId,
            connectorId: account.connectorId,
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
          connectorId: account.connectorId,
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
