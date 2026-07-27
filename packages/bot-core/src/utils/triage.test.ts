import { beforeEach, describe, expect, mock, test } from "bun:test";

type GenerateObjectResult = { needsAttention: boolean; summary: string };
let nextResult: GenerateObjectResult = { needsAttention: false, summary: "" };
const generateObject = mock(() => Promise.resolve({ object: nextResult }));
mock.module("ai", () => ({ generateObject }));

mock.module("@psi-opora/config", () => ({
  env: { OPENROUTER_API_KEY: "test-key", OPENROUTER_MODEL: "test-model" },
  logger: { error: mock(() => {}), info: mock(() => {}) },
}));

mock.module("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: () => ({
    chat: (name: string) => ({ modelId: name }),
  }),
}));

type ConversationMeta = { tags?: string[] } | null;
let nextMeta: ConversationMeta = null;
const getConversationMeta = mock(() => Promise.resolve(nextMeta));
const addClientNote = mock(() => Promise.resolve(null));
const addConversationTag = mock(() => Promise.resolve());
mock.module("@psi-opora/db/queries.edge", () => ({
  addClientNote,
  addConversationTag,
  getConversationMeta,
}));

const { triageOffScriptMessage } = await import("./triage");

describe("triageOffScriptMessage", () => {
  beforeEach(() => {
    generateObject.mockClear();
    addClientNote.mockClear();
    addConversationTag.mockClear();
    getConversationMeta.mockClear();
    nextResult = { needsAttention: false, summary: "" };
    nextMeta = null;
  });

  test("короткое сообщение — ничего не делает, LLM не вызывается", async () => {
    await triageOffScriptMessage({
      messenger: "telegram",
      userId: "1",
      text: "спасибо",
    });
    expect(generateObject).not.toHaveBeenCalled();
    expect(getConversationMeta).not.toHaveBeenCalled();
  });

  test("needsAttention=false — ничего не пишет", async () => {
    await triageOffScriptMessage({
      messenger: "telegram",
      userId: "1",
      text: "Это достаточно длинное, но совершенно рутинное сообщение",
    });
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(addClientNote).not.toHaveBeenCalled();
    expect(addConversationTag).not.toHaveBeenCalled();
  });

  test("needsAttention=true — пишет заметку и ставит тег", async () => {
    nextResult = {
      needsAttention: true,
      summary: "Клиентка описывает тяжёлую ситуацию в семье",
    };
    await triageOffScriptMessage({
      messenger: "telegram",
      userId: "42",
      text: "Очень длинное и тяжёлое сообщение клиента о его ситуации",
    });
    expect(addClientNote).toHaveBeenCalledTimes(1);
    expect(addClientNote).toHaveBeenCalledWith({
      messenger: "telegram",
      userId: "42",
      text: "🤖 Авто-заметка: Клиентка описывает тяжёлую ситуацию в семье",
    });
    expect(addConversationTag).toHaveBeenCalledWith(
      "telegram",
      "42",
      "⚠️ Требует внимания",
    );
  });

  test("диалог уже помечен — LLM повторно не вызывается", async () => {
    nextMeta = { tags: ["⚠️ Требует внимания"] };
    await triageOffScriptMessage({
      messenger: "telegram",
      userId: "1",
      text: "Ещё одно длинное сообщение вне сценария бота от того же клиента",
    });
    expect(generateObject).not.toHaveBeenCalled();
    expect(addClientNote).not.toHaveBeenCalled();
    expect(addConversationTag).not.toHaveBeenCalled();
  });
});
