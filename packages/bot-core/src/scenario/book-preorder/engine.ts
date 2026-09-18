import { isValidEmail, parsePhoneNumber } from "../../utils/validation";
import type { ScenarioTexts } from "../texts";
import {
	bpAboutBookInfoMessage,
	bpAboutBookQuestion,
	bpConsentQuestion,
	bpReservedQuestion,
	bpStepQuestion,
} from "./questions";
import type {
	BookPreorderAction,
	BookPreorderIntent,
	BookPreorderMessage,
	BookPreorderOutput,
	BookPreorderState,
} from "./types";

export type {
	BookPreorderIntent,
	BookPreorderLead,
	BookPreorderMessage,
	BookPreorderOutput,
	BookPreorderState,
	BookPreorderStep,
} from "./types";
export {
	BOOK_PREORDER_ACTIONS,
	type BookPreorderAction,
	isBookPreorderAction,
} from "./types";

/**
 * Сценарий предзаказа книги «Тело берёт своё» (psi-opora.ru/telo-beret-svoe/).
 *
 * Отдельная, не связанная с ../engine.ts машина состояний: свои шаги, реальная
 * оплата (Prodamus/payform.ru) и многодневная рассылка
 * (packages/jobs/src/book-preorder-drip.ts) — общего с флоу консультации/гайда
 * почти нет, кроме общего key-value хранилища текстов (../texts.ts). Сделки
 * Bitrix остаются в обычной стадии — отдельную воронку завести не вышло
 * (ограничение тарифа на crm.dealcategory.add), статус заказа отслеживается
 * в book_preorder_orders.status и комментариях сделки.
 *
 * Дерево:
 *   /start TELO|TELOPAY|TELOBOOK → согласие на ПДн → имя → телефон →
 *   ├── /start TELOBOOK (кнопка «Забронировать» на лендинге, intent=reserve)
 *   │     → рассказ о книге без кнопок → бронь (создаётся сделка/заказ,
 *   │       paymentChoice=deferred) → «Оплатить сейчас» / «Ещё отрывок» / «Вопрос»
 *   ├── /start TELOPAY (кнопка «Оформить предзаказ», intent=pay)
 *   │     → рассказ о книге без кнопок → email → ссылка на оплату сразу
 *   └── /start TELO (без выбора на сайте) → рассказ о книге с двумя кнопками
 *         «Забронировать бесплатно» / «Оплатить 1 980 ₽» — дальше как выше
 *
 * В любой из веток «Оплатить» ведёт к email → ссылке на оплату (сделка/заказ
 * создаются здесь, если ещё не было брони) → ждём вебхук Prodamus (см.
 * apps/bitrix-webhook/src/payform-webhook.ts). Матчинг /start-параметра —
 * см. matchesBookPreorderStartParam в utils/utm.ts.
 *
 * Кнопки цепочки напоминаний Б1–Б6 не проходят через этот движок — сессия к
 * моменту рассылки давно истекла, они адресуются напрямую по orderId
 * (см. book-preorder/drip-actions.ts).
 */

const MAX_NUDGE = 3;
const MAX_PHONE_ATTEMPTS = 2;
const MAX_EMAIL_ATTEMPTS = 3;
const NAME_MAX_LENGTH = 40;
const NAME_LINK_RE = /https?:\/\/|www\./i;
const PAID_TEXT_RE = /оплат/i;
const CANCEL_TEXT_RE = /^отмен/i;

/** Собирает результат шага предзаказа и признак ожидания ввода. */
export function output(
	state: BookPreorderState,
	messages: BookPreorderMessage[],
	extra: Partial<
		Pick<
			BookPreorderOutput,
			| "lead"
			| "buildPaymentLink"
			| "manualPaymentCheck"
			| "cancelReservation"
			| "emailFailed"
			| "paymentDeferred"
		>
	> = {},
): BookPreorderOutput {
	return {
		state,
		messages,
		awaitingInput: state.step !== "done",
		...extra,
	};
}

function manualPaymentCheckOutput(
	state: BookPreorderState,
	t: ScenarioTexts,
): BookPreorderOutput {
	return output(state, [{ text: t.bp_manual_payment_check_reply }], {
		manualPaymentCheck: true,
	});
}

/**
 * Переход в "reserved": и по кнопке «Забронировать бесплатно» из рассказа о
 * книге, и сразу после телефона для тех, кто пришёл по кнопке «Забронировать»
 * с лендинга (см. afterPhoneOutput) — общая логика заявки на бесплатную
 * бронь, чтобы условия/поля лида не расходились между двумя входами.
 */
function enterReserved(
	state: BookPreorderState,
	t: ScenarioTexts,
	leadingMessages: BookPreorderMessage[] = [],
): BookPreorderOutput {
	return output(
		{ ...state, step: "reserved", nudged: 0 },
		[...leadingMessages, bpReservedQuestion(state.name, t)],
		{
			lead: {
				name: state.name,
				phone: state.phone,
				consentAt: state.consentAt,
				paymentChoice: "deferred",
			},
		},
	);
}

/**
 * Шаг сразу после телефона: если человек пришёл с лендинга уже с выбранной
 * веткой (state.intent — см. matchesBookPreorderStartParam), показываем
 * рассказ о книге без кнопок выбора и сразу ведём по этой ветке — повторно
 * спрашивать «забронировать или оплатить» незачем, кнопку на сайте он уже
 * нажал. Без intent (голый /start TELO) — прежнее поведение: рассказ с
 * двумя кнопками (см. bpAboutBookQuestion).
 */
function afterPhoneOutput(
	state: BookPreorderState,
	t: ScenarioTexts,
): BookPreorderOutput {
	if (state.intent === "reserve") {
		return enterReserved(state, t, [bpAboutBookInfoMessage(state.name, t)]);
	}
	if (state.intent === "pay") {
		return output({ ...state, step: "email_for_payment" }, [
			bpAboutBookInfoMessage(state.name, t),
			{ text: t.bp_payment_intro_text },
		]);
	}
	return output({ ...state, step: "about_book" }, [
		bpAboutBookQuestion(state.name, t),
	]);
}

export function startBookPreorder(
	t: ScenarioTexts,
	source?: string,
	intent?: BookPreorderIntent,
): BookPreorderOutput {
	return output({ step: "consent", source, intent }, [bpConsentQuestion(t)]);
}

/** Применяет действие кнопки к текущему состоянию предзаказа книги. */
export function applyBookPreorderAction(
	state: BookPreorderState,
	action: BookPreorderAction,
	t: ScenarioTexts,
): BookPreorderOutput | null {
	switch (state.step) {
		case "consent": {
			if (action !== "bp_consent_agree") return null;
			return output(
				{
					...state,
					step: "name",
					consentAt: new Date().toISOString(),
					nudged: 0,
				},
				[{ text: t.bp_name_question }],
			);
		}

		case "about_book": {
			if (action === "bp_reserve_free") {
				return enterReserved(state, t);
			}
			if (action === "bp_pay_now") {
				return output({ ...state, step: "email_for_payment" }, [
					{ text: t.bp_payment_intro_text },
				]);
			}
			return null;
		}

		case "reserved": {
			if (action === "bp_pay_now") {
				return output({ ...state, step: "email_for_payment" }, [
					{ text: t.bp_payment_intro_text },
				]);
			}
			if (action === "bp_pay_later") {
				return output(
					{ ...state, step: "done", paymentDeferred: true },
					[{ text: t.bp_pay_later_reply }],
					{ paymentDeferred: true },
				);
			}
			return null;
		}

		case "awaiting_payment": {
			if (action === "bp_confirm_payment") {
				return manualPaymentCheckOutput(state, t);
			}
			if (action === "bp_pay_later") {
				return output(
					{ ...state, step: "done", paymentDeferred: true },
					[{ text: t.bp_pay_later_reply }],
					{ paymentDeferred: true },
				);
			}
			return null;
		}

		default:
			return null;
	}
}

/** Человекочитаемая подпись нажатой кнопки — для журнала сообщений. */
export function bpActionLabel(
	action: BookPreorderAction,
	t: ScenarioTexts,
): string {
	const labels: Record<BookPreorderAction, string> = {
		bp_consent_agree: t.bp_btn_consent_agree,
		bp_reserve_free: t.bp_btn_reserve_free,
		bp_pay_now: t.bp_btn_pay_now,
		bp_pay_later: t.bp_btn_pay_later,
		bp_confirm_payment: t.bp_btn_confirm_payment,
	};
	return labels[action];
}

export async function applyBookPreorderText(
	state: BookPreorderState,
	text: string,
	t: ScenarioTexts,
): Promise<BookPreorderOutput | null> {
	const trimmed = text.trim();

	switch (state.step) {
		case "consent":
		case "about_book": {
			const nudged = (state.nudged ?? 0) + 1;
			if (nudged > MAX_NUDGE) return null;
			const question = bpStepQuestion({ ...state, nudged }, t);
			return question ? output({ ...state, nudged }, [question]) : null;
		}

		case "reserved": {
			if (CANCEL_TEXT_RE.test(trimmed)) {
				return output(
					{ ...state, step: "done" },
					[{ text: t.bp_cancel_reply }],
					{
						cancelReservation: true,
					},
				);
			}
			const nudged = (state.nudged ?? 0) + 1;
			if (nudged > MAX_NUDGE) return null;
			return output({ ...state, nudged }, [bpReservedQuestion(state.name, t)]);
		}

		case "name": {
			const tooLong =
				trimmed.length > NAME_MAX_LENGTH || NAME_LINK_RE.test(trimmed);
			if (tooLong && !state.nameReasked) {
				return output({ ...state, nameReasked: true }, [
					{ text: t.bp_name_reask },
				]);
			}
			return output({ ...state, step: "phone", name: trimmed }, [
				{ text: t.bp_phone_question },
			]);
		}

		case "phone": {
			const phone = parsePhoneNumber(trimmed);
			if (phone) {
				return afterPhoneOutput({ ...state, phone }, t);
			}
			const attempts = (state.phoneAttempts ?? 0) + 1;
			if (attempts >= MAX_PHONE_ATTEMPTS) {
				// Не теряем человека из-за формата — идём дальше без телефона,
				// в сделке остаётся пометка (см. dispatch.ts: phoneSkipped).
				return afterPhoneOutput(
					{ ...state, phoneAttempts: attempts, phoneSkipped: true },
					t,
				);
			}
			return output({ ...state, phoneAttempts: attempts }, [
				{ text: t.bp_phone_invalid },
			]);
		}

		case "email_for_payment": {
			if (isValidEmail(trimmed)) {
				const next = {
					...state,
					step: "awaiting_payment" as const,
					email: trimmed,
				};
				return output(next, [], {
					buildPaymentLink: true,
					...(state.dealId
						? {}
						: {
								lead: {
									name: state.name,
									phone: state.phone,
									email: trimmed,
									consentAt: state.consentAt,
									paymentChoice: "immediate",
								},
							}),
				});
			}
			const attempts = (state.emailAttempts ?? 0) + 1;
			if (attempts >= MAX_EMAIL_ATTEMPTS) {
				// Без email нечего слать в Prodamus — в отличие от телефона, здесь
				// нет пути "продолжить без", поэтому завершаем сценарий, при
				// необходимости создаём сделку и оставляем менеджеру комментарий
				// на ручной дожим (см. dispatch.ts: lead и emailFailed).
				return output(
					{ ...state, step: "done", emailAttempts: attempts },
					[{ text: t.bp_email_invalid_final }],
					{
						emailFailed: true,
						...(state.dealId
							? {}
							: {
									lead: {
										name: state.name,
										phone: state.phone,
										consentAt: state.consentAt,
										paymentChoice: "immediate",
									},
								}),
					},
				);
			}
			return output({ ...state, emailAttempts: attempts }, [
				{ text: t.bp_email_invalid },
			]);
		}

		case "awaiting_payment": {
			if (PAID_TEXT_RE.test(trimmed)) {
				return manualPaymentCheckOutput(state, t);
			}
			return null;
		}

		default:
			return null;
	}
}
