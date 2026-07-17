import type { FunnelStep } from "../utils/funnel";
import { hasPhoneNumber, isValidEmail } from "../utils/validation";
import type { ScenarioTexts } from "./texts";

/**
 * Движок сценария бота — чистая машина состояний без привязки к мессенджеру.
 * Дерево решений:
 *
 *   старт → выбор:
 *   ├── «Записаться на консультацию» (флоу consult)
 *   │     └── согласие на ПДн → имя → телефон → email → сделка
 *   └── «Получить гайд» (флоу guide)
 *         └── категория (ребёнок / для себя) → тема
 *             ветка «ребёнок»: email → гайд → телефон → сделка
 *             ветка «для себя»: телефон → сделка → вопрос о рассылке
 *
 * Адаптеры (grammy для TG, @maxhub для MAX) рендерят ScenarioMessage
 * и исполняют эффекты: track (воронка) и lead (сделка в Bitrix).
 */

export const SCENARIO_ACTIONS = [
  "sc_consult",
  "sc_guide",
  // consent_* совпадают с callback data старого бота — кнопки в старых
  // сообщениях продолжают работать
  "consent_agree",
  "consent_decline",
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
  | "entry"
  | "consent"
  | "name"
  | "category"
  | "issue"
  | "email"
  | "phone"
  | "subscribe"
  | "done";

export type ScenarioFlow = "consult" | "guide";
export type ScenarioAudience = "child" | "self";
export type ScenarioIssue = "eating" | "other";

export interface ScenarioState {
  step: ScenarioStep;
  /** Выбор на старте: запись на консультацию или воронка гайда. */
  flow?: ScenarioFlow;
  audience?: ScenarioAudience;
  issue?: ScenarioIssue;
  /** Имя, введённое в флоу консультации. */
  name?: string;
  phone?: string;
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
  /** Вслед за текстом отправить PDF-гайд (если загружен в дашборде). */
  guide?: boolean;
}

export interface ScenarioLead {
  flow: ScenarioFlow;
  phone: string;
  email?: string;
  /** Имя из анкеты (флоу consult); иначе адаптер берёт имя из профиля. */
  name?: string;
  audience?: ScenarioAudience;
  issue?: ScenarioIssue;
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

/** Подстановка имени клиента в текст с плейсхолдером {name}. */
function withName(text: string, name: string | undefined): string {
  return text.replaceAll("{name}", name?.trim() || "друг");
}

// ── Вопросы шагов ──────────────────────────────────────────────────────────────

function entryQuestion(t: ScenarioTexts): ScenarioMessage {
  return {
    text: t.welcome,
    buttons: [
      [{ label: t.btn_consult, action: "sc_consult" }],
      [{ label: t.btn_guide, action: "sc_guide" }],
    ],
  };
}

function consentQuestion(t: ScenarioTexts): ScenarioMessage {
  return {
    text: t.consent_text,
    buttons: [
      [{ label: t.btn_consent_agree, action: "consent_agree" }],
      [{ label: t.btn_consent_decline, action: "consent_decline" }],
    ],
  };
}

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
    case "entry":
      return entryQuestion(t);
    case "consent":
      return consentQuestion(t);
    case "name":
      return { text: t.name_question };
    case "category":
      return categoryQuestion(t);
    case "issue":
      return issueQuestion(t);
    case "email":
      return state.flow === "consult"
        ? { text: t.consult_email_question }
        : emailQuestion(t);
    case "phone":
      return state.flow === "consult"
        ? { text: withName(t.consult_phone_question, state.name) }
        : phoneQuestion(t);
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

/** Сброс одноразовых флагов при переходе на новый шаг. */
function fresh(state: ScenarioState): ScenarioState {
  return { ...state, reminded: false, nudged: false };
}

/**
 * Начало сценария (/start): приветствие с выбором —
 * записаться на консультацию или получить гайд.
 */
export function startScenario(t: ScenarioTexts): ScenarioOutput {
  return output({ step: "entry" }, [entryQuestion(t)], { track: ["start"] });
}

/**
 * Вход в флоу записи на консультацию: согласие на обработку ПДн.
 * Используется и для кнопки «Записаться» из сообщений старого бота.
 */
export function startConsultation(t: ScenarioTexts): ScenarioOutput {
  return output(
    { step: "consent", flow: "consult" },
    [consentQuestion(t)],
    { track: ["consult_click"] },
  );
}

function askForPhone(
  state: ScenarioState,
  t: ScenarioTexts,
  precedingMessages: ScenarioMessage[] = [],
  track: FunnelStep[] = [],
): ScenarioOutput {
  return output(
    { ...fresh(state), step: "phone" },
    [...precedingMessages, phoneQuestion(t)],
    { track },
  );
}

/** Телефон получен в флоу гайда: сделка + финал или вопрос о рассылке. */
function submitGuidePhone(
  state: ScenarioState,
  phone: string,
  t: ScenarioTexts,
): ScenarioOutput {
  const lead: ScenarioLead = {
    flow: "guide",
    phone,
    email: state.email,
    audience: state.audience ?? "self",
    issue: state.issue ?? "other",
  };

  if (state.audience === "self") {
    return output(
      { ...fresh(state), step: "subscribe" },
      [subscribeQuestion(t)],
      { track: ["phone"], lead },
    );
  }

  return output({ ...state, step: "done" }, [{ text: t.phone_thanks }], {
    track: ["phone"],
    lead,
  });
}

/** Финал флоу консультации: сделка с именем и (опционально) email. */
function submitConsultLead(
  state: ScenarioState,
  email: string | undefined,
  t: ScenarioTexts,
  precedingMessages: ScenarioMessage[] = [],
): ScenarioOutput {
  const lead: ScenarioLead = {
    flow: "consult",
    phone: state.phone ?? "",
    email,
    name: state.name,
  };
  return output(
    { ...state, email, step: "done" },
    [...precedingMessages, { text: withName(t.consult_success, state.name) }],
    { lead },
  );
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
    case "entry": {
      if (action === "sc_consult") return startConsultation(t);
      if (action === "sc_guide") {
        return output(
          { ...fresh(state), step: "category", flow: "guide" },
          [categoryQuestion(t)],
          { track: ["guide_click"] },
        );
      }
      return null;
    }

    case "consent": {
      if (action === "consent_agree") {
        return output(
          { ...fresh(state), step: "name" },
          [{ text: t.consent_agreed }, { text: t.name_question }],
          { track: ["consent"] },
        );
      }
      if (action === "consent_decline") {
        return output({ ...state, step: "done" }, [
          { text: t.consent_declined },
        ]);
      }
      return null;
    }

    case "category": {
      if (action !== "sc_child" && action !== "sc_self") return null;
      const audience: ScenarioAudience =
        action === "sc_child" ? "child" : "self";
      return output(
        { ...fresh(state), step: "issue", audience },
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
          { ...fresh(next), step: "email" },
          [emailQuestion(t)],
          { track: ["issue"] },
        );
      }
      return askForPhone(next, t, [], ["issue"]);
    }

    case "email": {
      if (action !== "sc_skip_email" || state.flow === "consult") return null;
      return askForPhone(state, t);
    }

    case "phone": {
      if (action !== "sc_skip_phone" || state.flow === "consult") return null;
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
    case "name": {
      return output(
        { ...fresh(state), step: "phone", name: text },
        [{ text: withName(t.consult_phone_question, text) }],
        { track: ["name"] },
      );
    }

    case "email": {
      if (state.flow === "consult") {
        if (isValidEmail(text)) {
          return submitConsultLead(state, text, t);
        }
        const attempts = (state.emailAttempts ?? 0) + 1;
        if (attempts >= MAX_ATTEMPTS) {
          // Продолжаем без email — уточним при звонке
          return submitConsultLead(
            { ...state, emailAttempts: attempts },
            undefined,
            t,
            [{ text: t.consult_email_invalid_final }],
          );
        }
        return output({ ...state, emailAttempts: attempts, reminded: false }, [
          { text: t.email_invalid },
        ]);
      }

      if (isValidEmail(text)) {
        return askForPhone(
          { ...state, email: text },
          t,
          [{ text: t.lead_magnet, guide: true }],
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
        const phone = text.trim();
        if (state.flow === "consult") {
          return output(
            { ...fresh(state), step: "email", phone },
            [{ text: t.consult_email_question }],
            { track: ["phone"] },
          );
        }
        return submitGuidePhone(state, phone, t);
      }
      const attempts = (state.phoneAttempts ?? 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        return output({ ...state, step: "done" }, [
          {
            text:
              state.flow === "consult"
                ? t.consult_phone_invalid_final
                : t.phone_declined,
          },
        ]);
      }
      return output({ ...state, phoneAttempts: attempts, reminded: false }, [
        { text: t.phone_invalid },
      ]);
    }

    // На шагах с кнопками мягко повторяем вопрос, но только один раз:
    // дальше пользователь, возможно, переписывается с оператором —
    // не встреваем в чужой диалог
    case "entry":
    case "consent":
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
  if (lead.flow === "consult") {
    return `Заявка: ${t.btn_consult}`;
  }
  const audience = lead.audience === "child" ? t.btn_child : t.btn_self;
  const issue =
    lead.issue === "eating" ? t.btn_issue_eating : t.btn_issue_other;
  return `Заявка: ${t.btn_guide}\nКатегория: ${audience}\nТема: ${issue}`;
}
