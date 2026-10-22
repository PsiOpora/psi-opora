/**
 * Поиск диалога клиента с официальным ботом (MAX/Telegram) по телефону из
 * списка рассылки. Бот может писать только тем, кто сам открывал с ним
 * диалог, поэтому нужен ID пользователя в мессенджере, а не телефон.
 *
 * Источники, в порядке приоритета:
 *  1. Контакт CRM с этим телефоном (crm.duplicate.findbycomm — Bitrix сам
 *     сравнивает номера без учёта формата) → bitrix_crm_links: диалоги, для
 *     которых бот создавал этот контакт.
 *  2. IM-поля того же контакта: IMOL-запись Открытой линии с коннектором
 *     нашего бота (imol|<connectorId>|<lineId>|<userId>|<chatId>) или поле
 *     «Мессенджер» с числовым ID — контакты, созданные трекером линии до
 *     появления bitrix_crm_links.
 *  3. Телефон, который клиент сам оставил в сценарии бота (выдача
 *     материала, предзаказ) — работает и без CRM.
 *
 * Ошибки CRM не роняют поиск: остаются локальные источники, а причина
 * возвращается в error — если бот так и не нашёлся, она попадёт в отчёт.
 */

export type BotMessenger = "telegram" | "max";

export interface BotTargets {
	telegram?: string;
	max?: string;
	/** Сбой поиска в CRM — только если из-за него диалог мог не найтись. */
	error?: string;
}

export interface ContactImEntry {
	VALUE: string;
	VALUE_TYPE?: string;
}

export interface BotTargetDeps {
	/** ID контактов CRM с этим телефоном; null — CRM недоступна. */
	findContactIdsByPhone: ((phone: string) => Promise<string[]>) | null;
	getContactIm: (contactId: string) => Promise<ContactImEntry[]>;
	listCrmLinks: (
		contactIds: string[],
	) => Promise<Array<{ messenger: string; userId: string }>>;
	listScenarioDialogs: (
		phone: string,
	) => Promise<Array<{ messenger: BotMessenger; userId: string }>>;
	/** ID коннекторов Открытой линии наших ботов (bot_connectors.connector_id). */
	botConnectorIds: Partial<Record<BotMessenger, string>>;
}

/** Больше контактов на один номер — почти наверняка дубли, хватит первых. */
const CONTACTS_LIMIT = 5;

function isBotMessenger(value: string): value is BotMessenger {
	return value === "telegram" || value === "max";
}

/** ID пользователя бота из IM-полей контакта. */
export function botUserIdsFromIm(
	entries: ContactImEntry[],
	botConnectorIds: Partial<Record<BotMessenger, string>>,
): Array<{ messenger: BotMessenger; userId: string }> {
	const out: Array<{ messenger: BotMessenger; userId: string }> = [];
	for (const entry of entries) {
		const value = entry.VALUE?.trim() ?? "";
		const type = entry.VALUE_TYPE?.toLowerCase() ?? "";
		if (!value) continue;
		if (isBotMessenger(type) && /^\d+$/.test(value)) {
			out.push({ messenger: type, userId: value });
			continue;
		}
		if (type !== "imol" || !value.toLowerCase().startsWith("imol|")) continue;
		const [, connectorId = "", , userId = ""] = value.split("|");
		const messenger = (["telegram", "max"] as const).find(
			(m) =>
				botConnectorIds[m] &&
				botConnectorIds[m]?.toLowerCase() === connectorId.toLowerCase(),
		);
		if (messenger && /^\d+$/.test(userId.trim())) {
			out.push({ messenger, userId: userId.trim() });
		}
	}
	return out;
}

export async function resolveBotTargets(
	phone: string,
	deps: BotTargetDeps,
): Promise<BotTargets> {
	const targets: BotTargets = {};
	const take = (messenger: string, userId: string) => {
		if (!isBotMessenger(messenger) || !userId) return;
		targets[messenger] ??= userId;
	};
	const complete = () => Boolean(targets.telegram && targets.max);
	let crmError: string | undefined;

	if (deps.findContactIdsByPhone) {
		try {
			const contactIds = (await deps.findContactIdsByPhone(phone)).slice(
				0,
				CONTACTS_LIMIT,
			);
			if (contactIds.length > 0) {
				for (const link of await deps.listCrmLinks(contactIds)) {
					take(link.messenger, link.userId);
				}
				for (const contactId of contactIds) {
					if (complete()) break;
					const im = await deps.getContactIm(contactId);
					for (const found of botUserIdsFromIm(im, deps.botConnectorIds)) {
						take(found.messenger, found.userId);
					}
				}
			}
		} catch (err) {
			crmError = `поиск контакта в CRM не удался: ${(err as Error).message}`;
		}
	}

	if (!complete()) {
		try {
			for (const dialog of await deps.listScenarioDialogs(phone)) {
				take(dialog.messenger, dialog.userId);
			}
		} catch (err) {
			crmError ??= `поиск диалогов с ботом не удался: ${(err as Error).message}`;
		}
	}

	if (crmError && !complete()) targets.error = crmError;
	return targets;
}

/**
 * Поиск с памятью на последний телефон: оба бот-отправителя (MAX и
 * Telegram) спрашивают один и тот же номер подряд — в CRM идём один раз.
 */
export function memoizeLastPhone(
	resolve: (phone: string) => Promise<BotTargets>,
): (phone: string) => Promise<BotTargets> {
	let last: { phone: string; result: Promise<BotTargets> } | null = null;
	return (phone) => {
		if (last?.phone !== phone) last = { phone, result: resolve(phone) };
		return last.result;
	};
}

/** Реальные зависимости поиска для портала рассылки. */
export async function createBotTargetLookup(
	memberId: string,
): Promise<(phone: string) => Promise<BotTargets>> {
	const { resolveBitrixApi, resolveBitrixPortalKey } = await import(
		"@psi-opora/bitrix-client"
	);
	const {
		getBotConnector,
		listBitrixCrmLinksByContactIds,
		listBotDialogsByScenarioPhone,
	} = await import("@psi-opora/db/queries");

	const api = resolveBitrixApi(memberId);
	const portalKey = await resolveBitrixPortalKey(memberId).catch(() => null);
	const [telegramConnector, maxConnector] = await Promise.all([
		getBotConnector("telegram").catch(() => null),
		getBotConnector("max").catch(() => null),
	]);

	const deps: BotTargetDeps = {
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
		getContactIm: async (contactId) => {
			if (!api) return [];
			const contact = await api.call<{ IM?: unknown } | null>(
				"crm.contact.get",
				{ id: contactId },
			);
			const im = contact?.IM;
			if (!Array.isArray(im)) return [];
			return im.flatMap((entry: unknown) => {
				if (!entry || typeof entry !== "object") return [];
				const { VALUE, VALUE_TYPE } = entry as Record<string, unknown>;
				return typeof VALUE === "string"
					? [
							{
								VALUE,
								VALUE_TYPE:
									typeof VALUE_TYPE === "string" ? VALUE_TYPE : undefined,
							},
						]
					: [];
			});
		},
		listCrmLinks: (contactIds) =>
			portalKey
				? listBitrixCrmLinksByContactIds(portalKey, contactIds)
				: Promise.resolve([]),
		listScenarioDialogs: listBotDialogsByScenarioPhone,
		botConnectorIds: {
			telegram: telegramConnector?.connectorId,
			max: maxConnector?.connectorId,
		},
	};
	return memoizeLastPhone((phone) => resolveBotTargets(phone, deps));
}
