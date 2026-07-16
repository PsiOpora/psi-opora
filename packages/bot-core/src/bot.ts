import { conversations, createConversation } from "@grammyjs/conversations";
import { env } from "@psi-opora/config";
import type { Redis } from "@upstash/redis";
import type { StorageAdapter } from "grammy";
import { Bot, InlineKeyboard, type Middleware, session } from "grammy";
import { consultationConversation } from "./handlers/consultation";
import type { AppContext, ConsultationSession } from "./types/context";
import { trackFunnelStep } from "./utils/funnel";
import {
  CONSENT_DECLINED_TEXT,
  CONSENT_TEXT,
  WELCOME_TEXT,
} from "./utils/messages";
import { formatUtmLog, parseUtmParams } from "./utils/utm";

export const log = (msg: string) => {
  console.log(`${new Date().toISOString()} ${msg}`);
};

function createInitialSession(): ConsultationSession {
  return { step: "name" };
}

export interface BotOptions {
  storage?: StorageAdapter<ConsultationSession>;
  redis?: Redis;
  client?: ConstructorParameters<typeof Bot>[1]["client"];
}

export function createBot({ storage, redis: _redis, client }: BotOptions = {}) {
  const token = env.TG_BOT_TOKEN ?? env.BOT_TOKEN ?? "";
  const bot = new Bot<AppContext>(token, client ? { client } : undefined);

  bot.use(
    session({
      initial: createInitialSession,
      storage,
    }) as Middleware<AppContext>,
  );
  bot.use(conversations() as Middleware<AppContext>);
  bot.use(
    createConversation(
      consultationConversation,
      "consultationConversation",
    ) as Middleware<AppContext>,
  );

  bot.command("start", async (ctx: AppContext) => {
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
    await trackFunnelStep("start", {
      messenger: "telegram",
      source: utm.source,
      campaign: utm.campaign,
    });

    const keyboard = new InlineKeyboard().text(
      "📝 Записаться на консультацию",
      "start_consultation",
    );

    await ctx.reply(WELCOME_TEXT, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  });

  bot.callbackQuery("start_consultation", async (ctx: AppContext) => {
    await ctx.answerCallbackQuery();
    await trackFunnelStep("consult_click", {
      messenger: "telegram",
      source: ctx.session.source,
      campaign: ctx.session.campaign,
    });

    const consentKeyboard = new InlineKeyboard()
      .text("✅ Согласен(а) на обработку данных", "consent_agree")
      .row()
      .text("❌ Не согласен(а)", "consent_decline");

    await ctx.reply(CONSENT_TEXT, {
      parse_mode: "Markdown",
      reply_markup: consentKeyboard,
      link_preview_options: { is_disabled: true },
    });
  });

  bot.callbackQuery("consent_agree", async (ctx: AppContext) => {
    await ctx.answerCallbackQuery("Спасибо! Продолжаем.");
    ctx.session.consentGiven = true;
    log(`[CONSENT] user=${ctx.from?.id} согласился`);
    await trackFunnelStep("consent", {
      messenger: "telegram",
      source: ctx.session.source,
      campaign: ctx.session.campaign,
    });

    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
    await ctx.reply(
      "✅ Согласие получено. Приступим к записи!\n\nКак вас зовут?",
    );
    await ctx.conversation.enter("consultationConversation");
  });

  bot.callbackQuery("consent_decline", async (ctx: AppContext) => {
    await ctx.answerCallbackQuery();
    log(`[CONSENT] user=${ctx.from?.id} отказался`);

    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
    await ctx.reply(CONSENT_DECLINED_TEXT);
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
