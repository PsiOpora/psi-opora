import type { OutreachAccountOption, OutreachOptions } from "@psi-opora/api";
import {
	OUTREACH_MAX_BATCH_PAUSE_MIN,
	OUTREACH_MAX_DAILY_LIMIT,
	OUTREACH_MAX_DEDUP_DAYS,
	OUTREACH_MAX_INTERVAL_SEC,
	OUTREACH_MESSENGER_CHANNELS,
	OUTREACH_MIN_INTERVAL_SEC,
	type OutreachChannelInput,
	type OutreachMessengerChannelInput,
	type OutreachWindowInput,
} from "@psi-opora/api/schemas";
import { formatDuration } from "./outreach-format";

/**
 * Настройки доставки рассылки по списку: порядок и темп каналов, окно
 * отправки, защита от повторов. Последние настройки запоминаются в
 * браузере, чтобы не выставлять их заново для каждой рассылки.
 */

export type MessengerChannel = OutreachMessengerChannelInput;

export const OFF = "off";

export const MESSENGER_LABELS: Record<MessengerChannel, string> = {
	max: "MAX",
	telegram: "Telegram",
	whatsapp: "WhatsApp",
};

export interface Pacing {
	minIntervalSec: number;
	maxIntervalSec: number;
	dailyLimit: number | null;
	batchSize: number | null;
	batchPauseMin: number;
}

export interface ChannelDraft extends Pacing {
	channel: MessengerChannel;
	enabled: boolean;
	/** `${openLineId}:${connectorId}` выбранного номера или OFF. */
	accountKey: string;
}

export interface DeliveryDraft {
	/** Все мессенджеры в порядке приоритета (выключенные тоже — чтобы не терять место). */
	channels: ChannelDraft[];
	onDailyLimit: "wait" | "skip";
	windowEnabled: boolean;
	window: OutreachWindowInput;
	dedupEnabled: boolean;
	dedupDays: number;
}

export type PresetId = "careful" | "standard" | "fast";

export const PACING_PRESETS: Record<
	PresetId,
	{ label: string; hint: string; pacing: Pacing }
> = {
	careful: {
		label: "Осторожно",
		hint: "новый номер или холодная база",
		pacing: {
			minIntervalSec: 60,
			maxIntervalSec: 120,
			dailyLimit: 40,
			batchSize: 10,
			batchPauseMin: 20,
		},
	},
	standard: {
		label: "Стандарт",
		hint: "обычный темп для прогретого номера",
		pacing: {
			minIntervalSec: 30,
			maxIntervalSec: 60,
			dailyLimit: 100,
			batchSize: 20,
			batchPauseMin: 10,
		},
	},
	fast: {
		label: "Быстро",
		hint: "тёплая база, которая ждёт сообщения; выше риск блокировки",
		pacing: {
			minIntervalSec: 15,
			maxIntervalSec: 30,
			dailyLimit: 250,
			batchSize: null,
			batchPauseMin: 10,
		},
	},
};

/** «Пауза 30–60 с · до 100 в сутки · перерыв 10 мин после каждых 20». */
export function describePacing(p: Pacing): string {
	const parts = [
		p.minIntervalSec === p.maxIntervalSec
			? `пауза ${p.minIntervalSec} с`
			: `пауза ${p.minIntervalSec}–${p.maxIntervalSec} с`,
		p.dailyLimit ? `до ${p.dailyLimit} сообщ. в сутки` : "без дневного лимита",
		p.batchSize
			? `перерыв ${p.batchPauseMin} мин после каждых ${p.batchSize}`
			: "без перерывов",
	];
	const text = parts.join(" · ");
	return text.charAt(0).toUpperCase() + text.slice(1);
}

export function matchPreset(pacing: Pacing): PresetId | null {
	for (const [id, preset] of Object.entries(PACING_PRESETS)) {
		const p = preset.pacing;
		if (
			p.minIntervalSec === pacing.minIntervalSec &&
			p.maxIntervalSec === pacing.maxIntervalSec &&
			p.dailyLimit === pacing.dailyLimit &&
			p.batchSize === pacing.batchSize &&
			(p.batchSize === null || p.batchPauseMin === pacing.batchPauseMin)
		) {
			return id as PresetId;
		}
	}
	return null;
}

export const accountKey = (
	a: Pick<OutreachAccountOption, "openLineId" | "connectorId">,
) => `${a.openLineId}:${a.connectorId}`;

function firstConnected(accounts: OutreachAccountOption[]): string {
	const account = accounts.find((a) => a.status === "connected");
	return account ? accountKey(account) : OFF;
}

export function findAccount(
	options: OutreachOptions,
	draft: ChannelDraft,
): OutreachAccountOption | undefined {
	return options[draft.channel].find(
		(a) => accountKey(a) === draft.accountKey && a.status === "connected",
	);
}

export function defaultDraft(options: OutreachOptions): DeliveryDraft {
	return {
		channels: OUTREACH_MESSENGER_CHANNELS.map((channel) => {
			const key = firstConnected(options[channel]);
			return {
				channel,
				enabled: key !== OFF,
				accountKey: key,
				...PACING_PRESETS.standard.pacing,
			};
		}),
		onDailyLimit: "wait",
		windowEnabled: true,
		window: { days: [1, 2, 3, 4, 5], fromHour: 10, toHour: 20 },
		dedupEnabled: true,
		dedupDays: 7,
	};
}

const STORAGE_KEY = "psi-opora:outreach-delivery:v1";

const clampInt = (
	value: unknown,
	min: number,
	max: number,
	fallback: number,
) =>
	typeof value === "number" && Number.isFinite(value)
		? Math.min(max, Math.max(min, Math.round(value)))
		: fallback;

const nullableInt = (
	value: unknown,
	min: number,
	max: number,
	fallback: number | null,
) => (value === null ? null : clampInt(value, min, max, fallback ?? min));

/**
 * Последние настройки из браузера поверх значений по умолчанию. Номер
 * берётся сохранённый, только если он всё ещё подключён.
 */
export function loadDraft(options: OutreachOptions): DeliveryDraft {
	const base = defaultDraft(options);
	if (typeof window === "undefined") return base;
	let saved: Partial<DeliveryDraft> | null = null;
	try {
		saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
	} catch {
		return base;
	}
	if (!saved || typeof saved !== "object") return base;

	const savedChannels = Array.isArray(saved.channels) ? saved.channels : [];
	const order = [
		...savedChannels
			.map((c) => c?.channel)
			.filter((c): c is MessengerChannel =>
				OUTREACH_MESSENGER_CHANNELS.includes(c as MessengerChannel),
			),
		...OUTREACH_MESSENGER_CHANNELS,
	].filter((c, i, all) => all.indexOf(c) === i);

	const channels = order.map((channel): ChannelDraft => {
		const fallback = base.channels.find((c) => c.channel === channel);
		const s = savedChannels.find((c) => c?.channel === channel);
		if (!fallback) throw new Error(`unknown channel ${channel}`);
		if (!s) return fallback;
		const accountAvailable = options[channel].some(
			(a) => accountKey(a) === s.accountKey && a.status === "connected",
		);
		const key = accountAvailable ? s.accountKey : fallback.accountKey;
		const minIntervalSec = clampInt(
			s.minIntervalSec,
			OUTREACH_MIN_INTERVAL_SEC,
			OUTREACH_MAX_INTERVAL_SEC,
			fallback.minIntervalSec,
		);
		return {
			channel,
			enabled: key !== OFF && s.enabled !== false,
			accountKey: key,
			minIntervalSec,
			maxIntervalSec: clampInt(
				s.maxIntervalSec,
				minIntervalSec,
				OUTREACH_MAX_INTERVAL_SEC,
				Math.max(minIntervalSec, fallback.maxIntervalSec),
			),
			dailyLimit: nullableInt(
				s.dailyLimit,
				1,
				OUTREACH_MAX_DAILY_LIMIT,
				fallback.dailyLimit,
			),
			batchSize: nullableInt(s.batchSize, 1, 1000, fallback.batchSize),
			batchPauseMin: clampInt(
				s.batchPauseMin,
				1,
				OUTREACH_MAX_BATCH_PAUSE_MIN,
				fallback.batchPauseMin,
			),
		};
	});

	const w = saved.window;
	const days = Array.isArray(w?.days)
		? w.days.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
		: [];
	const fromHour = clampInt(w?.fromHour, 0, 23, base.window.fromHour);
	return {
		channels,
		onDailyLimit: saved.onDailyLimit === "skip" ? "skip" : "wait",
		windowEnabled:
			typeof saved.windowEnabled === "boolean"
				? saved.windowEnabled
				: base.windowEnabled,
		window: {
			days: days.length > 0 ? days : base.window.days,
			fromHour,
			toHour: clampInt(w?.toHour, fromHour + 1, 24, base.window.toHour),
		},
		dedupEnabled:
			typeof saved.dedupEnabled === "boolean"
				? saved.dedupEnabled
				: base.dedupEnabled,
		dedupDays: clampInt(
			saved.dedupDays,
			1,
			OUTREACH_MAX_DEDUP_DAYS,
			base.dedupDays,
		),
	};
}

export function saveDraft(draft: DeliveryDraft): void {
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
	} catch {
		// Хранилище недоступно (приватный режим, запрет в iframe) — не страшно.
	}
}

/** Включённые каналы с подключённым номером — в формате запроса, по приоритету. */
export function activeChannels(
	draft: DeliveryDraft,
	options: OutreachOptions,
): OutreachChannelInput[] {
	return draft.channels.flatMap((c) => {
		if (!c.enabled) return [];
		const account = findAccount(options, c);
		if (!account) return [];
		return [
			{
				channel: c.channel,
				openLineId: account.openLineId,
				connectorId: account.connectorId,
				minIntervalSec: c.minIntervalSec,
				maxIntervalSec: c.maxIntervalSec,
				dailyLimit: c.dailyLimit,
				batchSize: c.batchSize,
				batchPauseMin: c.batchPauseMin,
			},
		];
	});
}

/** Проблемы настроек доставки — показываются рядом с кнопкой запуска. */
export function deliveryProblems(draft: DeliveryDraft): string[] {
	const problems: string[] = [];
	for (const c of draft.channels) {
		if (!c.enabled) continue;
		const label = MESSENGER_LABELS[c.channel];
		if (
			c.minIntervalSec < OUTREACH_MIN_INTERVAL_SEC ||
			c.maxIntervalSec > OUTREACH_MAX_INTERVAL_SEC
		)
			problems.push(
				`${label}: пауза — от ${OUTREACH_MIN_INTERVAL_SEC} до ${OUTREACH_MAX_INTERVAL_SEC} с`,
			);
		if (c.maxIntervalSec < c.minIntervalSec)
			problems.push(`${label}: максимальная пауза меньше минимальной`);
	}
	if (draft.windowEnabled) {
		if (draft.window.days.length === 0) problems.push("выберите дни отправки");
		if (draft.window.toHour <= draft.window.fromHour)
			problems.push("окно отправки: конец раньше начала");
	}
	return problems;
}

/**
 * Грубая оценка длительности, если все сообщения пойдут через первый
 * канал: средняя пауза + перерывы, с учётом дневного лимита и окна.
 */
export function estimateDuration(
	messages: number,
	channel: Pacing | undefined,
	window: OutreachWindowInput | null,
): string | null {
	if (!channel || messages <= 0) return null;
	const avgSec =
		(channel.minIntervalSec + channel.maxIntervalSec) / 2 +
		(channel.batchSize ? (channel.batchPauseMin * 60) / channel.batchSize : 0);
	const activeSecPerDay = window
		? (window.toHour - window.fromHour) * 3600
		: 24 * 3600;
	const perDay = Math.max(
		1,
		Math.min(
			channel.dailyLimit ?? Infinity,
			Math.floor(activeSecPerDay / avgSec),
		),
	);
	if (messages <= perDay) return formatDuration(messages * avgSec);
	const workDays = Math.ceil(messages / perDay);
	const calendarDays = window
		? Math.ceil((workDays * 7) / Math.max(1, window.days.length))
		: workDays;
	return `~${calendarDays} дн. (до ${perDay.toLocaleString("ru-RU")} сообщ. в день)`;
}
