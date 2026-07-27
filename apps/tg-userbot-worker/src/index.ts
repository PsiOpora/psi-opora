import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import {
  insertBotMessage,
  listConnectedTelegramPersonalAccounts,
  markTelegramPersonalAccountError,
  type TelegramPersonalAccount,
  upsertBotUser,
} from "@psi-opora/db/queries";
import {
  createUserbotClient,
  decryptSecret,
  drainOutboundMessages,
  listenForMessages,
  resolveClientPhoneNumber,
  resolveClientUsername,
  sendUserbotMessage,
  setSendResult,
} from "@psi-opora/tg-userbot";

const OUTBOX_POLL_INTERVAL_MS = 3000;
const ACCOUNTS_RESCAN_INTERVAL_MS = 60_000;

function accountLabel(account: TelegramPersonalAccount): string {
  return `${account.memberId}:${account.openLineId} (${account.phone})`;
}

/**
 * Журналирует входящее сообщение личного номера в bot_messages/bot_users —
 * без этого единый инбокс дашборда (apps/clients) видел бы только реплики,
 * отправленные из него самого, без единого сообщения от клиента. Не
 * блокирует пересылку в Открытую линию при сбое — только логируется.
 */
async function logInboundMessage(
  senderId: number,
  text: string,
  connectorId: string,
  profile: {
    firstName?: string;
    lastName?: string;
    username?: string | null;
    isPremium?: boolean;
  },
): Promise<void> {
  const userId = String(senderId);
  try {
    await upsertBotUser({
      messenger: "telegram-personal",
      userId,
      firstName: profile.firstName,
      lastName: profile.lastName,
      username: profile.username ?? undefined,
      isPremium: profile.isPremium,
    });
    await insertBotMessage({
      messenger: "telegram-personal",
      userId,
      direction: "in",
      source: "scenario",
      text,
      connectorId,
    });
  } catch (err) {
    console.error(
      `[tg-userbot-worker] не удалось записать входящее сообщение в журнал: ${(err as Error).message}`,
    );
  }
}

/**
 * Дублирует входящее сообщение личного аккаунта в Открытую линию через
 * imconnector.send.messages — CONNECTOR/LINE берутся из самой записи
 * аккаунта (не из env, как у бота: у каждого личного номера своя линия).
 *
 * `user.phone`, когда он виден (не скрыт настройками приватности
 * отправителя), передаём отдельно от `user.id` — по нему CRM-трекер
 * Bitrix ищет и привязывает существующий контакт/лид вместо создания
 * нового «неопознанного» на каждое сообщение (см. «Каждый чат открытых
 * линий связан с объектом CRM» в документации imopenlines).
 */
async function relayInboundMessage(
  account: TelegramPersonalAccount,
  senderId: number,
  senderPhone: string | null,
  chatId: number,
  text: string,
): Promise<void> {
  const api = resolveBitrixApi(account.memberId);
  if (!api) return;

  try {
    await api.call("imconnector.send.messages", {
      CONNECTOR: account.connectorId,
      LINE: Number(account.openLineId),
      MESSAGES: [
        {
          user: {
            id: String(senderId),
            ...(senderPhone ? { phone: senderPhone } : {}),
            skip_phone_validate: "Y",
          },
          message: {
            id: `tg-personal-${senderId}-${Date.now()}`,
            date: Math.floor(Date.now() / 1000),
            text,
          },
          chat: { id: String(chatId), name: `Telegram #${senderId}` },
        },
      ],
    });
  } catch (err) {
    console.error(
      `[tg-userbot-worker] не удалось переслать сообщение в Открытую линию (${accountLabel(account)}): ${(err as Error).message}`,
    );
  }
}

/**
 * Раз в OUTBOX_POLL_INTERVAL_MS вычитывает очередь для этого номера (см.
 * packages/tg-userbot/src/outbox.ts) и отправляет через уже живой
 * MTProto-клиент. Три варианта адресации задачи (по приоритету):
 * 1. telegramUserId уже известен — либо ответ оператора на существующий
 *    диалог (продюсер apps/bitrix-webhook), либо готовый числовой ID из CRM;
 *    передаётся клиенту как есть, mtcute резолвит сам по своему кэшу пиров.
 * 2. phone — первое сообщение клиенту, у которого в CRM есть номер
 *    телефона; резолвится в Telegram-пира через resolveClientPhoneNumber.
 * 3. telegramUsername — то же самое, но по username, когда телефона в CRM
 *    нет; резолвится через resolveClientUsername.
 * Результат каждой задачи пишется в Redis (setSendResult) — так дашборд
 * может дождаться ответа синхронно.
 */
function startOutboxPolling(
  account: TelegramPersonalAccount,
  client: Awaited<ReturnType<typeof createUserbotClient>>,
): void {
  setInterval(async () => {
    const messages = await drainOutboundMessages(
      account.memberId,
      account.openLineId,
      account.connectorId,
    );
    for (const msg of messages) {
      try {
        let target:
          | number
          | Awaited<ReturnType<typeof resolveClientPhoneNumber>>;
        if (msg.telegramUserId) {
          target = msg.telegramUserId;
        } else if (msg.phone) {
          target = await resolveClientPhoneNumber(client, msg.phone);
        } else if (msg.telegramUsername) {
          target = await resolveClientUsername(client, msg.telegramUsername);
        } else {
          throw new Error(
            "В задаче нет ни telegramUserId, ни phone, ни telegramUsername",
          );
        }
        await sendUserbotMessage(client, target, msg.text);
        await setSendResult(msg.jobId, { ok: true });
      } catch (err) {
        const message = (err as Error).message;
        console.error(
          `[tg-userbot-worker] не удалось отправить сообщение (${accountLabel(account)}): ${message}`,
        );
        await setSendResult(msg.jobId, { ok: false, error: message });
      }
    }
  }, OUTBOX_POLL_INTERVAL_MS);
}

async function startAccountWorker(
  account: TelegramPersonalAccount,
): Promise<void> {
  const label = accountLabel(account);

  if (!account.sessionEncrypted) {
    console.error(`[tg-userbot-worker] нет сохранённой сессии: ${label}`);
    return;
  }

  try {
    const session = decryptSecret(account.sessionEncrypted);
    const apiHash = decryptSecret(account.apiHashEncrypted);
    const client = await createUserbotClient(session, {
      apiId: Number(account.apiId),
      apiHash,
    });

    listenForMessages(client, (message) => {
      const text = message.text;
      if (!text) return;
      const rawPhone =
        "phoneNumber" in message.sender ? message.sender.phoneNumber : null;
      const senderPhone = rawPhone
        ? rawPhone.startsWith("+")
          ? rawPhone
          : `+${rawPhone}`
        : null;
      void logInboundMessage(message.sender.id, text, account.connectorId, {
        firstName:
          "firstName" in message.sender ? message.sender.firstName : undefined,
        lastName:
          "lastName" in message.sender
            ? (message.sender.lastName ?? undefined)
            : undefined,
        username: message.sender.username,
        isPremium:
          "isPremium" in message.sender ? message.sender.isPremium : undefined,
      });
      void relayInboundMessage(
        account,
        message.sender.id,
        senderPhone,
        message.chat.id,
        text,
      );
    });

    startOutboxPolling(account, client);
    console.log(`[tg-userbot-worker] запущен: ${label}`);
  } catch (err) {
    const message = (err as Error).message;
    console.error(
      `[tg-userbot-worker] не удалось запустить ${label}: ${message}`,
    );
    await markTelegramPersonalAccountError(
      account.memberId,
      account.openLineId,
      account.connectorId,
      message,
    );
  }
}

/**
 * Периодически перечитывает список подключённых номеров и поднимает
 * клиента для тех, кого ещё не запускали — так новый номер, подключённый
 * уже после старта воркера, подхватывается без перезапуска процесса.
 * Процесс держится живым за счёт этого таймера, даже если номеров пока нет.
 */
async function main(): Promise<void> {
  const started = new Set<string>();

  const scan = async () => {
    const accounts = await listConnectedTelegramPersonalAccounts();
    for (const account of accounts) {
      const key = `${account.memberId}:${account.openLineId}:${account.connectorId}`;
      if (started.has(key)) continue;
      started.add(key);
      void startAccountWorker(account);
    }
  };

  await scan();
  setInterval(scan, ACCOUNTS_RESCAN_INTERVAL_MS);
}

await main();
