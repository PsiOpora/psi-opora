export type Messenger = "telegram" | "max";

/** Inline-кнопка: text — подпись, payload — callback data. */
export interface MessengerButton {
  text: string;
  payload: string;
}

/**
 * Лимиты мессенджеров на отправку от бота:
 * - Telegram Bot API: ~30 сообщений/сек суммарно на бота при массовой
 *   рассылке (и не чаще 1 сообщения/сек в один и тот же чат); при
 *   превышении приходит 429 с parameters.retry_after.
 * - MAX Bot API: точный лимит не публикуется, при превышении — HTTP 429.
 *
 * Держим темп 10 сообщений/сек (пауза 100 мс между отправками) — втрое ниже
 * лимита Telegram, а на 429 дополнительно ждём указанное время и повторяем.
 * Каждому контакту уходит одно сообщение, так что лимит «1/сек в один чат»
 * не нарушается по построению.
 */
export const SEND_INTERVAL_MS = 100;

const RATE_LIMIT_ATTEMPTS = 3;

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Сообщения отправляются с Markdown-разметкой (легаси-режим Telegram:
 * *жирный*, _курсив_, `код`, [ссылка](url); MAX — format "markdown").
 * Если мессенджер отклоняет разметку (400, например непарные символы),
 * сообщение повторно уходит обычным текстом — рассылка не падает.
 */
async function sendTelegram(
  userId: string,
  text: string,
  buttons?: MessengerButton[][],
): Promise<void> {
  const token = process.env.TG_BOT_TOKEN ?? process.env.BOT_TOKEN;
  if (!token) throw new Error("TG_BOT_TOKEN не задан");

  const replyMarkup = buttons?.length
    ? {
        inline_keyboard: buttons.map((row) =>
          row.map((b) => ({ text: b.text, callback_data: b.payload })),
        ),
      }
    : undefined;

  let withMarkdown = true;
  for (let attempt = 1; attempt <= RATE_LIMIT_ATTEMPTS + 1; attempt++) {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: userId,
          text,
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
          ...(withMarkdown ? { parse_mode: "Markdown" } : {}),
        }),
      },
    );
    const json = (await res.json()) as {
      ok: boolean;
      description?: string;
      parameters?: { retry_after?: number };
    };
    if (json.ok) return;
    if (
      res.status === 400 &&
      withMarkdown &&
      /parse entities/i.test(json.description ?? "")
    ) {
      withMarkdown = false;
      continue;
    }
    if (res.status === 429) {
      // Telegram сам говорит, сколько ждать; добавляем секунду сверху
      await sleep(((json.parameters?.retry_after ?? 2) + 1) * 1000);
      continue;
    }
    throw new Error(json.description ?? `Telegram HTTP ${res.status}`);
  }
  throw new Error(
    `Telegram: лимит запросов (429) не снялся после ${RATE_LIMIT_ATTEMPTS} попыток`,
  );
}

async function sendMax(
  userId: string,
  text: string,
  buttons?: MessengerButton[][],
): Promise<void> {
  const token = process.env.MAX_BOT_TOKEN;
  if (!token) throw new Error("MAX_BOT_TOKEN не задан");

  const attachments = buttons?.length
    ? [
        {
          type: "inline_keyboard",
          payload: {
            buttons: buttons.map((row) =>
              row.map((b) => ({
                type: "callback",
                text: b.text,
                payload: b.payload,
              })),
            ),
          },
        },
      ]
    : undefined;

  let withMarkdown = true;
  for (let attempt = 1; attempt <= RATE_LIMIT_ATTEMPTS + 1; attempt++) {
    const url = new URL("https://platform-api2.max.ru/messages");
    url.searchParams.set("user_id", userId);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({
        text,
        ...(attachments ? { attachments } : {}),
        ...(withMarkdown ? { format: "markdown" } : {}),
      }),
    });
    if (res.ok) return;
    if (res.status === 400 && withMarkdown) {
      withMarkdown = false;
      continue;
    }
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitSec =
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter + 1 : 3;
      await sleep(waitSec * 1000);
      continue;
    }
    const json = (await res.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(json?.message ?? `MAX HTTP ${res.status}`);
  }
  throw new Error(
    `MAX: лимит запросов (429) не снялся после ${RATE_LIMIT_ATTEMPTS} попыток`,
  );
}

/** Отправка одного сообщения пользователю мессенджера с обработкой 429. */
export async function sendMessengerMessage(
  messenger: Messenger,
  userId: string,
  text: string,
  buttons?: MessengerButton[][],
): Promise<void> {
  if (messenger === "telegram") await sendTelegram(userId, text, buttons);
  else await sendMax(userId, text, buttons);
}
