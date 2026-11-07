import type { BitrixApi } from "@psi-opora/bitrix-client";
import { listBitrixCrmLinksByContactIds } from "@psi-opora/db/queries";
import { jidFromPhone } from "@psi-opora/waha";
import { z } from "zod";
import { normalizePhone } from "../../schemas/phone";
import {
	type CrmContactRef,
	findContactIdsByPhone,
	loadContactRefs,
} from "./client-phone-crm";

/**
 * Слов имени/фамилии в запросе: «фамилия имя» в любом порядке. Больше двух не
 * поддерживаем — пару слов Bitrix умеет искать одним AND-фильтром, а для трёх
 * пришлось бы пересекать усечённые страницы выдачи и терять контакты.
 */
const MAX_NAME_TOKENS = 2;
const MAX_CONTACT_IDS = 30;
/** Сколько контактов без диалога показываем (и подгружаем карточками). */
const MAX_UNLINKED_CONTACTS = 5;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 200;

export interface CrmSearchResult {
	/** Каналы клиентов, привязанные к найденным контактам (и личный WhatsApp с найденным номером). */
	identities: { messenger: string; userId: string }[];
	/** Найденные контакты CRM, у которых нет привязанного диалога в нашей БД. */
	unlinkedContacts: CrmContactRef[];
}

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

/**
 * Фильтры crm.contact.list под слова запроса. Одно слово — в фамилии или в
 * имени (два запроса: OR в одном фильтре не выразить). Два слова — «фамилия
 * имя» и «имя фамилия», каждый вариант одним AND-фильтром, поэтому выдача
 * содержит ровно подходящие контакты, а не пересечение усечённых страниц.
 */
export function buildContactNameFilters(
	tokens: string[],
): Record<string, string>[] {
	const [first, second] = tokens;
	if (first === undefined) return [];
	if (second === undefined) {
		return [{ "%LAST_NAME": first }, { "%NAME": first }];
	}
	return [
		{ "%LAST_NAME": first, "%NAME": second },
		{ "%LAST_NAME": second, "%NAME": first },
	];
}

/**
 * Поиск клиента по данным из CRM: по полному телефону (crm.duplicate.findbycomm
 * сам нормализует формат записи) или по фамилии/имени контакта. Находит то,
 * чего нет в наших bot_users: у нас имя — это имя в мессенджере, а телефон и
 * фамилия живут только в карточке контакта. Результат (вместе с карточками
 * контактов без диалога) кэшируется на минуту: список в инбоксе опрашивается
 * поллингом, а Bitrix отдаёт ~2 запроса/сек. Результат с ошибкой CRM или БД не
 * кэшируется — иначе после сбоя клиент пропадал бы из поиска ещё на минуту.
 */
export async function searchCrmIdentities(
	api: BitrixApi,
	portalKey: string,
	search: string,
	resolveDomain: () => Promise<string | null>,
): Promise<CrmSearchResult> {
	const { phone, nameTokens } = parseCrmSearchQuery(search);
	if (!phone && nameTokens.length === 0) {
		return { identities: [], unlinkedContacts: [] };
	}

	const cacheKey = `${portalKey}\u0000${phone ?? nameTokens.join(" ").toLowerCase()}`;
	const cached = cache.get(cacheKey);
	if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

	let failed = false;
	const safe = <T>(fallback: T) => {
		return (): T => {
			failed = true;
			return fallback;
		};
	};

	const contactIds = new Set<string>();
	if (phone) {
		for (const id of await findContactIdsByPhone(api, phone).catch(
			safe<string[]>([]),
		)) {
			contactIds.add(id);
		}
	} else {
		const results = await Promise.all(
			buildContactNameFilters(nameTokens).map((filter) =>
				api
					.call<unknown>("crm.contact.list", {
						filter,
						select: ["ID"],
						order: { ID: "DESC" },
					})
					.catch(safe<unknown>([])),
			),
		);
		for (const raw of results) {
			const parsed = contactRowsSchema.safeParse(raw);
			if (!parsed.success) {
				failed = true;
				continue;
			}
			for (const row of parsed.data) contactIds.add(String(row.ID));
		}
	}
	const ids = [...contactIds].slice(0, MAX_CONTACT_IDS);

	const links = await listBitrixCrmLinksByContactIds(portalKey, ids).catch(
		safe<Awaited<ReturnType<typeof listBitrixCrmLinksByContactIds>>>([]),
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

	// Не вышло прочитать привязки — не выдаём контакты за «без диалога».
	const unlinkedIds = failed
		? []
		: ids.filter((id) => !linked.has(id)).slice(0, MAX_UNLINKED_CONTACTS);
	const value: CrmSearchResult = {
		identities,
		unlinkedContacts: unlinkedIds.length
			? await loadContactRefs(
					api,
					await resolveDomain().catch(() => null),
					unlinkedIds,
				)
			: [],
	};
	if (!failed) {
		if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
		cache.set(cacheKey, { at: Date.now(), value });
	}
	return value;
}
