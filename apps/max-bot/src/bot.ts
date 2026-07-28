import { Bot, Context, Keyboard, type MiddlewareFn } from "@maxhub/max-bot-api";
import type { RedisClient } from "@psi-opora/bot-core";
import {
  actionLabel,
  applyScenarioAction,
  applyScenarioText,
  type BitrixApiLike,
  type ConsultationSession,
  dispatchScenarioOutput,
  formatUtmLog,
  getGuideFile,
  getScenarioTexts,
  logBotMessage,
  parseUtmParams,
  SCENARIO_ACTIONS,
  type ScenarioMessage,
  type ScenarioOutput,
  type ScenarioTexts,
  type StorageAdapter,
  sendMessageToOpenLine,
  setFunnelUpsert,
  startConsultation,
  startScenario,
  triageOffScriptMessage,
  upsertBotUserProfile,
  withUserLock,
} from "@psi-opora/bot-core";
import { logger } from "@psi-opora/config";
import { upsertBotFunnelEvent } from "@psi-opora/db/queries";
import { uploadMaxAvatar, uploadMaxMedia } from "./avatar-storage.js";

// MAX-бот работает в Node.js-поде k3s и подключается к обычному PostgreSQL.
setFunnelUpsert(upsertBotFunnelEvent);

export const log = (msg: string) => {
  console.log(`${new Date().toISOString()} ${msg}`);
};

function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  return cause
    ? `${err.message} (cause: ${describeError(cause)})`
    : err.message;
}

function isChatNotFoundError(err: unknown): boolean {
  return (err as { status?: number } | null)?.status === 404;
}

// Отправка через user_id с повторами: сразу после bot_started диалог
// в MAX иногда ещё не успевает создаться на их стороне — 404 в первую
// попытку, но появляется через секунду-другую.
async function sendToUserWithRetry(
  ctx: AppContext,
  userId: number,
  text: string,
  options?: Parameters<AppContext["reply"]>[1],
): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await ctx.api.sendMessageToUser(userId, text, options);
      return;
    } catch (err) {
      if (!isChatNotFoundError(err) || attempt === 3) throw err;
      await sleep(1000 * attempt);
    }
  }
}

// Общий хелпер: отправка ответа с fallback на user_id,
// если чат не существует (404) — например, пользователь удалил
// переписку с ботом или это устаревший апдейт.
async function replyWithFallback(
  ctx: AppContext,
  text: string,
  options?: Parameters<AppContext["reply"]>[1],
): Promise<void> {
  const userId = ctx.user?.user_id;
  if (!ctx.chatId && userId) {
    await sendToUserWithRetry(ctx, userId, text, options);
    return;
  }
  try {
    await ctx.reply(text, options);
  } catch (err) {
    if (isChatNotFoundError(err) && userId) {
      await sendToUserWithRetry(ctx, userId, text, options);
      return;
    }
    throw err;
  }
}

export class AppContext extends Context {
  session!: ConsultationSession;
}

export interface MaxBotOptions {
  storage?: StorageAdapter<ConsultationSession>;
  /** Redis для очереди напоминаний; без него напоминания отключены. */
  redis?: RedisClient;
  /** OAuth-клиент Bitrix24 (resolveBitrixApi из @psi-opora/bitrix-client) —
   * для дублирования переписки в Открытую линию. Без него дублирование
   * отключено (см. sendMessageToOpenLine). */
  bitrixApi?: BitrixApiLike;
  /** Токен бота — достаётся из БД (resolveMaxBotToken из @psi-opora/bot-core)
   * раньше вызова createMaxBot; без него бот не создать. */
  token?: string;
}

function createInitialSession(): ConsultationSession {
  return { step: "name" };
}

function sessionKeyOf(ctx: AppContext): string {
  return String(ctx.user?.user_id ?? ctx.chatId ?? "anon");
}

/**
 * Скачивает аватар клиента с CDN MAX и перезаливает в наше S3 (см.
 * ./avatar-storage.ts) — max-bot работает как обычный Node.js-сервер в k3s,
 * никаких Edge-ограничений тут нет. При любой ошибке возвращает undefined —
 * вызывающий код тогда сохранит исходный hotlink на CDN MAX вместо
 * перезалитого файла.
 */
async function syncMaxAvatar(
  userId: number,
  sourceUrl: string,
): Promise<{ avatarUrl: string; avatarS3Key: string } | undefined> {
  try {
    const res = await fetch(sourceUrl);
    if (!res.ok) throw new Error(`источник недоступен: HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") || "image/jpeg";
    return await uploadMaxAvatar({ bytes, contentType, userId });
  } catch (err) {
    log(
      `[profile] не удалось перезалить аватар для user=${userId}: ${describeError(err)}`,
    );
    return undefined;
  }
}

/**
 * Сохраняет профиль клиента в bot_users: поля из апдейта (всегда доступны)
 * плюс description/avatar из getChatMembers (не работает для диалога 1:1 —
 * MAX отдаёт 400 "Method is not available for dialogs", этот метод годится
 * только для групповых чатов). Для 1:1 добираем аватар через getChat: там
 * поле icon для диалога — это фото собеседника, а не иконка чата.
 */
async function collectMaxProfile(
  ctx: AppContext,
  source: string | undefined,
  campaign: string | undefined,
): Promise<void> {
  const user = ctx.user;
  if (!user) return;

  const userLocale = (ctx.update as { user_locale?: unknown }).user_locale;

  let bio: string | undefined;
  let avatarUrl: string | undefined;
  let avatarS3Key: string | undefined;
  let rawProfile: unknown = user;
  try {
    const { members } = await ctx.getChatMembers({ user_ids: [user.user_id] });
    const member = members[0];
    if (member) {
      rawProfile = member;
      bio = member.description ?? undefined;
      avatarUrl = member.avatar_url;
    }
  } catch (err) {
    log(
      `[profile] не удалось получить getChatMembers для user=${user.user_id}: ${describeError(err)}`,
    );
  }

  if (!avatarUrl && ctx.chatId) {
    try {
      const chat = await ctx.getChat(ctx.chatId);
      if (chat.icon?.url) avatarUrl = chat.icon.url;
    } catch (err) {
      log(
        `[profile] не удалось получить getChat для user=${user.user_id}: ${describeError(err)}`,
      );
    }
  }

  if (avatarUrl) {
    const uploaded = await syncMaxAvatar(user.user_id, avatarUrl);
    if (uploaded) {
      avatarUrl = uploaded.avatarUrl;
      avatarS3Key = uploaded.avatarS3Key;
    }
  }

  await upsertBotUserProfile({
    messenger: "max",
    userId: user.user_id,
    name: user.name,
    username: user.username ?? undefined,
    isBot: user.is_bot,
    languageCode: typeof userLocale === "string" ? userLocale : undefined,
    bio,
    avatarUrl,
    avatarS3Key,
    source,
    campaign,
    rawProfile,
  });
}

function sessionMiddleware(
  storage: StorageAdapter<ConsultationSession> | undefined,
): MiddlewareFn<AppContext> {
  const memory = new Map<string, ConsultationSession>();
  return async (ctx, next) => {
    const key = sessionKeyOf(ctx);
    const existing = storage ? await storage.read(key) : memory.get(key);
    ctx.session = existing ?? createInitialSession();
    await next();
    if (storage) await storage.write(key, ctx.session);
    else memory.set(key, ctx.session);
  };
}

function toMaxKeyboard(message: ScenarioMessage) {
  if (!message.buttons?.length) return undefined;
  return Keyboard.inlineKeyboard(
    message.buttons.map((row) =>
      row.map((button) =>
        Keyboard.button.callback(button.label, button.action),
      ),
    ),
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Отправка PDF-гайда в MAX: скачиваем файл с дашборда, загружаем через
 * uploads API и отправляем вложением. Свежезагруженное вложение может быть
 * ещё не готово («attachment not ready») — повторяем отправку с паузой.
 */
async function sendMaxGuideFile(
  ctx: AppContext,
  guide: { url: string; name: string },
): Promise<void> {
  const fileRes = await fetch(guide.url);
  if (!fileRes.ok) throw new Error(`гайд недоступен: HTTP ${fileRes.status}`);
  const bytes = await fileRes.arrayBuffer();

  const upload = await ctx.api.raw.uploads.getUploadUrl({ type: "file" });
  const form = new FormData();
  form.append(
    "data",
    new Blob([bytes], { type: "application/pdf" }),
    guide.name,
  );
  const uploadRes = await fetch(upload.url, { method: "POST", body: form });
  if (!uploadRes.ok) {
    throw new Error(`загрузка в MAX не удалась: HTTP ${uploadRes.status}`);
  }
  const uploaded = (await uploadRes.json().catch(() => null)) as {
    token?: string;
  } | null;
  const token = uploaded?.token ?? upload.token;
  if (!token) throw new Error("MAX не вернул token вложения");

  const attachments = [{ type: "file" as const, payload: { token } }];
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await replyWithFallback(ctx, `📎 ${guide.name}`, { attachments });
      return;
    } catch (err) {
      lastError = err;
      await sleep(1500);
    }
  }
  throw lastError;
}

export type MaxBot = Bot<AppContext>;

export function createMaxBot({
  storage,
  redis,
  bitrixApi,
  token,
}: MaxBotOptions = {}): MaxBot {
  const resolvedToken = token || "";
  const bot = new Bot<AppContext>(resolvedToken, { contextType: AppContext });

  // Сериализуем обработку апдейтов одного пользователя (см.
  // @psi-opora/bot-core/utils/lock.ts) — без этого чтение и запись сессии
  // двумя раздельными Redis-вызовами (sessionMiddleware ниже) гонятся при
  // двух почти одновременных апдейтах (двойной тап по кнопке, повторная
  // доставка вебхука) и дают зацикливание шагов сценария/задвоенные заявки.
  bot.use(async (ctx, next) => {
    await withUserLock(redis, `max:${sessionKeyOf(ctx)}`, next);
  });

  bot.use(sessionMiddleware(storage));

  const replyScenarioMessage = async (
    ctx: AppContext,
    message: ScenarioMessage,
  ) => {
    const keyboard = toMaxKeyboard(message);
    const attachments = keyboard ? [keyboard] : undefined;
    const userId = ctx.user?.user_id;
    try {
      try {
        await replyWithFallback(ctx, message.text, {
          format: "markdown",
          attachments,
        });
      } catch {
        await replyWithFallback(ctx, message.text, { attachments });
      }
      logger.info("bot.scenario_message.sent", { messenger: "max", userId });
    } catch (err) {
      logger.error("bot.scenario_message.failed", err, {
        messenger: "max",
        userId,
      });
      throw err;
    }

    if (message.guide) {
      try {
        const guide = await getGuideFile();
        if (guide) await sendMaxGuideFile(ctx, guide);
      } catch (err) {
        // Текст гайда уже отправлен — без файла диалог не ломаем
        log(`[guide] не удалось отправить PDF в MAX: ${describeError(err)}`);
      }
    }
  };

  const dispatch = async (
    ctx: AppContext,
    out: ScenarioOutput,
    texts: ScenarioTexts,
  ) => {
    ctx.session.scenario = out.state;
    await dispatchScenarioOutput(out, {
      messenger: "max",
      sessionKey: sessionKeyOf(ctx),
      // Bitrix-коннектор получает в качестве chat.id именно user_id (см.
      // комментарий у sendMessageToOpenLine ниже) — тот же ID используем
      // здесь для поиска диалога через USER_CODE.
      chatId: ctx.user?.user_id,
      redis,
      texts,
      sendMessage: (message) => replyScenarioMessage(ctx, message),
      userName: ctx.user?.name,
      userId: ctx.user?.user_id,
      source: ctx.session.source,
      campaign: ctx.session.campaign,
    });
  };

  async function handleStart(
    ctx: AppContext,
    startPayload: string | undefined,
  ) {
    const utm = parseUtmParams(startPayload);
    if (utm.campaign) ctx.session.campaign = utm.campaign;
    if (utm.source) ctx.session.source = utm.source;

    log(
      `[START] user=${ctx.user?.user_id} chat=${ctx.chatId} ${formatUtmLog(utm)} messenger=max`,
    );
    await logBotMessage({
      messenger: "max",
      userId: ctx.user?.user_id,
      direction: "in",
      source: "scenario",
      text: startPayload ? `/start ${startPayload}` : "/start",
    });
    await collectMaxProfile(ctx, ctx.session.source, ctx.session.campaign);

    const texts = await getScenarioTexts();
    await dispatch(ctx, startScenario(texts), texts);
  }

  bot.on("bot_started", (ctx) =>
    handleStart(
      ctx as AppContext,
      (ctx as unknown as { startPayload?: string | null }).startPayload ??
        undefined,
    ),
  );
  bot.command("start", (ctx) => handleStart(ctx as AppContext, undefined));

  // Кнопка «Записаться» из сообщений старого бота — сразу в флоу записи
  bot.action("start_consultation", async (ctx) => {
    const appCtx = ctx as AppContext;
    await appCtx.answerOnCallback({}).catch(() => {});
    const texts = await getScenarioTexts();
    await logBotMessage({
      messenger: "max",
      userId: appCtx.user?.user_id,
      direction: "in",
      source: "scenario",
      text: texts.btn_consult,
    });
    await dispatch(appCtx, startConsultation(texts), texts);
  });

  for (const action of SCENARIO_ACTIONS) {
    bot.action(action, async (ctx) => {
      const appCtx = ctx as AppContext;
      await appCtx.answerOnCallback({}).catch(() => {});

      const texts = await getScenarioTexts();
      const state = appCtx.session.scenario;
      let out = state ? applyScenarioAction(state, action, texts) : null;
      // Согласие из старого сообщения без активного сценария —
      // начинаем запись заново (показываем актуальное согласие)
      if (!out && action === "consent_agree") {
        out = startConsultation(texts);
      }
      // null — кнопка от прошлого шага (устаревшее сообщение), игнорируем
      if (!out) return;

      log(
        `[SCENARIO] user=${appCtx.user?.user_id} action=${action} messenger=max`,
      );
      await logBotMessage({
        messenger: "max",
        userId: appCtx.user?.user_id,
        direction: "in",
        source: "scenario",
        text: actionLabel(action, texts),
      });
      await dispatch(appCtx, out, texts);
    });
  }

  bot.on("message_created", async (ctx) => {
    const appCtx = ctx as unknown as AppContext;
    const text = appCtx.message?.body.text?.trim() ?? "";
    const audioAttachment = appCtx.message?.body.attachments?.find(
      (a) => a.type === "audio",
    ) as { type: "audio"; payload: { url: string; token: string } } | undefined;
    if (!text && !audioAttachment) return;
    if (!audioAttachment && text.startsWith("/")) return;

    // В журнал попадают все входящие — даже вне сценария
    const userId = appCtx.user?.user_id ?? appCtx.message?.sender?.user_id;

    // Голосовое/аудио-вложение — перезаливаем в наше S3, чтобы инбокс
    // «Клиенты» показывал плеер, а не молчал (без вложения пустой text
    // раньше отбрасывался ранним return выше).
    let mediaS3Key: string | undefined;
    let mediaMimeType: string | undefined;
    if (audioAttachment) {
      try {
        const res = await fetch(audioAttachment.payload.url);
        if (res.ok) {
          const bytes = new Uint8Array(await res.arrayBuffer());
          mediaMimeType = res.headers.get("content-type") || "audio/mp4";
          const uploaded = await uploadMaxMedia({
            bytes,
            contentType: mediaMimeType,
            attachmentId: String(appCtx.message?.body.mid ?? Date.now()),
          });
          mediaS3Key = uploaded.mediaS3Key;
        }
      } catch (err) {
        console.error(
          `[media] не удалось перезалить аудио user=${userId}: ${(err as Error).message}`,
        );
      }
    }

    await logBotMessage({
      messenger: "max",
      userId,
      direction: "in",
      source: "scenario",
      text: text || (audioAttachment ? "Голосовое сообщение" : ""),
      ...(mediaS3Key ? { kind: "voice", mediaS3Key, mediaMimeType } : {}),
    });

    // Дублируем в Открытую линию Bitrix24 — вся переписка видна оператору,
    // и он может ответить прямо оттуда (см. sendMessageToOpenLine). В качестве
    // внешнего chat.id передаём user_id, а не MAX chat_id: обратная отправка
    // (sendMessengerMessage → MAX API messages.send) адресуется по user_id,
    // так что для маршрутизации ответа назад нужен именно он.
    if (userId) {
      await sendMessageToOpenLine(bitrixApi, {
        messenger: "max",
        userId,
        chatId: userId,
        text,
        name: appCtx.user?.name,
        ...(audioAttachment
          ? { files: [{ url: audioAttachment.payload.url, name: "audio" }] }
          : {}),
      });
    }

    if (!text) return;

    const state = appCtx.session.scenario;
    if (!state) {
      if (userId) {
        await triageOffScriptMessage({
          messenger: "max",
          userId: String(userId),
          text,
        });
      }
      return;
    }

    const texts = await getScenarioTexts();
    const out = await applyScenarioText(state, text, texts);
    if (!out) {
      // Сообщение не подошло ни под один ожидаемый на этом шаге ввод (клиент
      // пишет что-то своё, а не то, что просит сценарий) — бот здесь не
      // пытается сам помочь/ответить, только тихо решает, стоит ли передать
      // его оператору с пометкой (см. triageOffScriptMessage).
      if (userId) {
        await triageOffScriptMessage({
          messenger: "max",
          userId: String(userId),
          text,
        });
      }
      return;
    }

    await dispatch(appCtx, out, texts);
  });

  bot.catch((err, ctx) => {
    log(`[ERROR] update=${ctx.updateType} ${describeError(err)}`);
    replyWithFallback(
      ctx as AppContext,
      "⚠️ Что-то пошло не так. Попробуйте ещё раз или напишите /start.",
    ).catch(() => {});
  });

  return bot;
}

/**
 * Обработка webhook-апдейта через внутренний метод Bot.
 * handleUpdate приватный, но доступен через (bot as any).handleUpdate.
 * Это корректнее ручного создания контекста, т.к. использует
 * ту же логику, что и при long-polling.
 */
export async function processUpdate(
  bot: MaxBot,
  update: unknown,
): Promise<void> {
  await (
    bot as unknown as { handleUpdate(update: unknown): Promise<void> }
  ).handleUpdate(update);
}
