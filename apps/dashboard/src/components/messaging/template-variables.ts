/** Переменные шаблона — подставляются при вставке в поле ввода. */
export const TEMPLATE_VARIABLES_HINT = "{имя} — имя клиента";

/** Подставляет в шаблон имя клиента (первое слово ФИО); без имени убирает
 * переменную вместе с запятой перед ней, чтобы не отправить «Здравствуйте, {имя}!». */
export function applyTemplateVariables(
	text: string,
	contactName: string,
): string {
	const firstName = contactName.trim().split(/\s+/)[0] ?? "";
	if (firstName) return text.replace(/\{имя\}/giu, firstName);
	return text.replace(/,?\s*\{имя\}/giu, "");
}
