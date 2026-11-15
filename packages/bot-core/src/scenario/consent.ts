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
 * Клиент пишет, что отзывает согласие на обработку ПДн или просит удалить
 * свои данные («Прошу отозвать согласие…», «согласие отзываю», «удалите мои
 * персональные данные»). Юридически значимая просьба — бот не должен
 * продолжать сценарий или присылать напоминания, а оператор должен о ней узнать.
 * Фразу ограничиваем одним предложением, чтобы «отзыв» в обычном смысле
 * («оставила отзыв… согласие на консультацию») не срабатывал.
 */
const CONSENT_REVOCATION_RE =
	/(?:отзов|отозв|отзыв)[^.!?\n]{0,80}согласи|согласи[^.!?\n]{0,60}(?:отзов|отозв|отзыв)|(?:удал|уничтож|прекрат)\S*[^.!?\n]{0,40}(?:персональн|мои\s+(?:данн|личн))/i;

export function looksLikeConsentRevocation(text: string): boolean {
	return CONSENT_REVOCATION_RE.test(text);
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
