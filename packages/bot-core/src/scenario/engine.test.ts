import { describe, expect, test } from "bun:test";
import {
  applyScenarioAction,
  applyScenarioText,
  buildReminder,
  describeLead,
  type ScenarioOutput,
  startScenario,
} from "./engine";
import { DEFAULT_SCENARIO_TEXTS as t } from "./texts";

/** Прогоняет цепочку действий/текстов, возвращает последний output. */
function run(
  steps: Array<{ action?: string; text?: string }>,
): ScenarioOutput {
  let out = startScenario(t);
  for (const step of steps) {
    const next = step.action
      ? // biome-ignore lint/suspicious/noExplicitAny: тесты передают и невалидные action
        applyScenarioAction(out.state, step.action as any, t)
      : applyScenarioText(out.state, step.text ?? "", t);
    if (!next) throw new Error(`шаг не обработан: ${JSON.stringify(step)}`);
    out = next;
  }
  return out;
}

describe("startScenario", () => {
  test("приветствие + вопрос о категории, трекается start", () => {
    const out = startScenario(t);
    expect(out.state.step).toBe("category");
    expect(out.messages[0]?.text).toBe(t.welcome);
    expect(out.messages[1]?.text).toBe(t.category_question);
    expect(out.messages[1]?.buttons?.flat().map((b) => b.action)).toEqual([
      "sc_child",
      "sc_self",
    ]);
    expect(out.track).toEqual(["start"]);
    expect(out.awaitingInput).toBe(true);
  });
});

describe("ветка «трудности с ребенком»", () => {
  test("полный путь: категория → тема → email → гайд → телефон → заявка", () => {
    const out = run([
      { action: "sc_child" },
      { action: "sc_eating" },
      { text: "parent@example.com" },
      { text: "+7 999 123-45-67" },
    ]);

    expect(out.state.step).toBe("done");
    expect(out.lead).toEqual({
      phone: "+7 999 123-45-67",
      email: "parent@example.com",
      audience: "child",
      issue: "eating",
    });
    expect(out.track).toEqual(["phone"]);
    expect(out.messages.map((m) => m.text)).toEqual([t.phone_thanks]);
    expect(out.awaitingInput).toBe(false);
  });

  test("email принят — отправляется гайд и запрос телефона", () => {
    const out = run([
      { action: "sc_child" },
      { action: "sc_other" },
      { text: "parent@example.com" },
    ]);
    expect(out.state.step).toBe("phone");
    expect(out.track).toEqual(["email"]);
    expect(out.messages.map((m) => m.text)).toEqual([
      t.lead_magnet,
      t.phone_question,
    ]);
  });

  test("кнопка «без email» ведёт сразу к телефону", () => {
    const out = run([
      { action: "sc_child" },
      { action: "sc_eating" },
      { action: "sc_skip_email" },
    ]);
    expect(out.state.step).toBe("phone");
    expect(out.messages.map((m) => m.text)).toEqual([t.phone_question]);
  });

  test("после 3 нераспознанных email — переход к телефону без гайда", () => {
    const out = run([
      { action: "sc_child" },
      { action: "sc_eating" },
      { text: "не email" },
      { text: "тоже не email" },
      { text: "и это нет" },
    ]);
    expect(out.state.step).toBe("phone");
    expect(out.state.email).toBeUndefined();
    expect(out.messages.map((m) => m.text)).toEqual([t.phone_question]);
  });
});

describe("ветка «помощь для себя»", () => {
  test("телефон → заявка + вопрос о рассылке", () => {
    const out = run([
      { action: "sc_self" },
      { action: "sc_other" },
      { text: "89991234567" },
    ]);
    expect(out.state.step).toBe("subscribe");
    expect(out.lead?.audience).toBe("self");
    expect(out.track).toEqual(["phone"]);
    expect(out.messages[0]?.text).toBe(t.subscribe_question);
  });

  test("согласие на рассылку трекается и уходит эффектом", () => {
    const out = run([
      { action: "sc_self" },
      { action: "sc_eating" },
      { text: "89991234567" },
      { action: "sc_sub_yes" },
    ]);
    expect(out.state.step).toBe("done");
    expect(out.track).toEqual(["subscribe"]);
    expect(out.subscribeChoice).toBe("yes");
    expect(out.messages.map((m) => m.text)).toEqual([t.subscribe_yes_reply]);
  });

  test("отказ от рассылки завершает сценарий без трекинга", () => {
    const out = run([
      { action: "sc_self" },
      { action: "sc_other" },
      { text: "89991234567" },
      { action: "sc_sub_no" },
    ]);
    expect(out.state.step).toBe("done");
    expect(out.track).toEqual([]);
    expect(out.subscribeChoice).toBe("no");
  });
});

describe("отказ от телефона и лимиты", () => {
  test("кнопка «не оставлять телефон» завершает без заявки", () => {
    const out = run([
      { action: "sc_self" },
      { action: "sc_other" },
      { action: "sc_skip_phone" },
    ]);
    expect(out.state.step).toBe("done");
    expect(out.lead).toBeUndefined();
    expect(out.messages.map((m) => m.text)).toEqual([t.phone_declined]);
  });

  test("после 3 нераспознанных телефонов сценарий завершается", () => {
    const out = run([
      { action: "sc_child" },
      { action: "sc_eating" },
      { action: "sc_skip_email" },
      { text: "абв" },
      { text: "где" },
      { text: "ёжз" },
    ]);
    expect(out.state.step).toBe("done");
    expect(out.lead).toBeUndefined();
  });
});

describe("устойчивость к неожиданному вводу", () => {
  test("кнопка чужого шага игнорируется (null)", () => {
    const start = startScenario(t);
    expect(applyScenarioAction(start.state, "sc_eating", t)).toBeNull();
    expect(applyScenarioAction(start.state, "sc_sub_yes", t)).toBeNull();
  });

  test("текст на кнопочном шаге повторяет вопрос только один раз", () => {
    const start = startScenario(t);
    const first = applyScenarioText(start.state, "привет", t);
    expect(first?.messages[0]?.text).toBe(t.category_question);
    const second = applyScenarioText(first?.state ?? start.state, "ещё", t);
    expect(second).toBeNull();
  });

  test("после завершения сценария текст игнорируется", () => {
    const out = run([
      { action: "sc_self" },
      { action: "sc_other" },
      { action: "sc_skip_phone" },
    ]);
    expect(applyScenarioText(out.state, "любой текст", t)).toBeNull();
  });

  test("выбор кнопки сбрасывает nudged — вопрос повторится на новом шаге", () => {
    const start = startScenario(t);
    const nudged = applyScenarioText(start.state, "привет", t);
    const next = applyScenarioAction(nudged?.state ?? start.state, "sc_child", t);
    expect(next?.state.nudged).toBe(false);
  });
});

describe("напоминания", () => {
  test("на активном шаге — текст напоминания с кнопками вопроса", () => {
    const start = startScenario(t);
    const reminder = buildReminder(start.state, t);
    expect(reminder?.text).toBe(t.reminder);
    expect(reminder?.buttons?.flat().map((b) => b.action)).toEqual([
      "sc_child",
      "sc_self",
    ]);
  });

  test("после завершения напоминать нечего", () => {
    const out = run([
      { action: "sc_self" },
      { action: "sc_other" },
      { action: "sc_skip_phone" },
    ]);
    expect(buildReminder(out.state, t)).toBeNull();
  });
});

describe("describeLead", () => {
  test("комментарий для менеджера содержит подписи кнопок", () => {
    const comment = describeLead(
      { phone: "+7", audience: "child", issue: "eating" },
      t,
    );
    expect(comment).toContain(t.btn_child);
    expect(comment).toContain(t.btn_issue_eating);
  });
});
