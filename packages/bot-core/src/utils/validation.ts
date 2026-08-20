/**
 * Утилиты для валидации пользовательского ввода в ботах.
 * Используются в TG и MAX ботах.
 */

/** Проверяет, содержит ли строка что-то похожее на номер телефона. */
export function hasPhoneNumber(text: string): boolean {
	return /[\d\s+\-()]{7,}/.test(text);
}

/** Проверяет корректность email-адреса. */
export function isValidEmail(text: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
}
