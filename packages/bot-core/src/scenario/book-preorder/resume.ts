import type { ScenarioTexts } from "../texts";
import { output } from "./engine";
import {
	bpAboutBookQuestion,
	bpConsentQuestion,
	bpReservedQuestion,
} from "./questions";
import type { BookPreorderOutput, BookPreorderState } from "./types";

/**
 * Повторный /start TELOPAY|TELOBOOK при уже существующей сессии — вместо
 * startBookPreorder (который затирает имя/телефон/сделку и опрашивает всё
 * заново), просто повторяет вопрос текущего шага. На "awaiting_payment"
 * пересылает ту же ссылку на оплату (buildPaymentLink детерминирован по
 * orderNo — см. dispatch.ts). На "done" после «Оплата позже» возвращает к
 * выбору «Оплатить сейчас»/«Оплата позже» (см. bp_pay_later в engine.ts).
 * На "done" по другой причине (отмена/emailFailed) резюмировать нечего —
 * null, вызывающий код должен начать сценарий заново.
 */
export function resumeBookPreorder(
	state: BookPreorderState,
	t: ScenarioTexts,
): BookPreorderOutput | null {
	switch (state.step) {
		case "consent":
			return output(state, [bpConsentQuestion(t)]);
		case "name":
			return output(state, [{ text: t.bp_name_question }]);
		case "phone":
			return output(state, [{ text: t.bp_phone_question }]);
		case "about_book":
			return output(state, [bpAboutBookQuestion(state.name, t)]);
		case "email_for_payment":
			return output(state, [{ text: t.bp_payment_intro_text }]);
		case "reserved":
			return output(state, [bpReservedQuestion(state.name, t)]);
		case "awaiting_payment":
			return output(state, [], { buildPaymentLink: true });
		case "done":
			if (state.paymentDeferred && state.dealId) {
				return output({ ...state, step: "reserved", nudged: 0 }, [
					bpReservedQuestion(state.name, t),
				]);
			}
			return null;
		default:
			return null;
	}
}
