import { describe, expect, test } from "bun:test";

// Env до импорта бота: grammy требует непустой токен, а клиент БД —
// POSTGRES_URL (запросы в тестах падают и глотаются, соединение не нужно)
process.env.TG_BOT_TOKEN ||= "1:TEST_TOKEN";
process.env.POSTGRES_URL ||= "postgresql://test:test@127.0.0.1:5432/test";

const { createBot } = await import("./bot");
const { DEFAULT_SCENARIO_TEXTS: t } = await import("./scenario/texts");

interface SentCall {
  method: string;
  // biome-ignore lint/suspicious/noExplicitAny: сырые payload'ы Bot API
  payload: any;
}

/** Бот с замоканным Bot API: вызовы копятся в sent, сеть не трогается. */
function makeBot() {
  const bot = createBot();
  bot.botInfo = {
    id: 42,
    is_bot: true,
    first_name: "Опора",
    username: "opora_test_bot",
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
  };

  const sent: SentCall[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    sent.push({ method, payload });
    const result = method === "sendMessage" ? { message_id: 1 } : true;
    // biome-ignore lint/suspicious/noExplicitAny: мок транспорта grammy
    return { ok: true, result } as any;
  });

  return { bot, sent };
}

const chat = { id: 100, type: "private" as const, first_name: "U" };
const from = { id: 100, is_bot: false, first_name: "U" };

function commandUpdate(text: string, updateId = 1) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 0,
      chat,
      from,
      text,
      entities: [
        {
          type: "bot_command" as const,
          offset: 0,
          length: (text.split(" ")[0] ?? text).length,
        },
      ],
    },
  };
}

function textUpdate(text: string, updateId = 1) {
  return {
    update_id: updateId,
    message: { message_id: updateId, date: 0, chat, from, text },
  };
}

function callbackUpdate(data: string, updateId = 2) {
  return {
    update_id: updateId,
    callback_query: {
      id: `cb${updateId}`,
      from,
      chat_instance: "ci",
      data,
      message: { message_id: 5, date: 0, chat, from },
    },
  };
}

function sentMessages(sent: SentCall[]): SentCall[] {
  return sent.filter((call) => call.method === "sendMessage");
}

describe("телеграм-бот: /start", () => {
  test("отправляет приветствие с кнопками «Записаться» и «Получить гайд»", async () => {
    const { bot, sent } = makeBot();
    await bot.handleUpdate(commandUpdate("/start"));

    const messages = sentMessages(sent);
    expect(messages.map((m) => m.payload.text)).toEqual([t.welcome]);
    const keyboard = messages[0]?.payload.reply_markup?.inline_keyboard;
    expect(
      keyboard?.flat().map((b: { callback_data: string }) => b.callback_data),
    ).toEqual(["sc_consult", "sc_guide"]);
  });

  test("/start с utm-меткой тоже запускает сценарий", async () => {
    const { bot, sent } = makeBot();
    await bot.handleUpdate(
      commandUpdate("/start utm_source=google&utm_campaign=test"),
    );
    expect(sentMessages(sent).length).toBe(1);
  });

  test("флоу гайда кнопками: гайд → категория → тема → email", async () => {
    const { bot, sent } = makeBot();
    await bot.handleUpdate(commandUpdate("/start"));
    await bot.handleUpdate(callbackUpdate("sc_guide", 2));
    await bot.handleUpdate(callbackUpdate("sc_child", 3));
    await bot.handleUpdate(callbackUpdate("sc_eating", 4));

    const texts = sentMessages(sent).map((m) => m.payload.text);
    expect(texts).toEqual([
      t.welcome,
      t.category_question,
      t.issue_question,
      t.email_question,
    ]);
  });

  test("флоу консультации: согласие → имя → телефон → email → заявка", async () => {
    const { bot, sent } = makeBot();
    await bot.handleUpdate(commandUpdate("/start"));
    await bot.handleUpdate(callbackUpdate("sc_consult", 2));
    await bot.handleUpdate(callbackUpdate("consent_agree", 3));
    await bot.handleUpdate(textUpdate("Анна", 4));
    await bot.handleUpdate(textUpdate("+7 999 123-45-67", 5));
    await bot.handleUpdate(textUpdate("anna@example.com", 6));

    const texts = sentMessages(sent).map((m) => m.payload.text);
    expect(texts[0]).toBe(t.welcome);
    expect(texts[1]).toBe(t.consent_text);
    expect(texts[2]).toBe(t.consent_agreed);
    expect(texts[3]).toBe(t.name_question);
    expect(texts[4]).toContain("Анна");
    expect(texts[5]).toBe(t.consult_email_question);
    expect(texts[6]).toContain("Заявка принята");
  });
});

describe("телеграм-бот: кнопки старого сценария", () => {
  test("«Записаться на консультацию» открывает согласие на ПДн", async () => {
    const { bot, sent } = makeBot();
    await bot.handleUpdate(callbackUpdate("start_consultation"));

    expect(sent.some((c) => c.method === "answerCallbackQuery")).toBe(true);
    expect(sentMessages(sent).map((m) => m.payload.text)).toEqual([
      t.consent_text,
    ]);
  });

  test("старое согласие без активного сценария показывает согласие заново", async () => {
    const { bot, sent } = makeBot();
    await bot.handleUpdate(callbackUpdate("consent_agree"));
    expect(sentMessages(sent).map((m) => m.payload.text)).toEqual([
      t.consent_text,
    ]);
  });

  test("отказ от согласия без активного сценария молча игнорируется", async () => {
    const { bot, sent } = makeBot();
    await bot.handleUpdate(callbackUpdate("consent_decline"));
    expect(sent.some((c) => c.method === "answerCallbackQuery")).toBe(true);
    expect(sentMessages(sent)).toEqual([]);
  });
});
