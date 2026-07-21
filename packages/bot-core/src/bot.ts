import { env } from "@psi-opora/config";
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
import { type BitrixApiLike, sendMessageToOpenLine } from "./utils/bitrix";
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
 * Сохраняет профиль клиента в bot_users: поля из апдейта (всегда доступны)
 * плюс bio/фото из getChat (может не сработать из-за приватности — не критично).
 */
async function collectTelegramProfile(
  ctx: AppContext,
  source: string | undefined,
  campaign: string | undefined,
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
    await api.sendMessage(chatId, message.text, {
      ...options,
      parse_mode: "Markdown",
    });
  } catch {
    await api.sendMessage(chatId, message.text, options);
  }
  // PDF-гайд в Telegram отдельным документом не шлём — он уходит вложением
  // на email (см. dispatchScenarioOutput/sendGuideEmail)
}

export function createBot({
  storage,
  redis,
  client,
  bitrixApi,
}: BotOptions = {}) {
  const token = env.TG_BOT_TOKEN ?? env.BOT_TOKEN ?? "";
  const bot = new Bot<AppContext>(token, client ? { client } : undefined);

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
    await collectTelegramProfile(ctx, ctx.session.source, ctx.session.campaign);

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

  bot.catch((err) => {
    const ctx = err.ctx as AppContext;
    log(`[ERROR] update_id=${ctx.update.update_id} ${err.error}`);
    ctx.reply("⚠️ Что-то пошло не так. Попробуйте ещё раз или напишите /start.");
  });

  return bot;
}
