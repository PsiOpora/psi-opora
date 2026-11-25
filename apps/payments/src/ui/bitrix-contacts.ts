import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import { env } from "@psi-opora/config";

/**
 * Имена и поиск контактов Bitrix24 для экранов. Всё best-effort: если Bitrix
 * недоступен, экраны остаются рабочими и показывают просто ID контакта.
 */

export interface ContactInfo {
	id: string;
	name: string;
}

interface RawContact {
	ID: string;
	NAME?: string | null;
	LAST_NAME?: string | null;
}

const toInfo = (c: RawContact): ContactInfo => ({
	id: String(c.ID),
	name: [c.LAST_NAME, c.NAME].filter(Boolean).join(" ") || `Контакт ${c.ID}`,
});

export async function getContactNames(
	ids: string[],
): Promise<Map<string, string>> {
	const names = new Map<string, string>();
	const unique = [...new Set(ids)].filter(Boolean);
	const api = resolveBitrixApi(env.BITRIX_MEMBER_ID);
	if (!api || unique.length === 0) return names;
	try {
		const rows = await api.call<RawContact[]>("crm.contact.list", {
			filter: { ID: unique },
			select: ["ID", "NAME", "LAST_NAME"],
		});
		for (const row of rows) {
			const info = toInfo(row);
			names.set(info.id, info.name);
		}
	} catch (err) {
		console.error(`[payments] не удалось получить имена контактов: ${err}`);
	}
	return names;
}

/** Поиск по ID, телефону или фрагменту имени/фамилии. */
export async function searchContacts(query: string): Promise<ContactInfo[]> {
	const q = query.trim();
	const api = resolveBitrixApi(env.BITRIX_MEMBER_ID);
	if (!q || !api) return [];
	try {
		const digits = q.replace(/\D/g, "");
		if (digits.length >= 10) {
			const phone = digits.length === 10 ? `7${digits}` : digits;
			const found = await api.call<{ CONTACT?: unknown[] } | null>(
				"crm.duplicate.findbycomm",
				{
					type: "PHONE",
					values: [`+${phone.replace(/^8/, "7")}`],
					entity_type: "CONTACT",
				},
			);
			const ids = (found?.CONTACT ?? []).map(String);
			return [...(await getContactNames(ids))].map(([id, name]) => ({
				id,
				name,
			}));
		}
		if (/^\d+$/.test(q)) {
			const names = await getContactNames([q]);
			return [...names].map(([id, name]) => ({ id, name }));
		}
		const rows = await api.call<RawContact[]>("crm.contact.list", {
			filter: { LOGIC: "OR", "%NAME": q, "%LAST_NAME": q },
			select: ["ID", "NAME", "LAST_NAME"],
			order: { ID: "DESC" },
		});
		return rows.slice(0, 30).map(toInfo);
	} catch (err) {
		console.error(`[payments] поиск контактов не удался: ${err}`);
		return [];
	}
}
