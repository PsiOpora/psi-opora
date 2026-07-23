import { logger } from "@psi-opora/config";
import type { Redis } from "@upstash/redis";
import type { Api, StorageAdapter } from "grammy";
import { Bot, InlineKeyboard, session } from "grammy";
import { dispatchScenarioOutput } from "./scenario/dispatch";
import {
  actionLabel,
  applyScenarioAction,
  applyScenarioText,
  isScenarioAction,
  type ScenarioMessage,
  type ScenarioOutput,
  startConsultation,
  startScenario,
} from "./scenario/engine";
import { getScenarioTexts, type ScenarioTexts } from "./scenario/texts";
import type { AppContext, ConsultationSession } from "./types/context";
import {
  type BitrixApiLike,
  sendMessageToOpenLine,
  updateMessageInOpenLine,
} from "./utils/bitrix";
import { logBotMessage } from "./utils/message-log";
import { upsertBotUserProfile } from "./utils/user-profile";
import { formatUtmLog, parseUtmParams } from "./utils/utm";

export const log = (msg: string) => {
  console.log(`${new Date().toISOString()} ${msg}`);
};

function createInitialSession(): ConsultationSession {
  return { step: "name" };
}

/**
 * Результат перезаливки аватара пользователя в собственное хранилище —
 * возвращается инжектируемым uploadAvatar (см. BotOptions), т.к. bot-core
 * должен оставаться совместимым с Edge Runtime (см. avatarUploader ниже)
 * и не может напрямую тянуть S3-клиент/node-postgres.
 */
export interface AvatarUploadResult {
  avatarUrl: string;
  avatarS3Key: string;
}

/**
 * Скачивает и перезаливает аватар пользователя в наше хранилище — инжектируется
 * извне (apps/tg-bot), т.к. требует S3-клиента и getBackupCredentials
 * (node-postgres), которые нельзя тянуть в bot-core: этот пакет собирается и в
 * Edge Runtime (max-bot), где node-postgres не работает.
 */
export type AvatarUploader = (params: {
  bytes: Uint8Array;
  contentType: string;
  messenger: "telegram";
  userId: number;
}) => Promise<AvatarUploadResult>;

/**
 * Сохраняет профиль клиента в bot_users: поля из апдейта (всегда доступны)
 * плюс bio/фото из getChat (может не сработать из-за приватности — не критично).
 */
async function collectTelegramProfile(
  ctx: AppContext,
  source: string | undefined,
  campaign: string | undefined,
  token: string,
  uploadAvatar: AvatarUploader | undefined,
): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  let bio: string | undefined;
  let photoFileId: string | undefined;
  let rawProfile: unknown;
  try {
    const chat = await ctx.api.getChat(from.id);
    rawProfile = chat;
    if (chat.type === "private") {
      bio = chat.bio;
      photoFileId = chat.photo?.big_file_id;
    }
  } catch (err) {
    console.error(
      `[profile] не удалось получить getChat для user=${from.id}: ${(err as Error).message}`,
    );
  }

  let avatarUrl: string | undefined;
  let avatarS3Key: string | undefined;
  if (photoFileId && uploadAvatar) {
    try {
      const url = await resolveTelegramFileUrl(ctx.api, token, photoFileId);
      if (url) {
        const res = await fetch(url);
        if (res.ok) {
          const bytes = new Uint8Array(await res.arrayBuffer());
          const contentType = res.headers.get("content-type") || "image/jpeg";
          const uploaded = await uploadAvatar({
            bytes,
            contentType,
            messenger: "telegram",
            userId: from.id,
          });
          avatarUrl = uploaded.avatarUrl;
          avatarS3Key = uploaded.avatarS3Key;
        }
      }
    } catch (err) {
      console.error(
        `[profile] не удалось скачать аватар для user=${from.id}: ${(err as Error).message}`,
      );
    }
  }

  await upsertBotUserProfile({
    messenger: "telegram",
    userId: from.id,
    firstName: from.first_name,
    lastName: from.last_name,
    username: from.username,
    languageCode: from.language_code,
    isPremium: from.is_premium,
    isBot: from.is_bot,
    bio,
    photoFileId,
    avatarUrl,
    avatarS3Key,
    source,
    campaign,
    rawProfile,
  });
}

export interface BotOptions {
  storage?: StorageAdapter<ConsultationSession>;
  /** Redis для очереди напоминаний; без него напоминания отключены. */
  redis?: Redis;
  client?: ConstructorParameters<typeof Bot>[1]["client"];
  /** OAuth-клиент Bitrix24 (resolveBitrixApi из @psi-opora/bitrix-client) —
   * для дублирования переписки в Открытую линию. Без него дублирование
   * отключено (см. sendMessageToOpenLine). */
  bitrixApi?: BitrixApiLike;
  /** Токен бота — достаётся из БД (resolveTelegramBotToken в utils/token.ts)
   * раньше вызова createBot; без него бот не создать. */
  token?: string;
  /** Перезаливка аватара клиента в наше S3 (см. AvatarUploader). Без неё
   * аватар Telegram не сохраняется — только временный photoFileId. */
  uploadAvatar?: AvatarUploader;
}

function toInlineKeyboard(
  message: ScenarioMessage,
): InlineKeyboard | undefined {
  if (!message.buttons?.length) return undefined;
  const keyboard = new InlineKeyboard();
  message.buttons.forEach((row, index) => {
    if (index > 0) keyboard.row();
    for (const button of row) keyboard.text(button.label, button.action);
  });
  return keyboard;
}

/**
 * Отправка сообщения сценария в Telegram. Markdown из дашборда может быть
 * невалидным — при ошибке парсинга отправляем как обычный текст.
 */
export async function sendTelegramScenarioMessage(
  api: Api,
  chatId: number,
  message: ScenarioMessage,
): Promise<void> {
  const keyboard = toInlineKeyboard(message);
  const options = {
    reply_markup: keyboard,
    link_preview_options: { is_disabled: true },
  };
  try {
    try {
      await api.sendMessage(chatId, message.text, {
        ...options,
        parse_mode: "Markdown",
      });
    } catch {
      await api.sendMessage(chatId, message.text, options);
    }
    logger.info("bot.scenario_message.sent", { messenger: "telegram", chatId });
  } catch (err) {
    logger.error("bot.scenario_message.failed", err, {
      messenger: "telegram",
      chatId,
    });
    throw err;
  }
  // PDF-гайд в Telegram отдельным документом не шлём — он уходит вложением
  // на email (см. dispatchScenarioOutput/sendGuideEmail)
}

/**
 * Строит прямую (временную) ссылку на файл Telegram для пересылки вложения
 * в Открытую линию (message.files в imconnector.send.messages). Ссылка
 * держится ограниченное время — этого достаточно, чтобы оператор открыл её
 * вскоре после получения; постоянного хранилища для вложений бота нет.
 */
async function resolveTelegramFileUrl(
  api: Api,
  token: string,
  fileId: string,
): Promise<string | null> {
  try {
    const file = await api.getFile(fileId);
    if (!file.file_path) return null;
    return `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  } catch (err) {
    console.error(
      `[bitrix] не удалось получить ссылку на файл Telegram: ${(err as Error).message}`,
    );
    return null;
  }
}

export function createBot({
  storage,
  redis,
  client,
  bitrixApi,
  token,
  uploadAvatar,
}: BotOptions = {}) {
  const resolvedToken = token || "";
  const bot = new Bot<AppContext>(resolvedToken, client ? { client } : undefined);

  bot.use(
    session({
      initial: createInitialSession,
      storage,
    }),
  );

  const dispatch = async (
    ctx: AppContext,
    out: ScenarioOutput,
    texts: ScenarioTexts,
  ) => {
    const chatId = ctx.chatId;
    if (!chatId) return;
    ctx.session.scenario = out.state;
    await dispatchScenarioOutput(out, {
      messenger: "telegram",
      sessionKey: String(chatId),
      chatId,
      redis,
      texts,
      sendMessage: (message) =>
        sendTelegramScenarioMessage(ctx.api, chatId, message),
      userName: [ctx.from?.first_name, ctx.from?.last_name]
        .filter(Boolean)
        .join(" "),
      userId: ctx.from?.id,
      source: ctx.session.source,
      campaign: ctx.session.campaign,
    });
  };

  bot.command("start", async (ctx) => {
    const rawParam = typeof ctx.match === "string" ? ctx.match : undefined;
    const utm = parseUtmParams(rawParam);

    if (utm.campaign) {
      ctx.session.campaign = utm.campaign;
    }
    if (utm.source) {
      ctx.session.source = utm.source;
    }

    log(
      `[START] user=${ctx.from?.id} chat=${ctx.chat?.id} ${formatUtmLog(utm)} messenger=telegram`,
    );
    await logBotMessage({
      messenger: "telegram",
      userId: ctx.from?.id,
      direction: "in",
      source: "scenario",
      text: rawParam ? `/start ${rawParam}` : "/start",
    });
    await collectTelegramProfile(
      ctx,
      ctx.session.source,
      ctx.session.campaign,
      resolvedToken,
      uploadAvatar,
    );

    const texts = await getScenarioTexts();
    await dispatch(ctx, startScenario(texts), texts);
  });

  bot.on("callback_query:data", async (ctx) => {
    const action = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery();

    const texts = await getScenarioTexts();
    let out: ScenarioOutput | null = null;

    if (action === "start_consultation") {
      // Кнопка «Записаться» из сообщений старого бота — сразу в флоу записи
      out = startConsultation(texts);
    } else if (isScenarioAction(action)) {
      const state = ctx.session.scenario;
      out = state ? applyScenarioAction(state, action, texts) : null;
      // Согласие из старого сообщения без активного сценария —
      // начинаем запись заново (показываем актуальное согласие)
      if (!out && action === "consent_agree") {
        out = startConsultation(texts);
      }
    }

    // null — кнопка от прошлого шага (устаревшее сообщение), игнорируем
    if (!out) return;

    // Убираем кнопки с нажатого сообщения, чтобы не нажали повторно
    await ctx
      .editMessageReplyMarkup({ reply_markup: undefined })
      .catch(() => {});

    log(`[SCENARIO] user=${ctx.from?.id} action=${action} messenger=telegram`);
    await logBotMessage({
      messenger: "telegram",
      userId: ctx.from?.id,
      direction: "in",
      source: "scenario",
      text: isScenarioAction(action)
        ? actionLabel(action, texts)
        : texts.btn_consult,
    });
    await dispatch(ctx, out, texts);
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (!text || text.startsWith("/")) return;

    // В журнал попадают все входящие — даже вне сценария
    await logBotMessage({
      messenger: "telegram",
      userId: ctx.from?.id,
      direction: "in",
      source: "scenario",
      text,
    });

    // Дублируем в Открытую линию Bitrix24 — вся переписка видна оператору,
    // и он может ответить прямо оттуда (см. sendMessageToOpenLine).
    if (ctx.chatId && ctx.from) {
      await sendMessageToOpenLine(bitrixApi, {
        messenger: "telegram",
        userId: ctx.from.id,
        chatId: ctx.chatId,
        text,
        messageId: ctx.message.message_id,
        name: [ctx.from.first_name, ctx.from.last_name]
          .filter(Boolean)
          .join(" "),
      });
    }

    const state = ctx.session.scenario;
    if (!state) return;

    const texts = await getScenarioTexts();
    const out = applyScenarioText(state, text, texts);
    if (!out) return;

    await dispatch(ctx, out, texts);
  });

  // Клиент отредактировал уже отправленное сообщение — пересылаем правку
  // в Открытую линию (см. updateMessageInOpenLine), чтобы оператор видел
  // актуальный текст, а не устаревший. Telegram Bot API не сообщает об
  // удалении сообщений клиентом — такие правки в Открытую линию попасть
  // не могут, это ограничение платформы, а не пробел в реализации.
  bot.on("edited_message:text", async (ctx) => {
    const text = ctx.editedMessage.text.trim();
    if (!text || !ctx.chatId || !ctx.from) return;

    await updateMessageInOpenLine(bitrixApi, {
      messenger: "telegram",
      userId: ctx.from.id,
      chatId: ctx.chatId,
      text,
      messageId: ctx.editedMessage.message_id,
      name: [ctx.from.first_name, ctx.from.last_name]
        .filter(Boolean)
        .join(" "),
    });
  });

  // Фото/документы/голосовые/видео — пересылаем как вложение в Открытую
  // линию (message.files), в сценарий бота эти сообщения не попадают:
  // все шаги сценария текстовые, вложения тут не ожидаются.
  bot.on(
    ["message:photo", "message:document", "message:voice", "message:video", "message:audio"],
    async (ctx) => {
      if (!ctx.chatId || !ctx.from) return;
      const caption = ctx.message.caption?.trim() ?? "";

      let fileId: string | undefined;
      let fileName = "file";
      if (ctx.message.photo) {
        fileId = ctx.message.photo[ctx.message.photo.length - 1]?.file_id;
        fileName = "photo.jpg";
      } else if (ctx.message.document) {
        fileId = ctx.message.document.file_id;
        fileName = ctx.message.document.file_name ?? "document";
      } else if (ctx.message.voice) {
        fileId = ctx.message.voice.file_id;
        fileName = "voice.ogg";
      } else if (ctx.message.video) {
        fileId = ctx.message.video.file_id;
        fileName = "video.mp4";
      } else if (ctx.message.audio) {
        fileId = ctx.message.audio.file_id;
        fileName = ctx.message.audio.file_name ?? "audio.mp3";
      }
      if (!fileId) return;

      await logBotMessage({
        messenger: "telegram",
        userId: ctx.from.id,
        direction: "in",
        source: "scenario",
        text: caption || `[${fileName}]`,
      });

      const url = await resolveTelegramFileUrl(ctx.api, resolvedToken, fileId);
      if (!url) return;

      await sendMessageToOpenLine(bitrixApi, {
        messenger: "telegram",
        userId: ctx.from.id,
        chatId: ctx.chatId,
        text: caption,
        messageId: ctx.message.message_id,
        files: [{ url, name: fileName }],
        name: [ctx.from.first_name, ctx.from.last_name]
          .filter(Boolean)
          .join(" "),
      });
    },
  );

  bot.catch((err) => {
    const ctx = err.ctx as AppContext;
    log(`[ERROR] update_id=${ctx.update.update_id} ${err.error}`);
    ctx.reply("⚠️ Что-то пошло не так. Попробуйте ещё раз или напишите /start.");
  });

  return bot;
}
