import { Bot, Context, Keyboard, type MiddlewareFn } from "@maxhub/max-bot-api";
import {
  createBitrixDeal,
  parseUtmParams,
  formatUtmLog,
  trackFunnelStep,
  createUpstashRedis,
  getBitrixChatInfo,
  type ConsultationSession,
  type StorageAdapter,
} from "@psi-opora/bot-core";

export const log = (msg: string) => {
  console.log(`${new Date().toISOString()} ${msg}`);
};

function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  return cause ? `${err.message} (cause: ${describeError(cause)})` : err.message;
}

let _redis: ReturnType<typeof createUpstashRedis> | null = null;
function getRedis() {
  if (!_redis) {
    try {
      _redis = createUpstashRedis();
    } catch {
      return null;
    }
  }
  return _redis;
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

function hasPhoneNumber(text: string): boolean {
  return /[\d\s\+\-\(\)]{7,}/.test(text);
}

function isValidEmail(text: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
}

async function handleStart(ctx: AppContext, startPayload: string | undefined) {
  const utm = parseUtmParams(startPayload);
  if (utm.campaign) ctx.session.campaign = utm.campaign;
  if (utm.source) ctx.session.source = utm.source;

  log(
    `[START] user=${ctx.user?.user_id} chat=${ctx.chatId} ${formatUtmLog(utm)} messenger=max`,
  );
  await trackFunnelStep("start", { messenger: "max", source: utm.source, campaign: utm.campaign });

  await ctx.reply(
    "👋 Добро пожаловать в центр психологической помощи *Пси-Опора*!\n\n" +
      "Первый психологический центр помощи клиентам с психиатрическими расстройствами и зависимостями. Лечение без медикаментов.\n\n" +
      "Нажмите кнопку ниже, чтобы записаться на консультацию 👇",
    {
      format: "markdown",
      attachments: [
        Keyboard.inlineKeyboard([
          [
            Keyboard.button.callback(
              "📝 Записаться на консультацию",
              "start_consultation",
            ),
          ],
        ]),
      ],
    },
  );
}

export function createMaxBot({ storage }: MaxBotOptions = {}) {
  const token = process.env.MAX_BOT_TOKEN ?? process.env.BOT_TOKEN ?? "";
  const bot = new Bot<AppContext>(token, { contextType: AppContext });

  bot.use(sessionMiddleware(storage));

  bot.on("bot_started", (ctx) =>
    handleStart(ctx, ctx.startPayload ?? undefined),
  );
  bot.command("start", (ctx) => handleStart(ctx, undefined));

  bot.action("start_consultation", async (ctx) => {
    await ctx.answerOnCallback({ notification: "Открываем анкету..." });
    await trackFunnelStep("consult_click", {
      messenger: "max",
      source: ctx.session.source,
      campaign: ctx.session.campaign,
    });

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
      {
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
      },
    );
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
    await ctx.reply(
      "Вы отказались от обработки персональных данных.\n\n" +
        "Без согласия мы не можем принять заявку. " +
        "Если передумаете — нажмите /start.",
    );
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
        const name = ctx.session.name ?? "";
        const campaign = ctx.session.campaign;
        const source = ctx.session.source;
        const telegramUserId = ctx.message.sender?.user_id;
        ctx.session.phone = text;
        ctx.session.step = "email";
        await trackFunnelStep("phone", { messenger: "max", source, campaign });

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
      const emailText = text.trim();
      if (isValidEmail(emailText)) {
        const name = ctx.session.name ?? "";
        const phone = ctx.session.phone ?? "";
        const campaign = ctx.session.campaign;
        const source = ctx.session.source;
        const telegramUserId = ctx.message.sender?.user_id;
        ctx.session.email = emailText;
        ctx.session.step = "done";

        log(
          `[CONSULTATION] name=${name} phone=${phone} email=${emailText}${source ? ` source=${source}` : ""}${campaign ? ` campaign=${campaign}` : ""} user=${telegramUserId} messenger=max`,
        );

        try {
          let chatId: number | undefined;
          let operatorId: number | undefined;

          const redis = getRedis();
          if (redis && telegramUserId) {
            const chatInfo = await getBitrixChatInfo(redis, telegramUserId);
            if (chatInfo) {
              chatId = chatInfo.chatId;
              operatorId = chatInfo.operatorId || undefined;
              console.log(`[CONSULTATION] найден chatId=${chatId} для userId=${telegramUserId}`);
            }
          }

          await createBitrixDeal({
            name,
            phone,
            email: emailText,
            campaign,
            source,
            telegramUserId,
            messenger: "max",
            chatId,
            operatorId,
          });
          await trackFunnelStep("deal", { messenger: "max", source, campaign });
        } catch (err: any) {
          console.error("[bitrix] ошибка:", err.message);
        }

        await ctx.reply(
          "✅ *Заявка принята!*\n\n" +
            `${name}, наш администратор свяжется с вами в ближайшие 30 минут, чтобы подтвердить запись на консультацию.\n\n` +
            "А пока вы можете:\n" +
            "📖 Узнать больше о наших специалистах: https://psi-opora.ru/services\n" +
            "💬 Задать вопрос в чат\n\n" +
            "Хорошего дня! 🌿",
          { format: "markdown" },
        );
        return;
      }

      ctx.session.emailAttempts = (ctx.session.emailAttempts ?? 0) + 1;
      if (ctx.session.emailAttempts >= 3) {
        const name = ctx.session.name ?? "";
        const phone = ctx.session.phone ?? "";
        const campaign = ctx.session.campaign;
        const source = ctx.session.source;
        const telegramUserId = ctx.message.sender?.user_id;
        ctx.session.step = "done";
        await ctx.reply(
          "😔 Не удалось распознать email, продолжим без него — уточним при звонке.",
        );

        try {
          let chatId: number | undefined;
          let operatorId: number | undefined;

          const redis = getRedis();
          if (redis && telegramUserId) {
            const chatInfo = await getBitrixChatInfo(redis, telegramUserId);
            if (chatInfo) {
              chatId = chatInfo.chatId;
              operatorId = chatInfo.operatorId || undefined;
            }
          }

          await createBitrixDeal({
            name,
            phone,
            campaign,
            source,
            telegramUserId,
            messenger: "max",
            chatId,
            operatorId,
          });
          await trackFunnelStep("deal", { messenger: "max", source, campaign });
        } catch (err: any) {
          console.error("[bitrix] ошибка:", err.message);
        }

        await ctx.reply(
          "✅ *Заявка принята!*\n\n" +
            `${name}, наш администратор свяжется с вами в ближайшие 30 минут, чтобы подтвердить запись на консультацию.\n\n` +
            "А пока вы можете:\n" +
            "📖 Узнать больше о наших специалистах: https://psi-opora.ru/services\n" +
            "💬 Задать вопрос в чат\n\n" +
            "Хорошего дня! 🌿",
          { format: "markdown" },
        );
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
 * Ручная прогонка апдейта через middleware — используется в webhook-обработчике,
 * т.к. у Bot нет публичного webhookCallback (в отличие от grammy), а внутренний
 * handleUpdate приватный.
 */
export async function processUpdate(
  bot: MaxBot,
  update: unknown,
): Promise<void> {
  const ctx = new AppContext(
    update as ConstructorParameters<typeof AppContext>[0],
    bot.api,
    bot.botInfo,
  );
  try {
    await bot.middleware()(ctx, async () => {});
  } catch (err) {
    log(`[ERROR] update=${ctx.updateType} ${describeError(err)}`);
    await ctx
      .reply("⚠️ Что-то пошло не так. Попробуйте ещё раз или напишите /start.")
      .catch(() => {});
  }
}
