import type { ScenarioTexts } from "./texts";
import type { ScenarioMessage, ScenarioState } from "./types";

/** Подстановка имени клиента в текст с плейсхолдером {name}. */
export function withName(text: string, name: string | undefined): string {
  return text.replaceAll("{name}", name?.trim() || "друг");
}

/** Подстановка нескольких полей ({name}, {phone}, {email} и т.п.) в текст. */
export function withFields(
  text: string,
  fields: Record<string, string | undefined>,
): string {
  let result = text;
  for (const [key, value] of Object.entries(fields)) {
    result = result.replaceAll(`{${key}}`, value?.trim() || "");
  }
  return result;
}

export function entryQuestion(t: ScenarioTexts): ScenarioMessage {
  return {
    text: t.welcome,
    buttons: [
      [{ label: t.btn_consult, action: "sc_consult" }],
      [{ label: t.btn_guide, action: "sc_guide" }],
    ],
  };
}

export function consentQuestion(t: ScenarioTexts): ScenarioMessage {
  return {
    text: t.consent_text,
    buttons: [
      [{ label: t.btn_consent_agree, action: "consent_agree" }],
      [{ label: t.btn_consent_decline, action: "consent_decline" }],
    ],
  };
}

export function categoryQuestion(t: ScenarioTexts): ScenarioMessage {
  return {
    text: t.category_question,
    buttons: [
      [{ label: t.btn_child, action: "sc_child" }],
      [{ label: t.btn_self, action: "sc_self" }],
    ],
  };
}

export function issueQuestion(t: ScenarioTexts): ScenarioMessage {
  return {
    text: t.issue_question,
    buttons: [
      [{ label: t.btn_issue_eating, action: "sc_eating" }],
      [{ label: t.btn_issue_ocd, action: "sc_ocd" }],
      [{ label: t.btn_issue_other, action: "sc_other" }],
    ],
  };
}

export function emailQuestion(t: ScenarioTexts): ScenarioMessage {
  return {
    text: t.email_question,
    buttons: [[{ label: t.btn_skip_email, action: "sc_skip_email" }]],
  };
}

export function phoneQuestion(t: ScenarioTexts): ScenarioMessage {
  return {
    text: t.phone_question,
    buttons: [[{ label: t.btn_skip_phone, action: "sc_skip_phone" }]],
  };
}

export function subscribeQuestion(t: ScenarioTexts): ScenarioMessage {
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
