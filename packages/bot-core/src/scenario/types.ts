import type { FunnelStep } from "../utils/funnel";

export const SCENARIO_ACTIONS = [
	"sc_consult",
	"sc_guide",
	// consent_* совпадают с callback data старого бота — кнопки в старых
	// сообщениях продолжают работать
	"consent_agree",
	"consent_decline",
	"marketing_consent_agree",
	"marketing_consent_decline",
	"sc_child",
	"sc_self",
	"sc_eating",
	"sc_ocd",
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
	| "marketing_consent"
	| "name"
	| "category"
	| "issue"
	| "email"
	| "phone"
	| "subscribe"
	| "done";

export type ScenarioFlow = "consult" | "guide";
export type ScenarioAudience = "child" | "self";
export type ScenarioIssue = "eating" | "ocd" | "other";

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
	/** Явное согласие на рекламную рассылку (отдельное от согласия на обработку ПДн). */
	marketingConsent?: boolean;
	/**
	 * Вход по кодовому слову кампании (bot_guide_campaigns.id) — вместо
	 * обычного выбора категории/темы сразу ведёт к выдаче гайда кампании
	 * (см. startGuideCampaign в engine.ts).
	 */
	campaignId?: string;
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
	/** Гайд конкретной кампании (bot_guides.id) — иначе берётся глобальный. */
	guideId?: string;
}

export interface ScenarioLead {
	flow: ScenarioFlow;
	phone: string;
	email?: string;
	/** Имя из анкеты (флоу consult); иначе адаптер берёт имя из профиля. */
	name?: string;
	audience?: ScenarioAudience;
	issue?: ScenarioIssue;
	/** Явное согласие на рекламную рассылку. */
	marketingConsent?: boolean;
	/** Кампания, по кодовому слову которой пришла заявка (bot_guide_campaigns.id). */
	campaignId?: string;
}

/** Контакт, который нужно сохранить в CRM без создания сделки. */
export interface ScenarioContact {
	email: string;
}

export interface ScenarioOutput {
	state: ScenarioState;
	messages: ScenarioMessage[];
	/** Шаги воронки для трекинга. */
	track: FunnelStep[];
	/** Заявка для передачи менеджеру (сделка в Bitrix). */
	lead?: ScenarioLead;
	/** Контакт с подтверждённым email, но ещё без завершённой заявки. */
	contact?: ScenarioContact;
	/** Ответ на вопрос о рассылке — уходит комментарием в сделку. */
	subscribeChoice?: "yes" | "no";
	/** true — ждём ответа пользователя (при молчании сработает напоминание). */
	awaitingInput: boolean;
}
