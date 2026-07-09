import { Bot, Context, Keyboard, type MiddlewareFn } from "@maxhub/max-bot-api";
import {
  CONSENT_DECLINED_TEXT,
  CONSENT_TEXT,
  type ConsultationSession,
  formatUtmLog,
  hasPhoneNumber,
  isValidEmail,
  parseUtmParams,
  type StorageAdapter,
  setFunnelUpsert,
  submitConsultationDeal,
  successReply,
  trackFunnelStep,
  WELCOME_TEXT,
} from "@psi-opora/bot-core";
import { env } from "@psi-opora/config";
import { upsertBotFunnelEvent } from "@psi-opora/db/queries.edge";

// MAX-бот деплоится на Vercel Edge Runtime — используем neon-http через @psi-opora/db/queries.edge
// (node-postgres недоступен в Edge, т.к. требует Node.js API: net, tls, dns)
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
    await ctx.api.sendMessageToUser(userId, text, options);
    return;
  }
  try {
    await ctx.reply(text, options);
  } catch (err) {
    if (isChatNotFoundError(err) && userId) {
      await ctx.api.sendMessageToUser(userId, text, options);
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
}

function createInitialSession(): ConsultationSession {
  return { step: "name" };
}

function sessionMiddleware(
  storage: StorageAdapter<ConsultationSession> | undefined,
): MiddlewareFn<AppContext> {
  const memory = new Map<string, ConsultationSession>();
  return async (ctx, next) => {
    const key = String(ctx.user?.user_id ?? ctx.chatId ?? "anon");
    const existing = storage ? await storage.read(key) : memory.get(key);
    ctx.session = existing ?? createInitialSession();
    await next();
    if (storage) await storage.write(key, ctx.session);
    else memory.set(key, ctx.session);
  };
}

async function handleStart(ctx: AppContext, startPayload: string | undefined) {
  const utm = parseUtmParams(startPayload);
  if (utm.campaign) ctx.session.campaign = utm.campaign;
  if (utm.source) ctx.session.source = utm.source;

  log(
    `[START] user=${ctx.user?.user_id} chat=${ctx.chatId} ${formatUtmLog(utm)} messenger=max`,
  );
  await trackFunnelStep("start", {
    messenger: "max",
    source: utm.source,
    campaign: utm.campaign,
  });

  const keyboard = Keyboard.inlineKeyboard([
    [
      Keyboard.button.callback(
        "📝 Записаться на консультацию",
        "start_consultation",
      ),
    ],
  ]);

  const replyOptions = {
    format: "markdown" as const,
    attachments: [keyboard],
  };

  await replyWithFallback(ctx, WELCOME_TEXT, replyOptions);
}

export type MaxBot = Bot<AppContext>;

export function createMaxBot({ storage }: MaxBotOptions = {}): MaxBot {
  const token = env.MAX_BOT_TOKEN ?? env.BOT_TOKEN ?? "";
  const bot = new Bot<AppContext>(token, { contextType: AppContext });

  bot.use(sessionMiddleware(storage));

  bot.on("bot_started", (ctx) =>
    handleStart(
      ctx as AppContext,
      (ctx as unknown as { startPayload?: string | null }).startPayload ??
        undefined,
    ),
  );
  bot.command("start", (ctx) => handleStart(ctx, undefined));

  bot.action("start_consultation", async (ctx) => {
    const appCtx = ctx as AppContext;
    await appCtx.answerOnCallback({ notification: "Открываем анкету..." });
    await trackFunnelStep("consult_click", {
      messenger: "max",
      source: appCtx.session.source,
      campaign: appCtx.session.campaign,
    });

    await replyWithFallback(appCtx, CONSENT_TEXT, {
      format: "markdown",
      attachments: [
        Keyboard.inlineKeyboard([
          [
            Keyboard.button.callback(
              "✅ Согласен(а) на обработку данных",
              "consent_agree",
            ),
          ],
          [Keyboard.button.callback("❌ Не согласен(а)", "consent_decline")],
        ]),
      ],
    });
  });

  bot.action("consent_agree", async (ctx) => {
    const appCtx = ctx as AppContext;
    await appCtx.answerOnCallback({ notification: "Спасибо! Продолжаем." });
    appCtx.session.consentGiven = true;
    appCtx.session.step = "name";
    log(`[CONSENT] user=${appCtx.user?.user_id} согласился`);
    await trackFunnelStep("consent", {
      messenger: "max",
      source: appCtx.session.source,
      campaign: appCtx.session.campaign,
    });
    await replyWithFallback(
      appCtx,
      "✅ Согласие получено. Приступим к записи!\n\nКак вас зовут?",
    );
  });

  bot.action("consent_decline", async (ctx) => {
    const appCtx = ctx as AppContext;
    await appCtx.answerOnCallback({ notification: "Хорошо" });
    log(`[CONSENT] user=${appCtx.user?.user_id} отказался`);
    await replyWithFallback(appCtx, CONSENT_DECLINED_TEXT);
  });

  bot.on("message_created", async (ctx) => {
    const appCtx = ctx as unknown as AppContext;
    const text = appCtx.message?.body.text?.trim() ?? "";
    if (!text || text.startsWith("/")) return;

    const safeReply = (replyText: string, options?: Parameters<AppContext["reply"]>[1]) =>
      replyWithFallback(appCtx, replyText, options);

    if (appCtx.session.step === "name") {
      appCtx.session.name = text;
      appCtx.session.step = "phone";
      await trackFunnelStep("name", {
        messenger: "max",
        source: appCtx.session.source,
        campaign: appCtx.session.campaign,
      });
      await safeReply(
        `Отлично, ${text}! Теперь введите, пожалуйста, ваш номер телефона для связи.`,
      );
      return;
    }

    if (appCtx.session.step === "phone") {
      if (hasPhoneNumber(text)) {
        appCtx.session.phone = text;
        appCtx.session.step = "email";
        await trackFunnelStep("phone", {
          messenger: "max",
          source: appCtx.session.source,
          campaign: appCtx.session.campaign,
        });
        await safeReply(
          "Спасибо! И последний шаг — укажите, пожалуйста, ваш email для связи.",
        );
        return;
      }

      appCtx.session.phoneAttempts = (appCtx.session.phoneAttempts ?? 0) + 1;
      if (appCtx.session.phoneAttempts >= 3) {
        appCtx.session.step = "done";
        await safeReply(
          "😔 К сожалению, мы не смогли распознать номер. " +
            "Напишите, пожалуйста, номер в любом формате: +7 999 123-45-67, " +
            "8 999 123 45 67 и т.д. Мы свяжемся с вами для уточнения.",
        );
        return;
      }

      await safeReply(
        "Не удалось распознать номер телефона. Введите, пожалуйста, номер в любом формате, например: +7 (999) 123-45-67",
      );
      return;
    }

    if (appCtx.session.step === "email") {
      const name = appCtx.session.name ?? "";
      const phone = appCtx.session.phone ?? "";
      const source = appCtx.session.source;
      const campaign = appCtx.session.campaign;
      const userId = appCtx.message?.sender?.user_id;

      if (isValidEmail(text)) {
        appCtx.session.email = text;
        appCtx.session.step = "done";

        log(
          `[CONSULTATION] name=${name} phone=${phone} email=${text}${source ? ` source=${source}` : ""}${campaign ? ` campaign=${campaign}` : ""} user=${userId} messenger=max`,
        );

        await submitConsultationDeal({
          name,
          phone,
          email: text,
          messenger: "max",
          userId,
          source,
          campaign,
        });
        await safeReply(successReply(name), { format: "markdown" });
        return;
      }

      appCtx.session.emailAttempts = (appCtx.session.emailAttempts ?? 0) + 1;
      if (appCtx.session.emailAttempts >= 3) {
        appCtx.session.step = "done";
        await safeReply(
          "😔 Не удалось распознать email, продолжим без него — уточним при звонке.",
        );

        log(
          `[CONSULTATION] name=${name} phone=${phone}${source ? ` source=${source}` : ""}${campaign ? ` campaign=${campaign}` : ""} user=${userId} messenger=max`,
        );

        await submitConsultationDeal({
          name,
          phone,
          messenger: "max",
          userId,
          source,
          campaign,
        });
        await safeReply(successReply(name), { format: "markdown" });
        return;
      }

      await safeReply(
        "Не удалось распознать email. Введите, пожалуйста, адрес в формате: example@mail.ru",
      );
      return;
    }
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
