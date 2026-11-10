import type { KnownContact, ScenarioAction, ScenarioState } from "./types";

/**
 * Клиент распознан в CRM (см. resolveKnownContact в
 * utils/bitrix/known-contact.ts), и в его карточке уже отмечено согласие на
 * обработку ПДн — экран согласия повторно не показываем.
 *
 * Просто «контакт есть в CRM» недостаточно: его мог завести оператор или
 * другой канал, без согласия.
 */
export function hasRecordedConsent(
	knownContact: KnownContact | null | undefined,
): knownContact is KnownContact {
	return knownContact?.consentGranted === true;
}

/**
 * Нужно ли адаптеру искать клиента в CRM перед applyScenarioAction: только
 * там, где следующим сообщением был бы экран согласия (его можно пропустить)
 * или где согласие только что дано в флоу консультации (подстановка
 * имени/телефона/email). На остальных шагах лишний поход в Bitrix не нужен.
 */
export function needsKnownContact(
	state: ScenarioState | undefined,
	action: ScenarioAction,
): boolean {
	if (!state) return false;
	if (state.step === "entry") {
		return action === "sc_consult" || action === "sc_guide";
	}
	return (
		state.step === "consent" &&
		state.flow === "consult" &&
		action === "consent_agree"
	);
}
