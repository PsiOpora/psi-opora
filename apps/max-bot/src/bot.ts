import {
  Bot,
  Context,
  Keyboard,
  type MiddlewareFn,
} from "@maxhub/max-bot-api";
import {
  applyScenarioAction,
  applyScenarioText,
  type ConsultationSession,
  dispatchScenarioOutput,
  formatUtmLog,
  getScenarioTexts,
  parseUtmParams,
  SCENARIO_ACTIONS,
  type ScenarioMessage,
  type ScenarioOutput,
  type ScenarioTexts,
  setFunnelUpsert,
  startConsultation,
  startScenario,
  type StorageAdapter,
} from "@psi-opora/bot-core";
import { env } from "@psi-opora/config";
import { upsertBotFunnelEvent } from "@psi-opora/db/queries.edge";
import type { Redis } from "@upstash/redis";

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
  /** Redis для очереди напоминаний; без него напоминания отключены. */
  redis?: Redis;
}

function createInitialSession(): ConsultationSession {
  return { step: "name" };
}

function sessionKeyOf(ctx: AppContext): string {
  return String(ctx.user?.user_id ?? ctx.chatId ?? "anon");
}

function sessionMiddleware(
  storage: StorageAdapter<ConsultationSession> | undefined,
): MiddlewareFn<AppContext> {
  const memory = new Map<string, ConsultationSession>();
  return async (ctx, next) => {
    const key = sessionKeyOf(ctx);
    const existing = storage ? await storage.read(key) : memory.get(key);
    ctx.session = existing ?? createInitialSession();
    await next();
    if (storage) await storage.write(key, ctx.session);
    else memory.set(key, ctx.session);
  };
}

function toMaxKeyboard(message: ScenarioMessage) {
  if (!message.buttons?.length) return undefined;
  return Keyboard.inlineKeyboard(
    message.buttons.map((row) =>
      row.map((button) => Keyboard.button.callback(button.label, button.action)),
    ),
  );
}

export type MaxBot = Bot<AppContext>;

export function createMaxBot({ storage, redis }: MaxBotOptions = {}): MaxBot {
  const token = env.MAX_BOT_TOKEN ?? env.BOT_TOKEN ?? "";
  const bot = new Bot<AppContext>(token, { contextType: AppContext });

  bot.use(sessionMiddleware(storage));

  const replyScenarioMessage = async (
    ctx: AppContext,
    message: ScenarioMessage,
  ) => {
    const keyboard = toMaxKeyboard(message);
    const attachments = keyboard ? [keyboard] : undefined;
    try {
      await replyWithFallback(ctx, message.text, {
        format: "markdown",
        attachments,
      });
    } catch {
      await replyWithFallback(ctx, message.text, { attachments });
    }
  };

  const dispatch = async (
    ctx: AppContext,
    out: ScenarioOutput,
    texts: ScenarioTexts,
  ) => {
    ctx.session.scenario = out.state;
    await dispatchScenarioOutput(out, {
      messenger: "max",
      sessionKey: sessionKeyOf(ctx),
      redis,
      texts,
      sendMessage: (message) => replyScenarioMessage(ctx, message),
      userName: ctx.user?.name,
      userId: ctx.user?.user_id,
      source: ctx.session.source,
      campaign: ctx.session.campaign,
    });
  };

  async function handleStart(
    ctx: AppContext,
    startPayload: string | undefined,
  ) {
    const utm = parseUtmParams(startPayload);
    if (utm.campaign) ctx.session.campaign = utm.campaign;
    if (utm.source) ctx.session.source = utm.source;

    log(
      `[START] user=${ctx.user?.user_id} chat=${ctx.chatId} ${formatUtmLog(utm)} messenger=max`,
    );

    const texts = await getScenarioTexts();
    await dispatch(ctx, startScenario(texts), texts);
  }

  bot.on("bot_started", (ctx) =>
    handleStart(
      ctx as AppContext,
      (ctx as unknown as { startPayload?: string | null }).startPayload ??
        undefined,
    ),
  );
  bot.command("start", (ctx) => handleStart(ctx as AppContext, undefined));

  // Кнопка «Записаться» из сообщений старого бота — сразу в флоу записи
  bot.action("start_consultation", async (ctx) => {
    const appCtx = ctx as AppContext;
    await appCtx.answerOnCallback({}).catch(() => {});
    const texts = await getScenarioTexts();
    await dispatch(appCtx, startConsultation(texts), texts);
  });

  for (const action of SCENARIO_ACTIONS) {
    bot.action(action, async (ctx) => {
      const appCtx = ctx as AppContext;
      await appCtx.answerOnCallback({}).catch(() => {});

      const texts = await getScenarioTexts();
      const state = appCtx.session.scenario;
      let out = state ? applyScenarioAction(state, action, texts) : null;
      // Согласие из старого сообщения без активного сценария —
      // начинаем запись заново (показываем актуальное согласие)
      if (!out && action === "consent_agree") {
        out = startConsultation(texts);
      }
      // null — кнопка от прошлого шага (устаревшее сообщение), игнорируем
      if (!out) return;

      log(
        `[SCENARIO] user=${appCtx.user?.user_id} action=${action} messenger=max`,
      );
      await dispatch(appCtx, out, texts);
    });
  }

  bot.on("message_created", async (ctx) => {
    const appCtx = ctx as unknown as AppContext;
    const text = appCtx.message?.body.text?.trim() ?? "";
    if (!text || text.startsWith("/")) return;

    const state = appCtx.session.scenario;
    if (!state) return;

    const texts = await getScenarioTexts();
    const out = applyScenarioText(state, text, texts);
    if (!out) return;

    await dispatch(appCtx, out, texts);
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
