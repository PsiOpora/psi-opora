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

  // При bot_started чат может ещё не существовать (404),
  // поэтому отправляем сообщение через user_id
  if (ctx.updateType === "bot_started" && ctx.user?.user_id) {
    await ctx.api.sendMessageToUser(
      ctx.user.user_id,
      WELCOME_TEXT,
      replyOptions,
    );
  } else {
    await ctx.reply(WELCOME_TEXT, replyOptions);
  }
}

export function createMaxBot({ storage }: MaxBotOptions = {}) {
  const token = env.MAX_BOT_TOKEN ?? env.BOT_TOKEN ?? "";
  const bot = new Bot<AppContext>(token, { contextType: AppContext });

  bot.use(sessionMiddleware(storage));

  bot.on("bot_started", (ctx) =>
    handleStart(ctx as AppContext, (ctx as unknown as { startPayload?: string | null }).startPayload ?? undefined),
  );
  bot.command("start", (ctx) => handleStart(ctx, undefined));

  bot.action("start_consultation", async (ctx) => {
    await ctx.answerOnCallback({ notification: "Открываем анкету..." });
    await trackFunnelStep("consult_click", {
      messenger: "max",
      source: ctx.session.source,
      campaign: ctx.session.campaign,
    });

    await ctx.reply(CONSENT_TEXT, {
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
    await ctx.answerOnCallback({ notification: "Спасибо! Продолжаем." });
    ctx.session.consentGiven = true;
    ctx.session.step = "name";
    log(`[CONSENT] user=${ctx.user?.user_id} согласился`);
    await trackFunnelStep("consent", {
      messenger: "max",
      source: ctx.session.source,
      campaign: ctx.session.campaign,
    });
    await ctx.reply(
      "✅ Согласие получено. Приступим к записи!\n\nКак вас зовут?",
    );
  });

  bot.action("consent_decline", async (ctx) => {
    await ctx.answerOnCallback({ notification: "Хорошо" });
    log(`[CONSENT] user=${ctx.user?.user_id} отказался`);
    await ctx.reply(CONSENT_DECLINED_TEXT);
  });

  bot.on("message_created", async (ctx) => {
    const text = ctx.message.body.text?.trim() ?? "";
    if (!text || text.startsWith("/")) return;

    if (ctx.session.step === "name") {
      ctx.session.name = text;
      ctx.session.step = "phone";
      await trackFunnelStep("name", {
        messenger: "max",
        source: ctx.session.source,
        campaign: ctx.session.campaign,
      });
      await ctx.reply(
        `Отлично, ${text}! Теперь введите, пожалуйста, ваш номер телефона для связи.`,
      );
      return;
    }

    if (ctx.session.step === "phone") {
      if (hasPhoneNumber(text)) {
        ctx.session.phone = text;
        ctx.session.step = "email";
        await trackFunnelStep("phone", {
          messenger: "max",
          source: ctx.session.source,
          campaign: ctx.session.campaign,
        });
        await ctx.reply(
          "Спасибо! И последний шаг — укажите, пожалуйста, ваш email для связи.",
        );
        return;
      }

      ctx.session.phoneAttempts = (ctx.session.phoneAttempts ?? 0) + 1;
      if (ctx.session.phoneAttempts >= 3) {
        ctx.session.step = "done";
        await ctx.reply(
          "😔 К сожалению, мы не смогли распознать номер. " +
            "Напишите, пожалуйста, номер в любом формате: +7 999 123-45-67, " +
            "8 999 123 45 67 и т.д. Мы свяжемся с вами для уточнения.",
        );
        return;
      }

      await ctx.reply(
        "Не удалось распознать номер телефона. Введите, пожалуйста, номер в любом формате, например: +7 (999) 123-45-67",
      );
      return;
    }

    if (ctx.session.step === "email") {
      const name = ctx.session.name ?? "";
      const phone = ctx.session.phone ?? "";
      const source = ctx.session.source;
      const campaign = ctx.session.campaign;
      const userId = ctx.message.sender?.user_id;

      if (isValidEmail(text)) {
        ctx.session.email = text;
        ctx.session.step = "done";

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
        await ctx.reply(successReply(name), { format: "markdown" });
        return;
      }

      ctx.session.emailAttempts = (ctx.session.emailAttempts ?? 0) + 1;
      if (ctx.session.emailAttempts >= 3) {
        ctx.session.step = "done";
        await ctx.reply(
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
        await ctx.reply(successReply(name), { format: "markdown" });
        return;
      }

      await ctx.reply(
        "Не удалось распознать email. Введите, пожалуйста, адрес в формате: example@mail.ru",
      );
      return;
    }
  });

  bot.catch((err, ctx) => {
    log(`[ERROR] update=${ctx.updateType} ${describeError(err)}`);
    ctx
      .reply("⚠️ Что-то пошло не так. Попробуйте ещё раз или напишите /start.")
      .catch(() => {});
  });

  return bot;
}

export type MaxBot = ReturnType<typeof createMaxBot>;

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
