import { upsertBotFunnelEvent as upsertPostgres } from "@psi-opora/db/queries";
import {
	createRedisClient,
	isRedisConfigured,
	type RedisClient,
} from "../storage/redis";
import { FUNNEL_STEPS, type FunnelStep } from "./funnel-steps";
import { DB_TIMEOUT_MS, withTimeout } from "./timeout";

export { FUNNEL_STEPS, type FunnelStep };

/**
 * Тип функции upsert для событий воронки.
 * Позволяет подменять реализацию через setFunnelUpsert в тестах и приложениях.
 */
export type UpsertFunnelFn = (data: {
	day: string;
	messenger: string;
	step: string;
	source?: string;
	campaign?: string;
	userId?: string | number;
	flow?: string;
	reason?: string;
}) => Promise<void>;

/**
 * По умолчанию используется Node.js-драйвер обычного PostgreSQL.
 */
let _upsertFn: UpsertFunnelFn = upsertPostgres;

/**
 * Устанавливает функцию upsert для событий воронки.
 * Вызывайте один раз при инициализации бота в Node.js окружении:
 *
 */
export function setFunnelUpsert(fn: UpsertFunnelFn): void {
	_upsertFn = fn;
}

export interface FunnelEventContext {
	messenger: string;
	source?: string;
	campaign?: string;
	/** ID пользователя мессенджера — нужен для дедупликации: без него шаг
	 * попадёт только в общий (неуникальный) счётчик bot_funnel_events. */
	userId?: string | number;
	/** Ветка сценария ("consult" | "guide") — не задана до её выбора (шаг start). */
	flow?: string;
	/** Не задано — обычное успешное прохождение шага. Задано — это не
	 * прогресс, а причина, по которой пользователь остановился именно на
	 * этом шаге ("declined", "timeout", "blocked" и т.п.), см. дашборд
	 * "Причины отвала". */
	reason?: string;
}

const FIELD_SEP = "|";
const KEY_PREFIX = "botfunnel:";
const TTL_SECONDS = 400 * 24 * 60 * 60;

let redis: RedisClient | null | undefined;

function getRedis(): RedisClient | null {
	if (redis === undefined) {
		redis = isRedisConfigured() ? createRedisClient() : null;
	}
	return redis;
}

function sanitize(value: string | undefined): string {
	const clean = (value ?? "").replaceAll(FIELD_SEP, "_").trim();
	return clean || "-";
}

export function funnelDayKey(day: string): string {
	return `${KEY_PREFIX}${day}`;
}

/** Поле хеша: messenger|step|source|campaign — парсится parseFunnelField. */
export function parseFunnelField(field: string): {
	messenger: string;
	step: string;
	source: string;
	campaign: string;
} | null {
	const [messenger, step, source, campaign] = field.split(FIELD_SEP);
	if (!messenger || !step || source === undefined || campaign === undefined)
		return null;
	return { messenger, step, source, campaign };
}

/**
 * Инкремент счётчика шага воронки за сегодня. Ошибки не должны
 * ломать диалог с клиентом — логируются и глотаются.
 * Записывает в PostgreSQL как основное хранилище, и в Redis как резерв.
 */
export async function trackFunnelStep(
	step: FunnelStep,
	ctx: FunnelEventContext,
): Promise<void> {
	const day = new Date().toISOString().slice(0, 10);
	const source = sanitize(ctx.source);
	const campaign = sanitize(ctx.campaign);

	// 1. Записываем в PostgreSQL (основное хранилище)
	try {
		await withTimeout(
			_upsertFn({
				day,
				messenger: ctx.messenger,
				step,
				source,
				campaign,
				userId: ctx.userId,
				flow: ctx.flow,
				reason: ctx.reason,
			}),
			DB_TIMEOUT_MS,
			"bot_funnel_events",
		);
	} catch (err) {
		console.error(
			`[funnel] не удалось записать событие ${step} в Postgres: ${(err as Error).message}`,
		);
	}

	// 2. Записываем в Redis (резерв, для обратной совместимости)
	const client = getRedis();
	if (client) {
		const field = [ctx.messenger, step, source, campaign].join(FIELD_SEP);
		try {
			const key = funnelDayKey(day);
			await client.hincrby(key, field, 1);
			await client.expire(key, TTL_SECONDS);
		} catch (err) {
			console.error(
				`[funnel] не удалось записать событие ${step} в Redis: ${(err as Error).message}`,
			);
		}
	}
}
