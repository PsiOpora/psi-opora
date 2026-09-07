import type { FunnelStep } from "../utils/funnel";
import { extractContactInfo } from "../utils/llm-extract";
import { hasPhoneNumber, isValidEmail } from "../utils/validation";
import {
	categoryQuestion,
	consentQuestion,
	consultEmailQuestion,
	emailQuestion,
	entryQuestion,
	issueQuestion,
	marketingConsentQuestion,
	phoneQuestion,
	stepQuestion,
	subscribeQuestion,
	withFields,
	withName,
} from "./questions";
import type { ScenarioTexts } from "./texts";
import type {
	ScenarioAction,
	ScenarioAudience,
	ScenarioContact,
	ScenarioIssue,
	ScenarioLead,
	ScenarioMessage,
	ScenarioOutput,
	ScenarioState,
} from "./types";

/**
 * Движок сценария бота — чистая машина состояний без привязки к мессенджеру.
 * Дерево решений:
 *
 *   старт → выбор:
 *   ├── «Записаться на консультацию» (флоу consult)
 *   │     └── согласие на ПДн → имя → телефон → email → сделка
 *   ├── «Получить гайд» (флоу guide)
 *   │     └── согласие на ПДн → категория (ребёнок / для себя) → тема
 *   │         ветка «ребёнок»: email → гайд → телефон → сделка
 *   │         ветка «для себя»: телефон (или отказ) → вопрос о рассылке
 *   └── кодовое слово кампании (см. startGuideCampaign/GuideCampaignContext)
 *         └── согласие на ПДн → согласие на рекламу → email → гайд → сделка
 *             (без телефона — материал кампании отдаётся только за email)
 *
 * Адаптеры (grammy для TG, @maxhub для MAX) рендерят ScenarioMessage
 * и исполняют эффекты: track (воронка) и lead (сделка в Bitrix).
 *
 * Типы состояния/сообщений — в ./types, построители текстов вопросов — в
 * ./questions; здесь только переходы между шагами.
 */

export { stepQuestion } from "./questions";
export {
	isScenarioAction,
	SCENARIO_ACTIONS,
	type ScenarioAction,
	type ScenarioAudience,
	type ScenarioButton,
	type ScenarioContact,
	type ScenarioFlow,
	type ScenarioIssue,
	type ScenarioLead,
	type ScenarioMessage,
	type ScenarioOutput,
	type ScenarioState,
	type ScenarioStep,
} from "./types";

const MAX_ATTEMPTS = 3;

function output(
	state: ScenarioState,
	messages: ScenarioMessage[],
	extra: Partial<
		Pick<
			ScenarioOutput,
			"track" | "lead" | "contact" | "subscribeChoice" | "dropReason"
		>
	> = {},
): ScenarioOutput {
	return {
		state,
		messages,
		track: extra.track ?? [],
		lead: extra.lead,
		contact: extra.contact,
		subscribeChoice: extra.subscribeChoice,
		awaitingInput: state.step !== "done",
		dropReason: extra.dropReason,
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

/** Данные кампании гайда (bot_guide_campaigns), нужные движку сценария. */
export interface GuideCampaignContext {
	id: string;
	/** Кодовое слово — также используется как метка campaign в воронке/CRM. */
	keyword: string;
	title: string;
	guideId: string | null;
	/** Приветствие перед согласием на ПДн — null/пусто, если шаг не нужен. */
	welcomeMessage: string | null;
	/** Вопрос перед сбором email — конкретика темы, не общий emailQuestion сценария. */
	emailQuestion: string;
	emailSubject: string;
	emailBody: string;
	deliveryMessage: string;
}

/**
 * Вход по кодовому слову кампании (см. bot_guide_campaigns): минуя обычный
 * выбор категории/темы, сразу (опционально приветствие →) согласие на ПДн →
 * согласие на рекламу → email → выдача гайда кампании → телефон (см.
 * ветвление по campaignId в applyScenarioAction/applyScenarioText ниже).
 */
export function startGuideCampaign(
	campaign: GuideCampaignContext,
	t: ScenarioTexts,
): ScenarioOutput {
	const welcome = campaign.welcomeMessage?.trim();
	return output(
		{ step: "consent", flow: "guide", campaignId: campaign.id },
		[...(welcome ? [{ text: welcome }] : []), consentQuestion(t)],
		{ track: ["guide_click"] },
	);
}

/**
 * Вход в флоу записи на консультацию: согласие на обработку ПДн.
 * Используется и для кнопки «Записаться» из сообщений старого бота.
 */
export function startConsultation(t: ScenarioTexts): ScenarioOutput {
	return output({ step: "consent", flow: "consult" }, [consentQuestion(t)], {
		track: ["consult_click"],
	});
}

function askForPhone(
	state: ScenarioState,
	t: ScenarioTexts,
	precedingMessages: ScenarioMessage[] = [],
	track: FunnelStep[] = [],
	contact?: ScenarioContact,
): ScenarioOutput {
	return output(
		{ ...fresh(state), step: "phone" },
		[...precedingMessages, phoneQuestion(t)],
		{ track, contact },
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
		marketingConsent: state.marketingConsent,
		campaignId: state.campaignId,
		consentAt: state.consentAt,
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

/**
 * Email получен в кампании по кодовому слову: сразу сделка + выдача гайда,
 * без вопроса о телефоне — в отличие от обычной ветки «Получить гайд»,
 * материал кампании отдаётся только за email (см. исходное ТЗ — «бот
 * выдачи материала»: согласие → email → материал, без сбора телефона).
 */
function submitCampaignGuide(
	state: ScenarioState,
	email: string,
	campaign: GuideCampaignContext,
): ScenarioOutput {
	const lead: ScenarioLead = {
		flow: "guide",
		phone: state.phone ?? "",
		email,
		audience: "child",
		issue: "other",
		marketingConsent: state.marketingConsent,
		campaignId: state.campaignId,
		consentAt: state.consentAt,
	};
	return output(
		{ ...state, email, step: "done" },
		[
			{
				text: campaign.deliveryMessage,
				guide: true,
				guideId: campaign.guideId ?? undefined,
			},
		],
		{ track: ["email"], lead },
	);
}

/**
 * Отказ от телефона (кнопкой или после исчерпанных попыток) в флоу гайда.
 * Ветка «для себя» всё равно получает вопрос о рассылке — контакта может
 * не быть, но интерес к каналу бота остаётся; ветка «ребёнок» просто
 * завершает сценарий (лид-магнит уже отправлен на email).
 *
 * reason — "skipped" (нажал «Пропустить») или "invalid_exhausted" (3 раза
 * прислал нераспознанный номер) — обе ветки фиксируются в воронке как отказ
 * от телефона на шаге phone, см. дашборд "Причины отвала".
 */
function declinePhone(
	state: ScenarioState,
	t: ScenarioTexts,
	reason: "skipped" | "invalid_exhausted" = "skipped",
): ScenarioOutput {
	const dropReason = { step: "phone" as const, reason: `phone_${reason}` };
	if (state.audience === "self") {
		return output(
			{ ...fresh(state), step: "subscribe" },
			[{ text: t.phone_declined }, subscribeQuestion(t)],
			{ dropReason },
		);
	}
	return output({ ...state, step: "done" }, [{ text: t.phone_declined }], {
		dropReason,
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
		marketingConsent: state.marketingConsent,
		consentAt: state.consentAt,
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
	campaign?: GuideCampaignContext | null,
): ScenarioOutput | null {
	switch (state.step) {
		case "entry": {
			if (action === "sc_consult") return startConsultation(t);
			if (action === "sc_guide") {
				return output(
					{ ...fresh(state), step: "consent", flow: "guide" },
					[consentQuestion(t)],
					{ track: ["guide_click"] },
				);
			}
			return null;
		}

		case "consent": {
			if (action === "consent_agree") {
				return output(
					{
						...fresh(state),
						step: "marketing_consent",
						consentAt: new Date().toISOString(),
					},
					[{ text: t.consent_agreed }, marketingConsentQuestion(t)],
					{ track: ["consent"] },
				);
			}
			if (action === "consent_decline") {
				return output(
					{ ...state, step: "done" },
					[{ text: t.consent_declined }],
					{ dropReason: { step: "consent", reason: "declined" } },
				);
			}
			return null;
		}

		case "marketing_consent": {
			if (
				action !== "marketing_consent_agree" &&
				action !== "marketing_consent_decline"
			) {
				return null;
			}
			const marketingConsent = action === "marketing_consent_agree";
			const consentReply = {
				text: marketingConsent
					? t.marketing_consent_agreed
					: t.marketing_consent_declined,
			};
			// Вход по кодовому слову кампании — тема уже известна, category/issue
			// не спрашиваем, сразу переходим к email (ветка «ребёнок»: email →
			// гайд → телефон → done, см. submitGuidePhone).
			if (state.campaignId) {
				return output(
					{
						...fresh(state),
						step: "email",
						marketingConsent,
						audience: "child",
					},
					[
						consentReply,
						campaign ? { text: campaign.emailQuestion } : emailQuestion(t),
					],
					{ track: ["marketing_consent"] },
				);
			}
			const isGuide = state.flow === "guide";
			return output(
				{
					...fresh(state),
					step: isGuide ? "category" : "name",
					marketingConsent,
				},
				[
					consentReply,
					isGuide ? categoryQuestion(t) : { text: t.name_question },
				],
				{ track: ["marketing_consent"] },
			);
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
			if (
				action !== "sc_eating" &&
				action !== "sc_ocd" &&
				action !== "sc_other"
			) {
				return null;
			}
			const issue: ScenarioIssue =
				action === "sc_eating"
					? "eating"
					: action === "sc_ocd"
						? "ocd"
						: "other";
			const next = { ...state, issue };
			if (state.audience === "child") {
				return output({ ...fresh(next), step: "email" }, [emailQuestion(t)], {
					track: ["issue"],
				});
			}
			return askForPhone(next, t, [], ["issue"]);
		}

		case "email": {
			if (action !== "sc_skip_email") return null;
			if (state.flow === "consult")
				return submitConsultLead(state, undefined, t);
			// Кампания требует email — кнопки пропуска в её вопросе нет (см.
			// questions.ts: campaign.emailQuestion шлётся без buttons), сюда
			// дойти нельзя, но не обходим правило «материал только за email».
			if (state.campaignId) return askForPhone(state, t);
			// Email не оставил — гайд всё равно выдаём прямо в чат (иначе
			// клиент остаётся вообще без материала, см. lead_magnet_no_email).
			return askForPhone(
				state,
				t,
				[{ text: t.lead_magnet_no_email, guide: true }],
				["email"],
			);
		}

		case "phone": {
			if (action !== "sc_skip_phone" || state.flow === "consult") return null;
			return declinePhone(state, t);
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
 *
 * campaign — данные кампании при state.campaignId (адаптер подгружает их
 * заново на каждый вызов, т.к. движок остаётся чистой функцией состояния и
 * не обращается к БД сам).
 */
export async function applyScenarioText(
	state: ScenarioState,
	text: string,
	t: ScenarioTexts,
	campaign?: GuideCampaignContext | null,
): Promise<ScenarioOutput | null> {
	switch (state.step) {
		case "name": {
			// Клиент иногда присылает на этот вопрос сразу весь блок контактов
			// (имя, телефон, email) одним сообщением — LLM пытается разложить
			// его на поля; если это не удалось (нет ключа, ошибка, распознать
			// не получилось), ведём себя как раньше — весь текст = имя.
			const extracted = await extractContactInfo(text);
			if (!extracted) {
				return output(
					{ ...fresh(state), step: "phone", name: text },
					[{ text: withName(t.consult_phone_question, text) }],
					{ track: ["name"] },
				);
			}

			const { name } = extracted;
			const phone =
				extracted.phone && hasPhoneNumber(extracted.phone)
					? extracted.phone.trim()
					: undefined;
			const email =
				extracted.email && isValidEmail(extracted.email)
					? extracted.email
					: undefined;

			if (phone && email) {
				return submitConsultLead({ ...fresh(state), name, phone }, email, t, [
					{
						text: withFields(t.consult_extracted_name_phone_email, {
							name,
							phone,
							email,
						}),
					},
				]);
			}

			if (phone) {
				return output(
					{ ...fresh(state), step: "email", name, phone },
					[
						{
							text: withFields(t.consult_extracted_name_phone, {
								name,
								phone,
							}),
						},
						consultEmailQuestion(t),
					],
					{ track: ["name", "phone"] },
				);
			}

			return output(
				{ ...fresh(state), step: "phone", name },
				[{ text: withName(t.consult_phone_question, name) }],
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
				if (state.campaignId && campaign) {
					return submitCampaignGuide(state, text, campaign);
				}
				return askForPhone(
					{ ...state, email: text },
					t,
					[{ text: t.lead_magnet, guide: true }],
					["email"],
					{ email: text, consentAt: state.consentAt },
				);
			}
			const attempts = (state.emailAttempts ?? 0) + 1;
			if (attempts >= MAX_ATTEMPTS) {
				// Кампания отдаёт материал только за email — без него дальше идти
				// некуда (в отличие от обычного гайда, телефон здесь не спрашиваем).
				if (state.campaignId) {
					return output(
						{ ...state, emailAttempts: attempts, step: "done" },
						[{ text: t.guide_campaign_email_invalid_final }],
						{ dropReason: { step: "email", reason: "email_invalid" } },
					);
				}
				// Не мучаем пользователя дальнейшими попытками, но материал
				// всё равно отдаём в чат — без него клиент остаётся ни с чем.
				return askForPhone(
					{ ...state, emailAttempts: attempts },
					t,
					[{ text: t.lead_magnet_no_email, guide: true }],
					["email"],
				);
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
						[consultEmailQuestion(t)],
						{ track: ["phone"] },
					);
				}
				return submitGuidePhone(state, phone, t);
			}
			const attempts = (state.phoneAttempts ?? 0) + 1;
			if (attempts >= MAX_ATTEMPTS) {
				if (state.flow === "consult") {
					// Три невалидных попытки — заявку так и не создали (в отличие от
					// email, без телефона звонить/писать клиенту нечем).
					return output(
						{ ...state, step: "done" },
						[{ text: t.consult_phone_invalid_final }],
						{ dropReason: { step: "phone", reason: "phone_invalid" } },
					);
				}
				return declinePhone(state, t, "invalid_exhausted");
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
		case "marketing_consent":
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

/** Человекочитаемая подпись нажатой кнопки — для журнала сообщений. */
export function actionLabel(action: ScenarioAction, t: ScenarioTexts): string {
	const labels: Record<ScenarioAction, string> = {
		sc_consult: t.btn_consult,
		sc_guide: t.btn_guide,
		consent_agree: t.btn_consent_agree,
		consent_decline: t.btn_consent_decline,
		marketing_consent_agree: t.btn_marketing_consent_agree,
		marketing_consent_decline: t.btn_marketing_consent_decline,
		sc_child: t.btn_child,
		sc_self: t.btn_self,
		sc_eating: t.btn_issue_eating,
		sc_ocd: t.btn_issue_ocd,
		sc_other: t.btn_issue_other,
		sc_skip_email: t.btn_skip_email,
		sc_skip_phone: t.btn_skip_phone,
		sc_sub_yes: t.btn_subscribe_yes,
		sc_sub_no: t.btn_subscribe_no,
	};
	return labels[action];
}

/**
 * Комментарий к сделке для менеджера — что выбрал пользователь.
 * campaignTitle — тема кампании, если заявка пришла по кодовому слову
 * (см. GuideCampaignContext.title); в остальном лид не отличить от обычной
 * ветки «Получить гайд».
 */
export function describeLead(
	lead: ScenarioLead,
	t: ScenarioTexts,
	campaignTitle?: string,
): string {
	const marketingConsentLine = `Согласие на рекламную рассылку: ${lead.marketingConsent ? "да" : "нет"}`;
	if (lead.flow === "consult") {
		return `Заявка: ${t.btn_consult}\n${marketingConsentLine}`;
	}
	if (campaignTitle) {
		return `Заявка: гайд по кодовому слову «${campaignTitle}»\n${marketingConsentLine}`;
	}
	const audience = lead.audience === "child" ? t.btn_child : t.btn_self;
	const issue =
		lead.issue === "eating"
			? t.btn_issue_eating
			: lead.issue === "ocd"
				? t.btn_issue_ocd
				: t.btn_issue_other;
	return `Заявка: ${t.btn_guide}\nКатегория: ${audience}\nТема: ${issue}\n${marketingConsentLine}`;
}
