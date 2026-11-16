/**
 * Запасной поиск аккаунта в мессенджере — по карточке контакта в CRM.
 *
 * Личные номера MAX/Telegram ищут человека по телефону из списка рассылки.
 * Не нашли (номер скрыт настройками приватности, в мессенджере записан другой
 * номер, контакт без телефона в этом аккаунте) — смотрим карточку контакта в
 * Bitrix24 (она находится по тому же телефону, crm.duplicate.findbycomm): там
 * мог остаться ID или username из поля «Мессенджер» (IM) или из UF-полей
 * интеграций (Wazzup: TelegramId_WZ, TelegramUsername_WZ…). Если аккаунт есть —
 * отправляем по нему.
 *
 * Логика извлечения повторяет packages/api/src/broadcast-send.ts (рассылка по
 * стадии): jobs не может импортировать api (api зависит от jobs), поэтому
 * здесь — короткая самостоятельная версия.
 *
 * Ошибки CRM не роняют отправку: возвращается пустой результат, а причина
 * (error) попадёт в отчёт, если аккаунт так и не нашёлся.
 */

export interface CardTelegramTarget {
	/** Числовой ID пользователя — приоритетнее username. */
	userId?: string;
	username?: string;
}

export interface CardTargets {
	telegram?: CardTelegramTarget;
	/** Числовой ID пользователя MAX. */
	max?: string;
	/** Сбой поиска в CRM — только если из-за него аккаунт мог не найтись. */
	error?: string;
}

export interface CardContact {
	IM?: Array<{ VALUE?: string; VALUE_TYPE?: string }>;
	[field: string]: unknown;
}

export interface CardTargetDeps {
	/** ID контактов CRM с этим телефоном; null — CRM недоступна. */
	findContactIdsByPhone: ((phone: string) => Promise<string[]>) | null;
	getContact: (contactId: string) => Promise<CardContact | null>;
	/** Коды UF-полей контакта с данными Telegram/MAX (см. discoverCardFields). */
	getFieldCodes: () => Promise<{ telegram: string[]; max: string[] }>;
}

/** Больше контактов на один номер — почти наверняка дубли, хватит первых. */
const CONTACTS_LIMIT = 5;

function toStrings(raw: unknown): string[] {
	const out: string[] = [];
	for (const value of Array.isArray(raw) ? raw : [raw]) {
		if (typeof value === "string" && value.trim()) out.push(value.trim());
		else if (typeof value === "number") out.push(String(value));
	}
	return out;
}

/**
 * Какие UF-поля контакта хранят Telegram/MAX: по коду и подписям поля
 * (названия у интеграций разные, поэтому шаблон, а не фиксированный список).
 */
export function classifyContactFields(
	defs: Record<string, Record<string, unknown>>,
): { telegram: string[]; max: string[] } {
	const telegram: string[] = [];
	const max: string[] = [];
	for (const [code, def] of Object.entries(defs)) {
		if (!code.startsWith("UF_")) continue;
		const haystack = [
			code,
			def.title,
			def.listLabel,
			def.formLabel,
			def.editFormLabel,
			def.filterLabel,
		]
			.filter((v): v is string => typeof v === "string")
			.join(" ");
		if (/telegram|телеграм/i.test(haystack)) {
			telegram.push(code);
		} else if (/max/i.test(haystack) && /\bid\b|id_|_id|id$/i.test(haystack)) {
			max.push(code);
		}
	}
	return { telegram, max };
}

/** Значения IM-поля контакта: VALUE_TYPE "telegram"/"max" — числовой ID от наших ботов. */
function imValues(contact: CardContact, messenger: "telegram" | "max") {
	return (contact.IM ?? []).flatMap((im) => {
		const value = im.VALUE?.trim() ?? "";
		return value && im.VALUE_TYPE?.toLowerCase() === messenger ? [value] : [];
	});
}

/** Telegram из карточки: числовое значение — ID, остальное — username. */
export function telegramFromCard(
	contact: CardContact,
	ufCodes: string[],
): CardTelegramTarget | null {
	const candidates = [
		...imValues(contact, "telegram"),
		...ufCodes.flatMap((code) => toStrings(contact[code])),
	];
	let username: string | undefined;
	for (const value of candidates) {
		if (/^\d+$/.test(value)) return { userId: value };
		const cleaned = value
			.replace(/^https?:\/\/t\.me\//i, "")
			.replace(/^@/, "")
			.trim();
		if (!username && /^[A-Za-z0-9_]{4,}$/.test(cleaned)) username = cleaned;
	}
	return username ? { username } : null;
}

/** MAX из карточки — нужен числовой ID пользователя. */
export function maxFromCard(
	contact: CardContact,
	ufCodes: string[],
): string | null {
	const candidates = [
		...imValues(contact, "max"),
		...ufCodes.flatMap((code) => toStrings(contact[code])),
	];
	return candidates.find((value) => /^\d+$/.test(value)) ?? null;
}

export async function resolveCardTargets(
	phone: string,
	deps: CardTargetDeps,
): Promise<CardTargets> {
	if (!deps.findContactIdsByPhone) return {};
	const targets: CardTargets = {};
	try {
		const contactIds = (await deps.findContactIdsByPhone(phone)).slice(
			0,
			CONTACTS_LIMIT,
		);
		if (contactIds.length === 0) return targets;
		const fields = await deps.getFieldCodes();
		for (const contactId of contactIds) {
			if (targets.telegram && targets.max) break;
			const contact = await deps.getContact(contactId);
			if (!contact) continue;
			if (!targets.telegram) {
				const telegram = telegramFromCard(contact, fields.telegram);
				if (telegram) targets.telegram = telegram;
			}
			if (!targets.max) {
				const max = maxFromCard(contact, fields.max);
				if (max) targets.max = max;
			}
		}
	} catch (err) {
		targets.error = `поиск в карточке контакта CRM не удался: ${(err as Error).message}`;
	}
	return targets;
}

/**
 * Поиск с памятью на последний телефон: если по номеру не нашёлся ни MAX, ни
 * Telegram, карточку не запрашиваем дважды.
 */
export function memoizeLastCardPhone(
	resolve: (phone: string) => Promise<CardTargets>,
): (phone: string) => Promise<CardTargets> {
	let last: { phone: string; result: Promise<CardTargets> } | null = null;
	return (phone) => {
		if (last?.phone !== phone) last = { phone, result: resolve(phone) };
		return last.result;
	};
}

/** Реальные зависимости поиска для портала рассылки. */
export async function createCardTargetLookup(
	memberId: string,
): Promise<(phone: string) => Promise<CardTargets>> {
	const { resolveBitrixApi } = await import("@psi-opora/bitrix-client");
	const api = resolveBitrixApi(memberId);

	let fieldCodes: Promise<{ telegram: string[]; max: string[] }> | null = null;
	const deps: CardTargetDeps = {
		findContactIdsByPhone: api
			? async (phone) => {
					const result = await api.call<{
						CONTACT?: Array<number | string>;
					} | null>("crm.duplicate.findbycomm", {
						entity_type: "CONTACT",
						type: "PHONE",
						values: [phone],
					});
					// Без совпадений Bitrix отвечает пустым массивом, а не объектом.
					const ids =
						result && !Array.isArray(result) && Array.isArray(result.CONTACT)
							? result.CONTACT
							: [];
					return ids.map(String);
				}
			: null,
		getContact: async (contactId) =>
			api
				? await api.call<CardContact | null>("crm.contact.get", {
						id: contactId,
					})
				: null,
		// Описание полей одно на портал — запрашиваем один раз за запуск.
		getFieldCodes: () => {
			fieldCodes ??= (async () => {
				if (!api) return { telegram: [], max: [] };
				const defs = await api.call<Record<string, Record<string, unknown>>>(
					"crm.contact.fields",
					{},
				);
				return classifyContactFields(defs ?? {});
			})().catch((err: unknown) => {
				fieldCodes = null;
				throw err;
			});
			return fieldCodes;
		},
	};
	return memoizeLastCardPhone((phone) => resolveCardTargets(phone, deps));
}
