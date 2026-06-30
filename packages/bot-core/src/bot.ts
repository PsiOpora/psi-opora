import { Bot, session, InlineKeyboard, type Middleware } from "grammy";
import { conversations, createConversation, type Conversation } from "@grammyjs/conversations";
import type { StorageAdapter } from "grammy";
import type { AppContext, ConsultationSession, ConvContext } from "./types/context.js";
import { parseUtmParams, formatUtmLog } from "./utils/utm.js";
import { consultationConversation } from "./handlers/consultation.js";

export const log = (msg: string) => {
  console.log(`${new Date().toISOString()} ${msg}`);
};

function createInitialSession(): ConsultationSession {
  return { step: "name" };
}

export interface BotOptions {
  storage?: StorageAdapter<ConsultationSession>;
  apiRoot?: string;
  messenger?: string;
}

export function createBot({ storage, apiRoot, messenger = "telegram" }: BotOptions = {}) {
  const prefix = messenger === "telegram" ? "TG" : "MAX";
  const token = process.env[`${prefix}_BOT_TOKEN`] ?? process.env.BOT_TOKEN ?? "";
  const bot = new Bot<AppContext>(token, {
    client: apiRoot ? { apiRoot } : undefined,
  });

  bot.use(
    session({ initial: createInitialSession, storage }) as Middleware<AppContext>
  );
  bot.use(conversations() as Middleware<AppContext>);
  bot.use(
    createConversation(
      (conv: Conversation<ConvContext, ConvContext>, ctx: ConvContext) =>
        consultationConversation(conv, ctx, messenger)
    ) as Middleware<AppContext>
  );

  bot.command("start", async (ctx: AppContext) => {
    const rawParam = typeof ctx.match === "string" ? ctx.match : undefined;
    const utm = parseUtmParams(rawParam);

    if (utm.campaign) {
      ctx.session.campaign = utm.campaign;
    }

    log(`[START] user=${ctx.from?.id} chat=${ctx.chat?.id} ${formatUtmLog(utm)} messenger=${messenger}`);

    const sourceLabel = utm.campaign
      ? `📌 Вы пришли к нам через: *${utm.campaign}*\n\n`
      : "";

    const keyboard = new InlineKeyboard().text(
      "📝 Записаться на консультацию",
      "start_consultation"
    );

    await ctx.reply(
      "👋 Добро пожаловать в центр психологической помощи *Пси-Опора*!\n\n" +
        sourceLabel +
        "Мы помогаем найти внутренний баланс и справиться с трудностями.\n\n" +
        "Нажмите кнопку ниже, чтобы записаться на консультацию 👇",
      { parse_mode: "Markdown", reply_markup: keyboard }
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
      { parse_mode: "Markdown", reply_markup: consentKeyboard }
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
        "Если передумаете — нажмите /start."
    );
  });

  bot.catch((err) => {
    const ctx = err.ctx as AppContext;
    log(`[ERROR] update_id=${ctx.update.update_id} ${err.error}`);
    ctx.reply("⚠️ Что-то пошло не так. Попробуйте ещё раз или напишите /start.");
  });

  return bot;
}
