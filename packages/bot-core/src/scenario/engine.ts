import type { FunnelStep } from "../utils/funnel";
import { hasPhoneNumber, isValidEmail } from "../utils/validation";
import type { ScenarioTexts } from "./texts";

/**
 * Движок сценария бота — чистая машина состояний без привязки к мессенджеру.
 * Дерево решений:
 *
 *   старт → категория (ребёнок / для себя) → тема (пищевое расстройство / другое)
 *     ветка «ребёнок»: email → лид-магнит → телефон → конец
 *     ветка «для себя»: телефон → вопрос о рассылке → конец
 *
 * Адаптеры (grammy для TG, @maxhub для MAX) рендерят ScenarioMessage
 * и исполняют эффекты: track (воронка) и lead (сделка в Bitrix).
 */

export const SCENARIO_ACTIONS = [
  "sc_child",
  "sc_self",
  "sc_eating",
  "sc_other",
  "sc_skip_email",
  "sc_skip_phone",
  "sc_sub_yes",
  "sc_sub_no",
] as const;
export type ScenarioAction = (typeof SCENARIO_ACTIONS)[number];

export function isScenarioAction(value: string): value is ScenarioAction {
  return (SCENARIO_ACTIONS as readonly string[]).includes(value);
}

export type ScenarioStep =
  | "category"
  | "issue"
  | "email"
  | "phone"
  | "subscribe"
  | "done";

export type ScenarioAudience = "child" | "self";
export type ScenarioIssue = "eating" | "other";

export interface ScenarioState {
  step: ScenarioStep;
  audience?: ScenarioAudience;
  issue?: ScenarioIssue;
  email?: string;
  emailAttempts?: number;
  phoneAttempts?: number;
  /** Напоминание уже отправлено — при следующей проверке сценарий завершается. */
  reminded?: boolean;
  /**
   * Вопрос уже повторяли в ответ на текст на кнопочном шаге.
   * Дальше молчим, чтобы не встревать в переписку с оператором.
   */
  nudged?: boolean;
  /** ID созданной сделки Bitrix — для комментария об ответе на рассылку. */
  dealId?: number;
}

export interface ScenarioButton {
  label: string;
  action: ScenarioAction;
}

export interface ScenarioMessage {
  text: string;
  /** Ряды inline-кнопок. */
  buttons?: ScenarioButton[][];
}

export interface ScenarioLead {
  phone: string;
  email?: string;
  audience: ScenarioAudience;
  issue: ScenarioIssue;
}

export interface ScenarioOutput {
  state: ScenarioState;
  messages: ScenarioMessage[];
  /** Шаги воронки для трекинга. */
  track: FunnelStep[];
  /** Заявка для передачи менеджеру (сделка в Bitrix). */
  lead?: ScenarioLead;
  /** Ответ на вопрос о рассылке — уходит комментарием в сделку. */
  subscribeChoice?: "yes" | "no";
  /** true — ждём ответа пользователя (при молчании сработает напоминание). */
  awaitingInput: boolean;
}

const MAX_ATTEMPTS = 3;

// ── Вопросы шагов ──────────────────────────────────────────────────────────────

function categoryQuestion(t: ScenarioTexts): ScenarioMessage {
  return {
    text: t.category_question,
    buttons: [
      [{ label: t.btn_child, action: "sc_child" }],
      [{ label: t.btn_self, action: "sc_self" }],
    ],
  };
}

function issueQuestion(t: ScenarioTexts): ScenarioMessage {
  return {
    text: t.issue_question,
    buttons: [
      [{ label: t.btn_issue_eating, action: "sc_eating" }],
      [{ label: t.btn_issue_other, action: "sc_other" }],
    ],
  };
}

function emailQuestion(t: ScenarioTexts): ScenarioMessage {
  return {
    text: t.email_question,
    buttons: [[{ label: t.btn_skip_email, action: "sc_skip_email" }]],
  };
}

function phoneQuestion(t: ScenarioTexts): ScenarioMessage {
  return {
    text: t.phone_question,
    buttons: [[{ label: t.btn_skip_phone, action: "sc_skip_phone" }]],
  };
}

function subscribeQuestion(t: ScenarioTexts): ScenarioMessage {
  return {
    text: t.subscribe_question,
    buttons: [
      [
        { label: t.btn_subscribe_yes, action: "sc_sub_yes" },
        { label: t.btn_subscribe_no, action: "sc_sub_no" },
      ],
    ],
  };
}

/** Вопрос текущего шага — для повтора и напоминаний. */
export function stepQuestion(
  state: ScenarioState,
  t: ScenarioTexts,
): ScenarioMessage | null {
  switch (state.step) {
    case "category":
      return categoryQuestion(t);
    case "issue":
      return issueQuestion(t);
    case "email":
      return emailQuestion(t);
    case "phone":
      return phoneQuestion(t);
    case "subscribe":
      return subscribeQuestion(t);
    default:
      return null;
  }
}

// ── Переходы ──────────────────────────────────────────────────────────────────

function output(
  state: ScenarioState,
  messages: ScenarioMessage[],
  extra: Partial<
    Pick<ScenarioOutput, "track" | "lead" | "subscribeChoice">
  > = {},
): ScenarioOutput {
  return {
    state,
    messages,
    track: extra.track ?? [],
    lead: extra.lead,
    subscribeChoice: extra.subscribeChoice,
    awaitingInput: state.step !== "done",
  };
}

/** Начало сценария (/start): приветствие + вопрос о категории. */
export function startScenario(t: ScenarioTexts): ScenarioOutput {
  return output({ step: "category" }, [{ text: t.welcome }, categoryQuestion(t)], {
    track: ["start"],
  });
}

function askForPhone(
  state: ScenarioState,
  t: ScenarioTexts,
  precedingMessages: ScenarioMessage[] = [],
  track: FunnelStep[] = [],
): ScenarioOutput {
  return output(
    { ...state, step: "phone", reminded: false, nudged: false },
    [...precedingMessages, phoneQuestion(t)],
    { track },
  );
}

function submitPhone(
  state: ScenarioState,
  phone: string,
  t: ScenarioTexts,
): ScenarioOutput {
  const lead: ScenarioLead = {
    phone,
    email: state.email,
    audience: state.audience ?? "self",
    issue: state.issue ?? "other",
  };

  if (state.audience === "self") {
    return output(
      { ...state, step: "subscribe", reminded: false, nudged: false },
      [subscribeQuestion(t)],
      { track: ["phone"], lead },
    );
  }

  return output({ ...state, step: "done" }, [{ text: t.phone_thanks }], {
    track: ["phone"],
    lead,
  });
}

/**
 * Нажатие inline-кнопки. Возвращает null, если кнопка не относится
 * к текущему шагу (устаревшее сообщение) — адаптер молча игнорирует.
 */
export function applyScenarioAction(
  state: ScenarioState,
  action: ScenarioAction,
  t: ScenarioTexts,
): ScenarioOutput | null {
  switch (state.step) {
    case "category": {
      if (action !== "sc_child" && action !== "sc_self") return null;
      const audience: ScenarioAudience =
        action === "sc_child" ? "child" : "self";
      return output(
        { ...state, step: "issue", audience, reminded: false, nudged: false },
        [issueQuestion(t)],
        { track: ["category"] },
      );
    }

    case "issue": {
      if (action !== "sc_eating" && action !== "sc_other") return null;
      const issue: ScenarioIssue = action === "sc_eating" ? "eating" : "other";
      const next = { ...state, issue };
      if (state.audience === "child") {
        return output(
          { ...next, step: "email", reminded: false, nudged: false },
          [emailQuestion(t)],
          { track: ["issue"] },
        );
      }
      return askForPhone(next, t, [], ["issue"]);
    }

    case "email": {
      if (action !== "sc_skip_email") return null;
      return askForPhone(state, t);
    }

    case "phone": {
      if (action !== "sc_skip_phone") return null;
      return output({ ...state, step: "done" }, [{ text: t.phone_declined }]);
    }

    case "subscribe": {
      if (action !== "sc_sub_yes" && action !== "sc_sub_no") return null;
      if (action === "sc_sub_yes") {
        return output(
          { ...state, step: "done" },
          [{ text: t.subscribe_yes_reply }],
          { track: ["subscribe"], subscribeChoice: "yes" },
        );
      }
      return output(
        { ...state, step: "done" },
        [{ text: t.subscribe_no_reply }],
        { subscribeChoice: "no" },
      );
    }

    default:
      return null;
  }
}

/**
 * Текстовое сообщение пользователя. Возвращает null, если сценарий
 * завершён — текст не относится к боту (например, диалог с оператором).
 */
export function applyScenarioText(
  state: ScenarioState,
  text: string,
  t: ScenarioTexts,
): ScenarioOutput | null {
  switch (state.step) {
    case "email": {
      if (isValidEmail(text)) {
        return askForPhone(
          { ...state, email: text },
          t,
          [{ text: t.lead_magnet }],
          ["email"],
        );
      }
      const attempts = (state.emailAttempts ?? 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        // Не мучаем пользователя — продолжаем без email
        return askForPhone({ ...state, emailAttempts: attempts }, t);
      }
      return output({ ...state, emailAttempts: attempts, reminded: false }, [
        { text: t.email_invalid },
      ]);
    }

    case "phone": {
      if (hasPhoneNumber(text)) {
        return submitPhone(state, text.trim(), t);
      }
      const attempts = (state.phoneAttempts ?? 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        return output({ ...state, step: "done" }, [
          { text: t.phone_declined },
        ]);
      }
      return output({ ...state, phoneAttempts: attempts, reminded: false }, [
        { text: t.phone_invalid },
      ]);
    }

    // На шагах с кнопками мягко повторяем вопрос, но только один раз:
    // дальше пользователь, возможно, переписывается с оператором —
    // не встреваем в чужой диалог
    case "category":
    case "issue":
    case "subscribe": {
      if (state.nudged) return null;
      const question = stepQuestion(state, t);
      return question
        ? output({ ...state, reminded: false, nudged: true }, [question])
        : null;
    }

    default:
      return null;
  }
}

/** Напоминание: текст + кнопки текущего шага. null — напоминать нечего. */
export function buildReminder(
  state: ScenarioState,
  t: ScenarioTexts,
): ScenarioMessage | null {
  const question = stepQuestion(state, t);
  if (!question) return null;
  return { text: t.reminder, buttons: question.buttons };
}

/** Комментарий к сделке для менеджера — что выбрал пользователь. */
export function describeLead(lead: ScenarioLead, t: ScenarioTexts): string {
  const audience = lead.audience === "child" ? t.btn_child : t.btn_self;
  const issue = lead.issue === "eating" ? t.btn_issue_eating : t.btn_issue_other;
  return `Категория: ${audience}\nТема: ${issue}`;
}
