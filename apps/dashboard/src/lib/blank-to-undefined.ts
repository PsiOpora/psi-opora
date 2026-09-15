/**
 * Пустые строковые поля формы превращает в `undefined`, чтобы oRPC-мутация
 * не затирала уже сохранённое значение (секрет, ключ) пустой строкой —
 * `undefined` в `.set()` drizzle трактует как «не менять колонку».
 */
export function blankToUndefined<T extends Record<string, unknown>>(
	values: T,
): T {
	const result = { ...values };
	for (const key in result) {
		if (result[key] === "") {
			result[key] = undefined as T[Extract<keyof T, string>];
		}
	}
	return result;
}
