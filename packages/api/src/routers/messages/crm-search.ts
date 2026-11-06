import type { BitrixApi } from "@psi-opora/bitrix-client";
import { listBitrixCrmLinksByContactIds } from "@psi-opora/db/queries";
import { jidFromPhone } from "@psi-opora/waha";
import { z } from "zod";
import { normalizePhone } from "../../schemas/phone";
import { findContactIdsByPhone } from "./client-phone-crm";

/** Токенов имени/фамилии в запросе: «Иванова Мария» → 2; лишние отбрасываем. */
const MAX_NAME_TOKENS = 3;
/** Контактов CRM на один токен — crm.contact.list всё равно отдаёт страницу в 50. */
const CONTACTS_PER_TOKEN = 30;
const MAX_CONTACT_IDS = 30;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 200;

export interface CrmSearchResult {
	/** Каналы клиентов, привязанные к найденным контактам (и личный WhatsApp с найденным номером). */
	identities: { messenger: string; userId: string }[];
	/** Найденные контакты CRM, у которых нет привязанного диалога в нашей БД. */
	unlinkedContactIds: string[];
}

const EMPTY: CrmSearchResult = { identities: [], unlinkedContactIds: [] };

const contactRowsSchema = z.array(
	z.object({ ID: z.union([z.string(), z.number()]) }).passthrough(),
);

const cache = new Map<string, { at: number; value: CrmSearchResult }>();

/** Что искать в CRM по строке поиска оператора. Чистая функция — под тесты. */
export function parseCrmSearchQuery(search: string): {
	phone: string | null;
	nameTokens: string[];
} {
	const query = search.trim();
	if (!query) return { phone: null, nameTokens: [] };
	// Частичный номер (меньше 10 цифр) Bitrix по мультиполю не ищет — только
	// точное совпадение, поэтому в CRM ходим лишь с полным номером.
	const phone = normalizePhone(query);
	if (phone) return { phone, nameTokens: [] };
	const nameTokens = query
		.split(/\s+/)
		.filter((token) => /\p{L}/u.test(token) && token.length >= 2)
		.slice(0, MAX_NAME_TOKENS);
	return { phone: null, nameTokens };
}

/** Контакты, у которых хотя бы в NAME или LAST_NAME есть подстрока. */
async function findContactIdsByNameToken(
	api: BitrixApi,
	token: string,
): Promise<Set<string>> {
	const ids = new Set<string>();
	// Один OR-фильтр в crm.contact.list не выразить, поэтому два запроса.
	for (const field of ["%LAST_NAME", "%NAME"]) {
		const raw = await api
			.call<unknown>("crm.contact.list", {
				filter: { [field]: token },
				select: ["ID"],
				order: { ID: "DESC" },
			})
			.catch(() => []);
		const parsed = contactRowsSchema.safeParse(raw);
		if (!parsed.success) continue;
		for (const row of parsed.data.slice(0, CONTACTS_PER_TOKEN)) {
			ids.add(String(row.ID));
		}
	}
	return ids;
}

/**
 * Поиск клиента по данным из CRM: по полному телефону (crm.duplicate.findbycomm
 * сам нормализует формат записи) или по фамилии/имени контакта. Находит то,
 * чего нет в наших bot_users: у нас имя — это имя в мессенджере, а телефон и
 * фамилия живут только в карточке контакта. Результат кэшируется на минуту:
 * список в инбоксе опрашивается поллингом, а Bitrix отдаёт ~2 запроса/сек.
 */
export async function searchCrmIdentities(
	api: BitrixApi,
	portalKey: string,
	search: string,
): Promise<CrmSearchResult> {
	const { phone, nameTokens } = parseCrmSearchQuery(search);
	if (!phone && nameTokens.length === 0) return EMPTY;

	const cacheKey = `${portalKey}\u0000${phone ?? nameTokens.join(" ").toLowerCase()}`;
	const cached = cache.get(cacheKey);
	if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

	let contactIds: Set<string>;
	if (phone) {
		contactIds = new Set(
			await findContactIdsByPhone(api, phone).catch(() => []),
		);
	} else {
		// Несколько слов — контакт должен подойти под каждое («Иванова Мария»).
		const perToken: Set<string>[] = [];
		for (const token of nameTokens) {
			perToken.push(await findContactIdsByNameToken(api, token));
		}
		const [first, ...rest] = perToken;
		contactIds = new Set(
			[...(first ?? [])].filter((id) => rest.every((set) => set.has(id))),
		);
	}
	const ids = [...contactIds].slice(0, MAX_CONTACT_IDS);

	const links = await listBitrixCrmLinksByContactIds(portalKey, ids).catch(
		() => [],
	);
	const linked = new Set(links.map((link) => link.contactId));
	const identities = links.map((link) => ({
		messenger: link.messenger,
		userId: link.userId,
	}));
	// Личный WhatsApp хранит номер в userId (JID) — по нему находим диалог и без привязки к контакту.
	if (phone) {
		identities.push({
			messenger: "whatsapp-personal",
			userId: jidFromPhone(phone),
		});
	}

	const value: CrmSearchResult = {
		identities,
		unlinkedContactIds: ids.filter((id) => !linked.has(id)),
	};
	if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
	cache.set(cacheKey, { at: Date.now(), value });
	return value;
}
