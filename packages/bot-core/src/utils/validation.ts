import { z } from "zod";

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

/**
 * Строгая схема номера телефона — в отличие от hasPhoneNumber (которая
 * годится для "похоже, что где-то есть номер" в свободном тексте), требует,
 * чтобы вся строка состояла из телефонных символов и содержала не меньше 7
 * цифр — так "-------" или "       " (проходят hasPhoneNumber) отклоняются.
 */
const phoneNumberSchema = z
	.string()
	.trim()
	.regex(/^[\d\s+\-()]{7,}$/)
	.refine((value) => (value.match(/\d/g)?.length ?? 0) >= 7)
	.transform((value) => value.replace(/[\s\-()]/g, ""));

/** Валидирует и нормализует номер телефона. null — строка не похожа на номер. */
export function parsePhoneNumber(text: string): string | null {
	const result = phoneNumberSchema.safeParse(text);
	return result.success ? result.data : null;
}
