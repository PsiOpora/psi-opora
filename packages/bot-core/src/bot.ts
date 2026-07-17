import { env } from "@psi-opora/config";
import type { Redis } from "@upstash/redis";
import type { Api, StorageAdapter } from "grammy";
import { Bot, InlineKeyboard, session } from "grammy";
import { dispatchScenarioOutput } from "./scenario/dispatch";
import {
  applyScenarioAction,
  applyScenarioText,
  isScenarioAction,
  type ScenarioMessage,
  type ScenarioOutput,
  startConsultation,
  startScenario,
} from "./scenario/engine";
import {
  getGuideFile,
  getScenarioTexts,
  type ScenarioTexts,
} from "./scenario/texts";
import type { AppContext, ConsultationSession } from "./types/context";
import { formatUtmLog, parseUtmParams } from "./utils/utm";

export const log = (msg: string) => {
  console.log(`${new Date().toISOString()} ${msg}`);
};

function createInitialSession(): ConsultationSession {
  return { step: "name" };
}

export interface BotOptions {
  storage?: StorageAdapter<ConsultationSession>;
  /** Redis для очереди напоминаний; без него напоминания отключены. */
  redis?: Redis;
  client?: ConstructorParameters<typeof Bot>[1]["client"];
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

  if (message.guide) {
    // PDF-гайд из дашборда: Telegram сам скачивает файл по URL —
    // клиент получает документ в чат насовсем
    try {
      const guide = await getGuideFile();
      if (guide) await api.sendDocument(chatId, guide.url);
    } catch (err) {
      // Текст гайда уже отправлен — без файла диалог не ломаем
      log(`[guide] не удалось отправить PDF в Telegram: ${(err as Error).message}`);
    }
  }
}

export function createBot({ storage, redis, client }: BotOptions = {}) {
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
    await dispatch(ctx, out, texts);
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (!text || text.startsWith("/")) return;

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
    ctx.reply(
      "⚠️ Что-то пошло не так. Попробуйте ещё раз или напишите /start.",
    );
  });

  return bot;
}
