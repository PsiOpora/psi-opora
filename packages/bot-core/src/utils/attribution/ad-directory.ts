import {
	type AdCredentials,
	type AdEntityKind,
	getAdCredentials,
	getAdEntities,
	type NewAdEntity,
	upsertAdEntities,
} from "@psi-opora/db/queries";
import { getYandexToken, yandexRequest } from "../ads-stats";

/**
 * Названия сущностей рекламного кабинета Директа по ID из UTM-меток:
 * в метках приходят только числа ({campaign_id}, {gbid}, {ad_id},
 * {phrase_id}), а оператору в Bitrix нужно «Кампания / Объявление / Ключ».
 * Названия кэшируются в ad_entities и подтягиваются только для ID, которых
 * там нет или которые давно не обновлялись, — ID в метках повторяются от
 * заявки к заявке, так что обращений к API немного.
 */

const PLATFORM = "yandex";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOOKUP_TIMEOUT_MS = 8000;
/** Id в JSON-запросе уходят числами — выше этого предела double теряет точность. */
const MAX_SAFE_ID_DIGITS = 15;

export interface AdEntityRefs {
	campaignIds: string[];
	groupIds: string[];
	adIds: string[];
	keywordIds: string[];
}

export type AdEntityNames = Map<string, string>;

export function entityKey(kind: AdEntityKind, id: string): string {
	return `${kind}:${id}`;
}

const KINDS: Array<[AdEntityKind, keyof AdEntityRefs]> = [
	["campaign", "campaignIds"],
	["group", "groupIds"],
	["ad", "adIds"],
	["keyword", "keywordIds"],
];

function toNumericIds(ids: string[]): number[] {
	return ids
		.filter((id) => /^\d+$/.test(id) && id.length <= MAX_SAFE_ID_DIGITS)
		.map(Number);
}

interface DirectNamedRow {
	Id: number;
	Name?: string;
	Keyword?: string;
	TextAd?: { Title?: string; Title2?: string };
}

async function getDirectRows(
	method: string,
	resultKey: string,
	params: Record<string, unknown>,
	token: string,
	clientLogin?: string,
): Promise<DirectNamedRow[]> {
	const data = await yandexRequest<Record<string, DirectNamedRow[]>>(
		method,
		{ method: "get", params },
		token,
		clientLogin,
	);
	return data[resultKey] ?? [];
}

function adTitle(row: DirectNamedRow): string | undefined {
	const title = row.TextAd?.Title?.trim();
	if (!title) return undefined;
	const title2 = row.TextAd?.Title2?.trim();
	return title2 ? `${title} | ${title2}` : title;
}

/**
 * Один запрос на вид сущности; сбой одного вида (нет прав, архивные объявления
 * не отдаются) не мешает остальным — недостающие названия просто останутся ID.
 */
export async function fetchYandexEntityNames(
	creds: Pick<
		AdCredentials,
		| "yandexClientId"
		| "yandexClientSecret"
		| "yandexRefreshToken"
		| "yandexClientLogin"
	>,
	refs: AdEntityRefs,
): Promise<NewAdEntity[]> {
	if (
		!creds.yandexClientId ||
		!creds.yandexClientSecret ||
		!creds.yandexRefreshToken
	) {
		return [];
	}
	const token = await getYandexToken(
		creds.yandexClientId,
		creds.yandexClientSecret,
		creds.yandexRefreshToken,
	);
	const login = creds.yandexClientLogin ?? undefined;

	const campaignIds = toNumericIds(refs.campaignIds);
	const groupIds = toNumericIds(refs.groupIds);
	const adIds = toNumericIds(refs.adIds);
	const keywordIds = toNumericIds(refs.keywordIds);

	const tasks: Array<Promise<NewAdEntity[]>> = [];
	const named = (
		kind: AdEntityKind,
		rows: DirectNamedRow[],
		pick: (row: DirectNamedRow) => string | undefined,
	): NewAdEntity[] =>
		rows.flatMap((row) => {
			const name = pick(row);
			return name
				? [
						{
							platform: PLATFORM,
							kind,
							externalId: String(row.Id),
							name,
						},
					]
				: [];
		});

	if (campaignIds.length) {
		tasks.push(
			getDirectRows(
				"campaigns",
				"Campaigns",
				{
					SelectionCriteria: { Ids: campaignIds },
					FieldNames: ["Id", "Name"],
				},
				token,
				login,
			).then((rows) => named("campaign", rows, (r) => r.Name?.trim())),
		);
	}
	if (groupIds.length) {
		tasks.push(
			getDirectRows(
				"adgroups",
				"AdGroups",
				{
					SelectionCriteria: { Ids: groupIds },
					FieldNames: ["Id", "Name"],
				},
				token,
				login,
			).then((rows) => named("group", rows, (r) => r.Name?.trim())),
		);
	}
	if (adIds.length) {
		tasks.push(
			getDirectRows(
				"ads",
				"Ads",
				{
					SelectionCriteria: { Ids: adIds },
					FieldNames: ["Id"],
					TextAdFieldNames: ["Title", "Title2"],
				},
				token,
				login,
			).then((rows) => named("ad", rows, adTitle)),
		);
	}
	if (keywordIds.length) {
		tasks.push(
			getDirectRows(
				"keywords",
				"Keywords",
				{
					SelectionCriteria: { Ids: keywordIds },
					FieldNames: ["Id", "Keyword"],
				},
				token,
				login,
			).then((rows) => named("keyword", rows, (r) => r.Keyword?.trim())),
		);
	}

	const settled = await Promise.allSettled(tasks);
	const entities: NewAdEntity[] = [];
	for (const result of settled) {
		if (result.status === "fulfilled") entities.push(...result.value);
		else
			console.warn(
				`[ad-directory] не удалось получить названия из Директа: ${(result.reason as Error).message}`,
			);
	}
	return entities;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`таймаут ${ms} мс`)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Названия для набора ID: сначала кэш (ad_entities), недостающее или
 * устаревшее — из Директа. Никогда не бросает: без кредов, при сбое API или
 * таймауте возвращает то, что есть в кэше (даже устаревшее), а остальное —
 * без названия (вызывающий подставит ID). Создание сделки от этого не зависит.
 */
export async function loadAdEntityNames(
	refs: AdEntityRefs,
	now: Date = new Date(),
): Promise<AdEntityNames> {
	const names: AdEntityNames = new Map();
	const wanted = new Set<string>();
	for (const [kind, key] of KINDS) {
		for (const id of refs[key]) wanted.add(entityKey(kind, id));
	}
	if (wanted.size === 0) return names;

	const staleOrMissing: AdEntityRefs = {
		campaignIds: [],
		groupIds: [],
		adIds: [],
		keywordIds: [],
	};

	try {
		const allIds = [...new Set(KINDS.flatMap(([, key]) => refs[key]))];
		const cached = await getAdEntities(PLATFORM, allIds);
		const fresh = new Set<string>();
		for (const row of cached) {
			const key = entityKey(row.kind as AdEntityKind, row.externalId);
			if (!wanted.has(key)) continue;
			names.set(key, row.name);
			if (now.getTime() - row.updatedAt.getTime() < CACHE_TTL_MS) {
				fresh.add(key);
			}
		}
		for (const [kind, key] of KINDS) {
			for (const id of refs[key]) {
				if (!fresh.has(entityKey(kind, id))) staleOrMissing[key].push(id);
			}
		}
	} catch (err) {
		console.warn(
			`[ad-directory] не удалось прочитать кэш названий: ${(err as Error).message}`,
		);
		return names;
	}

	if (!KINDS.some(([, key]) => staleOrMissing[key].length > 0)) return names;

	try {
		const creds = await getAdCredentials();
		if (!creds) return names;
		const fetched = await withTimeout(
			fetchYandexEntityNames(creds, staleOrMissing),
			LOOKUP_TIMEOUT_MS,
		);
		for (const entity of fetched) {
			names.set(
				entityKey(entity.kind as AdEntityKind, entity.externalId),
				entity.name,
			);
		}
		await upsertAdEntities(fetched);
	} catch (err) {
		console.warn(
			`[ad-directory] не удалось обновить названия из Директа: ${(err as Error).message}`,
		);
	}
	return names;
}
