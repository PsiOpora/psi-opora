/**
 * Темп рассылки по списку: окно отправки, паузы, перерывы и дневные лимиты
 * личных номеров. Блокируют за массовые сообщения конкретный номер, поэтому
 * всё считается поканально (у каждого канала — свой номер).
 *
 * Модуль без побочных эффектов: время и случайность передаются снаружи.
 */

import type { PersonalChannel } from "./cascade";

/** Темп — только у личных номеров: банят их, а не ботов. */
export interface ChannelPacing {
	channel: PersonalChannel;
	minIntervalSec: number;
	maxIntervalSec: number;
	dailyLimit: number | null;
	batchSize: number | null;
	batchPauseMin: number;
}

export interface SendWindow {
	/** 1 — понедельник … 7 — воскресенье. */
	days: number[];
	fromHour: number;
	toHour: number;
}

export interface OutreachPlan {
	/** Сначала боты MAX → Telegram — тем, кто уже писал боту. */
	useBots: boolean;
	/** Личные номера в порядке приоритета. */
	channels: ChannelPacing[];
	onDailyLimit: "wait" | "skip";
	window: SendWindow | null;
}

/** Окно отправки и сутки для дневного лимита — по Москве (UTC+3, без перехода на летнее время). */
const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const MESSENGER_ORDER: PersonalChannel[] = ["max", "telegram", "whatsapp"];

/**
 * План рассылки из сохранённых настроек. Рассылки, созданные до появления
 * настроек, идут как раньше: MAX → Telegram → WhatsApp, пауза intervalSec ±25%;
 * созданные до шага с ботами — без ботов.
 */
export function resolveOutreachPlan(campaign: {
	settings: {
		useBots?: boolean;
		channels: ChannelPacing[];
		onDailyLimit: "wait" | "skip";
		window: SendWindow | null;
	} | null;
	accounts: Record<PersonalChannel, unknown>;
	intervalSec: number;
}): OutreachPlan {
	const enabled = (channel: PersonalChannel) =>
		Boolean(campaign.accounts[channel]);
	if (campaign.settings) {
		return {
			useBots: campaign.settings.useBots === true,
			channels: campaign.settings.channels.filter((c) => enabled(c.channel)),
			onDailyLimit: campaign.settings.onDailyLimit,
			window: campaign.settings.window,
		};
	}
	return {
		useBots: false,
		channels: MESSENGER_ORDER.filter(enabled).map((channel) => ({
			channel,
			minIntervalSec: Math.round(campaign.intervalSec * 0.75),
			maxIntervalSec: Math.round(campaign.intervalSec * 1.25),
			dailyLimit: null,
			batchSize: null,
			batchPauseMin: 0,
		})),
		onDailyLimit: "skip",
		window: null,
	};
}

/** Начало текущих московских суток. */
export function moscowDayStart(now: Date): Date {
	const local = now.getTime() + MOSCOW_OFFSET_MS;
	return new Date(local - (local % DAY_MS) - MOSCOW_OFFSET_MS);
}

/**
 * Когда откроется окно отправки; null — окно открыто сейчас (или не задано).
 * Окно — полуинтервал [fromHour, toHour) в выбранные дни недели.
 */
export function nextWindowOpening(
	now: Date,
	window: SendWindow | null,
): Date | null {
	if (!window || window.days.length === 0) return null;
	const local = new Date(now.getTime() + MOSCOW_OFFSET_MS);
	const weekday = (d: Date) => d.getUTCDay() || 7;
	const hour = local.getUTCHours();
	if (
		window.days.includes(weekday(local)) &&
		hour >= window.fromHour &&
		hour < window.toHour
	) {
		return null;
	}
	const dayStart = moscowDayStart(now).getTime();
	for (let offset = 0; offset <= 7; offset++) {
		const opening = new Date(
			dayStart + offset * DAY_MS + window.fromHour * 60 * 60 * 1000,
		);
		const openingLocal = new Date(opening.getTime() + MOSCOW_OFFSET_MS);
		if (opening > now && window.days.includes(weekday(openingLocal))) {
			return opening;
		}
	}
	return null;
}

export type PacerState =
	| { kind: "ready" }
	| { kind: "interval"; until: Date }
	| { kind: "break"; until: Date }
	| { kind: "daily_limit"; until: Date };

/**
 * Темп одного личного номера в пределах запуска. Начальное состояние —
 * из журнала попыток (по всем рассылкам за сегодня), поэтому перезапуск
 * задачи или соседняя рассылка не обнуляют паузу и дневной лимит.
 * Перерыв «после каждых N сообщений» считается в пределах запуска.
 */
export class ChannelPacer {
	private usedToday: number;
	private dayStart: number;
	private sinceBreak = 0;
	private nextAt: number;
	private onBreak = false;

	constructor(
		readonly pacing: ChannelPacing,
		usage: { attemptsToday: number; lastAt: Date | null; now: Date },
		private readonly random: () => number = Math.random,
	) {
		this.usedToday = usage.attemptsToday;
		this.dayStart = moscowDayStart(usage.now).getTime();
		this.nextAt = usage.lastAt
			? usage.lastAt.getTime() + this.randomIntervalMs()
			: 0;
	}

	private randomIntervalMs(): number {
		const { minIntervalSec, maxIntervalSec } = this.pacing;
		const sec =
			minIntervalSec + this.random() * (maxIntervalSec - minIntervalSec);
		return Math.round(sec * 1000);
	}

	state(now: Date): PacerState {
		const dayStart = moscowDayStart(now).getTime();
		if (dayStart !== this.dayStart) {
			this.dayStart = dayStart;
			this.usedToday = 0;
		}
		const { dailyLimit } = this.pacing;
		if (dailyLimit !== null && this.usedToday >= dailyLimit) {
			return { kind: "daily_limit", until: new Date(dayStart + DAY_MS) };
		}
		if (this.nextAt > now.getTime()) {
			const until = new Date(this.nextAt);
			return this.onBreak
				? { kind: "break", until }
				: { kind: "interval", until };
		}
		this.onBreak = false;
		return { kind: "ready" };
	}

	/** Попытка отправки состоялась — следующая не раньше паузы (или перерыва). */
	record(now: Date): void {
		this.usedToday++;
		this.sinceBreak++;
		this.nextAt = now.getTime() + this.randomIntervalMs();
		this.onBreak = false;
		const { batchSize, batchPauseMin } = this.pacing;
		if (batchSize !== null && this.sinceBreak >= batchSize) {
			this.sinceBreak = 0;
			this.nextAt = Math.max(
				this.nextAt,
				now.getTime() + batchPauseMin * 60 * 1000,
			);
			this.onBreak = true;
		}
	}
}

const CHANNEL_LABELS: Record<PersonalChannel, string> = {
	max: "MAX",
	telegram: "Telegram",
	whatsapp: "WhatsApp",
};

/** Подпись паузы для отчёта: «Перерыв Telegram после 20 сообщений». */
export function describePause(
	channel: PersonalChannel,
	state: Exclude<PacerState, { kind: "ready" }>,
	pacing: ChannelPacing,
): string {
	const label = CHANNEL_LABELS[channel];
	switch (state.kind) {
		case "daily_limit":
			return `Исчерпан дневной лимит ${label} (${pacing.dailyLimit} сообщ.)`;
		case "break":
			return `Перерыв ${label} после ${pacing.batchSize} сообщений`;
		case "interval":
			return `Пауза между сообщениями ${label}`;
	}
}
