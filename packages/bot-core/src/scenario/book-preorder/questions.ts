import { withFields, withName } from "../questions";
import type { ScenarioTexts } from "../texts";
import type { BookPreorderMessage, BookPreorderState } from "./types";

export function bpConsentQuestion(t: ScenarioTexts): BookPreorderMessage {
	return {
		text: t.bp_consent_text,
		buttons: [[{ label: t.bp_btn_consent_agree, action: "bp_consent_agree" }]],
	};
}

export function bpAboutBookQuestion(
	name: string | undefined,
	t: ScenarioTexts,
): BookPreorderMessage {
	return {
		text: withName(t.bp_about_book_text, name),
		buttons: [
			[{ label: t.bp_btn_reserve_free, action: "bp_reserve_free" }],
			[{ label: t.bp_btn_pay_now, action: "bp_pay_now" }],
		],
	};
}

/**
 * Тот же рассказ о книге, но без кнопок выбора — для входа с лендинга по
 * кнопке с уже известным намерением (см. BookPreorderState.intent):
 * контекст читателю нужен, а повторный выбор — нет, он его уже сделал на сайте.
 */
export function bpAboutBookInfoMessage(
	name: string | undefined,
	t: ScenarioTexts,
): BookPreorderMessage {
	return { text: withName(t.bp_about_book_text, name) };
}

export function bpReservedQuestion(
	name: string | undefined,
	t: ScenarioTexts,
): BookPreorderMessage {
	return {
		text: withName(t.bp_reserved_text, name),
		buttons: [
			[{ label: t.bp_btn_pay_now, action: "bp_pay_now" }],
			[{ label: t.bp_btn_pay_later, action: "bp_pay_later" }],
		],
	};
}

/** Вопрос текущего шага — для повтора при неожиданном тексте на кнопочном шаге. */
export function bpStepQuestion(
	state: BookPreorderState,
	t: ScenarioTexts,
): BookPreorderMessage | null {
	switch (state.step) {
		case "consent":
			return bpConsentQuestion(t);
		case "about_book":
			return bpAboutBookQuestion(state.name, t);
		case "reserved":
			return bpReservedQuestion(state.name, t);
		default:
			return null;
	}
}

export function bpPaymentLinkMessage(
	url: string,
	sum: number,
	t: ScenarioTexts,
): BookPreorderMessage {
	return {
		text: withFields(t.bp_payment_link_text, {
			ссылка: url,
			сумма: `${sum} ₽`,
			оферта: "https://psi-opora.ru/oferta-kurs-rod/",
		}),
		buttons: [
			[{ label: t.bp_btn_confirm_payment, action: "bp_confirm_payment" }],
		],
	};
}
