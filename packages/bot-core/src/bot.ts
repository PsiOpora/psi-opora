import { Bot, session, InlineKeyboard, type Middleware } from "grammy";
import { conversations, createConversation, type Conversation } from "@grammyjs/conversations";
import type { StorageAdapter } from "grammy";
import type { AppContext, ConsultationSession, ConvContext } from "./types/context.js";
import type { Redis } from "@upstash/redis";
import { parseUtmParams, formatUtmLog } from "./utils/utm.js";
import { trackFunnelStep } from "./utils/funnel.js";
import { consultationConversation } from "./handlers/consultation.js";

export const log = (msg: string) => {
  console.log(`${new Date().toISOString()} ${msg}`);
};

function createInitialSession(): ConsultationSession {
  return { step: "name" };
}

export interface BotOptions {
  storage?: StorageAdapter<ConsultationSession>;
  redis?: Redis;
}

export function createBot({ storage, redis }: BotOptions = {}) {
  const token = process.env.TG_BOT_TOKEN ?? process.env.BOT_TOKEN ?? "";
  const bot = new Bot<AppContext>(token);

  bot.use(
    session({ initial: createInitialSession, storage }) as Middleware<AppContext>
  );
  bot.use(conversations() as Middleware<AppContext>);
  bot.use(
    createConversation(
      consultationConversation,
      "consultationConversation"
    ) as Middleware<AppContext>
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

    log(`[START] user=${ctx.from?.id} chat=${ctx.chat?.id} ${formatUtmLog(utm)} messenger=telegram`);
    await trackFunnelStep("start", { messenger: "telegram", source: utm.source, campaign: utm.campaign });

    const keyboard = new InlineKeyboard().text(
      "📝 Записаться на консультацию",
      "start_consultation"
    );

    await ctx.reply(
      "👋 Добро пожаловать в центр психологической помощи *Пси-Опора*!\n\n" +
        "Первый психологический центр помощи клиентам с психиатрическими расстройствами и зависимостями. Лечение без медикаментов.\n\n" +
        "Нажмите кнопку ниже, чтобы записаться на консультацию 👇",
      { parse_mode: "Markdown", reply_markup: keyboard }
    );
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

    await ctx.reply(
      "📋 *Согласие на обработку персональных данных*\n\n" +
        "В соответствии с Федеральным законом №152-ФЗ «О персональных данных» " +
        "для записи на консультацию нам необходимо обработать ваши персональные данные:\n\n" +
        "• Имя\n" +
        "• Номер телефона\n" +
        "• Email\n\n" +
        "*Цель обработки:* запись на психологическую консультацию и обратная связь.\n" +
        "*Оператор:* Центр психологической помощи «Пси-Опора».\n" +
        "*Срок хранения:* до отзыва согласия.\n\n" +
        "Нажимая «Согласен(а)», вы принимаете условия следующих документов:\n" +
        "• [Политика конфиденциальности](https://psi-opora.ru/private-policy/)\n" +
        "• [Согласие на обработку персональных данных](https://psi-opora.ru/personal-data/)\n" +
        "• [Публичная оферта](https://psi-opora.ru/oferta-kurs-rod/)\n" +
        "• [Согласие на рекламную рассылку](https://psi-opora.ru/reklama/)\n\n" +
        "Вы можете отозвать согласие в любой момент, написав нам.\n\n" +
        "Подтвердите согласие, чтобы продолжить 👇",
      { parse_mode: "Markdown", reply_markup: consentKeyboard, link_preview_options: { is_disabled: true } }
    );
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
