import type { BitrixApi } from "@psi-opora/bitrix-client";
import { z } from "zod";
import { crmUrl } from "./crm-urls";
import type { CrmPhone } from "./types";

export interface RawCrmContact {
	NAME?: string;
	LAST_NAME?: string;
	PHONE?: unknown;
}

/** Мультиполе PHONE контакта: `[{ ID, VALUE_TYPE, VALUE }]`. Ответ Bitrix —
 * внешние данные, поэтому разбираем схемой, битые элементы пропускаем. */
const phoneFieldSchema = z
	.array(
		z
			.object({
				ID: z.union([z.string(), z.number()]).optional(),
				VALUE: z.string().optional(),
			})
			.passthrough(),
	)
	.catch([]);

export function parseContactPhones(
	raw: RawCrmContact | null | undefined,
): CrmPhone[] {
	return phoneFieldSchema.parse(raw?.PHONE ?? []).flatMap((item) => {
		const value = item.VALUE?.trim();
		if (!value) return [];
		return [{ id: item.ID !== undefined ? String(item.ID) : null, value }];
	});
}

/** crm.duplicate.findbycomm: `{ CONTACT: [id, …] }`, а если совпадений нет —
 * пустой массив вместо объекта. */
const duplicatesSchema = z
	.object({
		CONTACT: z.array(z.union([z.number(), z.string()])).optional(),
	})
	.passthrough();

/** ID контактов CRM, у которых уже записан этот телефон (Bitrix сам
 * сравнивает номера без учёта формата записи). */
export async function findContactIdsByPhone(
	api: BitrixApi,
	phone: string,
): Promise<string[]> {
	const result = await api.call<unknown>("crm.duplicate.findbycomm", {
		entity_type: "CONTACT",
		type: "PHONE",
		values: [phone],
	});
	const parsed = duplicatesSchema.safeParse(result);
	if (!parsed.success) return [];
	return (parsed.data.CONTACT ?? []).map(String);
}

export interface CrmContactRef {
	id: string;
	name: string;
	url: string | null;
}

export function contactDisplayName(
	raw: RawCrmContact | null | undefined,
	id: string,
): string {
	return (
		[raw?.NAME, raw?.LAST_NAME].filter(Boolean).join(" ") || `Контакт #${id}`
	);
}

/** Имя и ссылка на карточку для списка контактов — чтобы оператор видел,
 * с кем совпал номер. Недоступный контакт показываем по ID. */
export async function loadContactRefs(
	api: BitrixApi,
	domain: string | null,
	ids: string[],
): Promise<CrmContactRef[]> {
	return Promise.all(
		ids.map(async (id) => {
			const raw = await api
				.call<RawCrmContact>("crm.contact.get", { id })
				.catch(() => null);
			return {
				id,
				name: contactDisplayName(raw, id),
				url: crmUrl(domain, "contact", id),
			};
		}),
	);
}
