import { z } from "zod";
import { inboxMessengerSchema } from "./messages";

/** Символы, из которых может состоять записанный человеком номер. */
const PHONE_CHARS = /^[\d\s+\-().]+$/;

/**
 * Приводит введённый оператором/клиентом номер к E.164-подобному виду
 * `+79991234567`. Рассчитано на российские номера, но не ломает
 * международные: `8 999 …`/`7 999 …`/`999 …` (10 цифр с 9) → `+7…`,
 * остальное с 11–15 цифрами — `+` и цифры как есть.
 * `null` — строка не похожа на телефон (слишком коротко/длинно, буквы).
 *
 * Общая для сервера (setClientPhone) и браузера (живая валидация поля в
 * apps/clients) — поэтому лежит в client-safe схемах.
 */
export function normalizePhone(input: string): string | null {
	const value = input.trim();
	if (!value || !PHONE_CHARS.test(value)) return null;
	const hasPlus = value.startsWith("+");
	const digits = value.replace(/\D/g, "");

	if (!hasPlus) {
		if (digits.length === 11 && /^[78]/.test(digits)) {
			return `+7${digits.slice(1)}`;
		}
		if (digits.length === 10 && digits.startsWith("9")) return `+7${digits}`;
	}
	if (digits.length < 11 || digits.length > 15) return null;
	return `+${digits}`;
}

/** Последовательности цифр с телефонными разделителями внутри текста. */
const PHONE_IN_TEXT = /\+?\d[\d\s().-]{8,}\d/g;

/**
 * Номера телефонов, упомянутые в свободном тексте («мой номер 8 999 …»),
 * уже нормализованные и без повторов. Даты, суммы и номера карт отсекаются
 * normalizePhone по количеству цифр.
 */
export function extractPhones(text: string): string[] {
	const found = new Set<string>();
	for (const match of text.matchAll(PHONE_IN_TEXT)) {
		const phone = normalizePhone(match[0]);
		if (phone) found.add(phone);
	}
	return [...found];
}

/** Одинаковые ли это номера — сравнение по нормализованной форме. */
export function samePhone(a: string, b: string): boolean {
	const left = normalizePhone(a) ?? a.replace(/\D/g, "");
	const right = normalizePhone(b) ?? b.replace(/\D/g, "");
	return left === right;
}

/** `+79991234567` → `+7 999 123-45-67`; прочие номера — без изменений. */
export function formatPhone(phone: string): string {
	const match = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/.exec(phone);
	return match ? `+7 ${match[1]} ${match[2]}-${match[3]}-${match[4]}` : phone;
}

export const setClientPhoneSchema = z.object({
	messenger: inboxMessengerSchema,
	userId: z.string(),
	phone: z.string().refine((value) => normalizePhone(value) !== null, {
		message: "Номер не похож на телефон — нужно 10–15 цифр",
	}),
	/** ID значения мультиполя PHONE контакта — исправить этот номер, а не
	 * добавить ещё один. */
	replaceValueId: z.string().optional(),
	/** У диалога нет контакта, а номер уже записан у контакта CRM: привязать
	 * диалог к этому контакту (ID из conflict предыдущего ответа)… */
	linkContactId: z.string().optional(),
	/** …или всё равно завести новый контакт. Без обоих флагов сервер
	 * возвращает conflict и ждёт решения оператора. */
	createNew: z.boolean().optional(),
});
export type SetClientPhoneInput = z.infer<typeof setClientPhoneSchema>;
