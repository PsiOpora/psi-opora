import {
	getBitrixCrmLink,
	listClientsWithLastMessage,
	upsertBitrixCrmLink,
} from "@psi-opora/db/queries";

/**
 * Разово проставляет связку messenger+userId → contactId/dealId в таблице
 * bitrix_crm_links для диалогов, которые обратились ДО того, как
 * createBitrixDeal стал сам писать эту связку (см.
 * packages/bot-core/src/utils/bitrix/create-deal.ts) — без неё панель CRM в
 * «Клиенты» (apps/clients) показывает «Контакт не найден» даже на клиентах
 * с реально существующим контактом/сделкой в Bitrix.
 *
 * Источник истины — не entity_data_2 диалога Открытой линии (трекер его
 * больше не заполняет, см. комментарий в create-deal.ts), а поле COMMENTS
 * сделки: buildDealFields (packages/bot-core/src/utils/bitrix/deal.ts)
 * всегда пишет туда `${messenger} user_id: ${telegramUserId}` — этот маркер
 * есть у каждой сделки, которую когда-либо трогал createBitrixDeal (и при
 * создании, и при обновлении сделки трекера в старой версии кода),
 * независимо от того, кто изначально создал сделку — бот или трекер линии.
 *
 * Запуск (из packages/bot-core):
 *   bun run --env-file=../../.env scripts/backfill-crm-links.ts
 */

const MESSENGERS = ["telegram", "max"] as const;
type BotMessenger = (typeof MESSENGERS)[number];

function isBotMessenger(value: string): value is BotMessenger {
	return value === "telegram" || value === "max";
}

function webhookBase(messenger: BotMessenger): string {
	const prefix = messenger === "telegram" ? "TG" : "MAX";
	const url =
		process.env[`${prefix}_BITRIX_WEBHOOK_URL`] ??
		process.env.BITRIX_WEBHOOK_URL;
	if (!url) throw new Error(`BITRIX_WEBHOOK_URL не задан для ${messenger}`);
	return url.replace(/\/$/, "");
}

interface BitrixListResponse<T> {
	result?: T;
	next?: number;
	total?: number;
	error?: string;
	error_description?: string;
}

async function callBitrix<T = unknown>(
	base: string,
	method: string,
	body: unknown,
): Promise<{ result: T; next?: number }> {
	const res = await fetch(`${base}/${method}.json`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const json = (await res.json()) as BitrixListResponse<T>;
	if (json.error) {
		throw new Error(
			`Bitrix24 [${method}]: ${json.error} — ${json.error_description ?? ""}`,
		);
	}
	return { result: json.result as T, next: json.next };
}

interface RawDeal {
	ID: string;
	CONTACT_ID?: string | null;
	COMMENTS?: string;
}

// Значения поля "Мессенджер" (UF_CRM_1779643796551) — см. deal.ts.
const MESSENGER_FIELD_VALUES: Record<BotMessenger, string> = {
	telegram: "328",
	max: "326",
};

/**
 * Все сделки этого мессенджера с распарсенным userId из COMMENTS.
 * Сортировка ASC + перезапись в Map — при нескольких сделках на одного
 * клиента в карте остаётся последняя (самая свежая) сделка.
 */
async function collectDealsByUserId(
	messenger: BotMessenger,
): Promise<Map<string, { contactId: string; dealId: string }>> {
	const base = webhookBase(messenger);
	const marker = new RegExp(`${messenger} user_id: (\\d+)`);
	const map = new Map<string, { contactId: string; dealId: string }>();

	let start = 0;
	for (;;) {
		const { result, next } = await callBitrix<RawDeal[]>(
			base,
			"crm.deal.list",
			{
				filter: { UF_CRM_1779643796551: MESSENGER_FIELD_VALUES[messenger] },
				select: ["ID", "CONTACT_ID", "COMMENTS"],
				order: { ID: "ASC" },
				start,
			},
		);
		for (const deal of result) {
			if (!deal.CONTACT_ID) continue;
			const match = deal.COMMENTS?.match(marker);
			if (!match) continue;
			map.set(match[1], {
				contactId: String(deal.CONTACT_ID),
				dealId: deal.ID,
			});
		}
		if (next === undefined) break;
		start = next;
	}
	return map;
}

async function main() {
	const dealsByUserId: Record<
		BotMessenger,
		Map<string, { contactId: string; dealId: string }>
	> = {
		telegram: new Map(),
		max: new Map(),
	};
	for (const messenger of MESSENGERS) {
		console.log(`Читаю сделки Bitrix (${messenger})…`);
		dealsByUserId[messenger] = await collectDealsByUserId(messenger);
		console.log(
			`  найдено сделок с userId в COMMENTS: ${dealsByUserId[messenger].size}`,
		);
	}

	let offset = 0;
	const limit = 200;
	let scanned = 0;
	let linked = 0;
	let alreadyLinked = 0;
	let notFound = 0;

	console.log("\nПрохожу диалоги клиентов…");
	for (;;) {
		const clients = await listClientsWithLastMessage({ limit, offset });
		if (clients.length === 0) break;

		for (const client of clients) {
			if (!isBotMessenger(client.messenger)) continue;
			scanned++;

			const existing = await getBitrixCrmLink(client.messenger, client.userId);
			if (existing) {
				alreadyLinked++;
				continue;
			}

			const found = dealsByUserId[client.messenger].get(client.userId);
			if (!found) {
				notFound++;
				continue;
			}

			await upsertBitrixCrmLink({
				messenger: client.messenger,
				userId: client.userId,
				contactId: found.contactId,
				dealId: found.dealId,
			});
			linked++;
			console.log(
				`  [${client.messenger}] ${client.userId} → contact ${found.contactId}, deal ${found.dealId}`,
			);
		}

		if (clients.length < limit) break;
		offset += limit;
	}

	console.log(
		`\nГотово: просканировано ${scanned}, уже было привязано ${alreadyLinked}, ` +
			`привязано сейчас ${linked}, не найдено в Bitrix ${notFound}`,
	);
}

await main();
