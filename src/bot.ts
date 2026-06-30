import "dotenv/config";
import { Bot, session, InlineKeyboard, type Middleware } from "grammy";
import { conversations, createConversation } from "@grammyjs/conversations";
import type { StorageAdapter } from "grammy";
import type { AppContext, ConsultationSession } from "./types/context.js";
import { parseUtmParams, formatUtmLog } from "./utils/utm.js";
import { consultationConversation } from "./handlers/consultation.js";
import { appendFileSync } from "fs";
import { resolve } from "path";

const logPath = resolve("bot.log");
export const log = (msg: string) => {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  appendFileSync(logPath, line + "\n");
};

function createInitialSession(): ConsultationSession {
  return { step: "name" };
}

export function createBot(storage?: StorageAdapter<ConsultationSession>) {
  const bot = new Bot<AppContext>(process.env.BOT_TOKEN ?? "");

  bot.use(
    session({ initial: createInitialSession, storage }) as Middleware<AppContext>,
  );
  bot.use(conversations() as Middleware<AppContext>);
  bot.use(
    createConversation(consultationConversation) as Middleware<AppContext>,
  );

  bot.command("start", async (ctx: AppContext) => {
    const rawParam = typeof ctx.match === "string" ? ctx.match : undefined;
    const utm = parseUtmParams(rawParam);

    if (utm.utm_source || utm.utm_medium || utm.utm_campaign) {
      ctx.session.utmSource = utm.utm_source;
      ctx.session.utmMedium = utm.utm_medium;
      ctx.session.utmCampaign = utm.utm_campaign;
      ctx.session.utmContent = utm.utm_content;
      ctx.session.utmTerm = utm.utm_term;
    }

    log(`[START] user=${ctx.from?.id} chat=${ctx.chat?.id} ${formatUtmLog(utm)}`);

    const sourceLabel = utm.utm_source
      ? `📌 Вы пришли к нам через: *${utm.utm_source}*\n\n`
      : "";

    const keyboard = new InlineKeyboard().text(
      "📝 Записаться на консультацию",
      "start_consultation",
    );

    await ctx.reply(
      "👋 Добро пожаловать в центр психологической помощи *Пси-Опора*!\n\n" +
        sourceLabel +
        "Мы помогаем найти внутренний баланс и справиться с трудностями.\n\n" +
        "Нажмите кнопку ниже, чтобы записаться на консультацию 👇",
      { parse_mode: "Markdown", reply_markup: keyboard },
    );
  });

  bot.callbackQuery("start_consultation", async (ctx: AppContext) => {
    await ctx.answerCallbackQuery();

    const consentKeyboard = new InlineKeyboard()
      .text("✅ Согласен(а) на обработку данных", "consent_agree")
      .row()
      .text("❌ Не согласен(а)", "consent_decline");

    await ctx.reply(
      "📋 *Согласие на обработку персональных данных*\n\n" +
        "В соответствии с Федеральным законом №152-ФЗ «О персональных данных» " +
        "для записи на консультацию нам необходимо обработать ваши персональные данные:\n\n" +
        "• Имя\n" +
        "• Номер телефона\n\n" +
        "*Цель обработки:* запись на психологическую консультацию и обратная связь.\n" +
        "*Оператор:* Центр психологической помощи «Пси-Опора».\n" +
        "*Срок хранения:* до отзыва согласия.\n\n" +
        "Вы можете отозвать согласие в любой момент, написав нам.\n\n" +
        "Подтвердите согласие, чтобы продолжить 👇",
      { parse_mode: "Markdown", reply_markup: consentKeyboard },
    );
  });

  bot.callbackQuery("consent_agree", async (ctx: AppContext) => {
    await ctx.answerCallbackQuery("Спасибо! Продолжаем.");
    ctx.session.consentGiven = true;
    log(`[CONSENT] user=${ctx.from?.id} согласился`);

    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
    await ctx.reply("✅ Согласие получено. Приступим к записи!\n\nКак вас зовут?");
    await ctx.conversation.enter("consultationConversation");
  });

  bot.callbackQuery("consent_decline", async (ctx: AppContext) => {
    await ctx.answerCallbackQuery();
    log(`[CONSENT] user=${ctx.from?.id} отказался`);

    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
    await ctx.reply(
      "Вы отказались от обработки персональных данных.\n\n" +
        "Без согласия мы не можем принять заявку. " +
        "Если передумаете — нажмите /start.",
    );
  });

  bot.catch((err) => {
    const ctx = err.ctx as AppContext;
    log(`[ERROR] update_id=${ctx.update.update_id} ${err.error}`);
    ctx.reply("⚠️ Что-то пошло не так. Попробуйте ещё раз или напишите /start.");
  });

  return bot;
}
