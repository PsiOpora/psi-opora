import type { FunnelStep } from "@psi-opora/bot-core/funnel-steps";

/**
 * Типы, лейблы и чистые функции воронки — без серверных зависимостей
 * (@psi-opora/db/queries тянет pg → net/tls), поэтому этот файл можно
 * импортировать из клиентских компонентов. Функции, читающие БД
 * (fetchBotFunnelEvents, fetchBotFunnelDropReasons), живут в bot-funnel.ts
 * и используются только в app/api/dashboard/bot-funnel/route.ts.
 */

export interface BotFunnelEvent {
	messenger: string;
	step: FunnelStep;
	/** "consult" | "guide" | "-" (шаг start — ветка ещё не выбрана). */
	flow: string;
	source: string;
	campaign: string;
	/** Уникальные пользователи мессенджера, дошедшие до шага за период —
	 * повторные /start одного и того же человека считаются один раз
	 * (см. getBotFunnelUniqueStepCountsByDateRange). */
	count: number;
}

export interface BotFunnelStepStats {
	step: FunnelStep;
	label: string;
	count: number;
	/** Доля от запустивших бота. */
	shareOfStart: number;
	/** Конверсия из предыдущего шага. */
	stepConversion: number;
}

export const STEP_LABELS: Record<FunnelStep, string> = {
	start: "Запустили бота (/start)",
	consult_click: "Нажали «Записаться»",
	consent: "Дали согласие на ПДн",
	marketing_consent: "Ответили на согласие на рекламу",
	name: "Оставили имя",
	guide_click: "Нажали «Получить гайд»",
	category: "Выбрали категорию",
	issue: "Указали тему",
	email: "Оставили email (лид-магнит)",
	phone: "Оставили телефон",
	deal: "Заявка создана в CRM",
	subscribe: "Согласились на рассылку",
};

export const MESSENGER_LABELS: Record<string, string> = {
	telegram: "Telegram",
	max: "MAX",
	all: "Все мессенджеры",
};

export type BotFunnelFlow = "consult" | "guide";

export const FLOW_LABELS: Record<BotFunnelFlow, string> = {
	consult: "Консультация",
	guide: "Гайд",
};

/**
 * Шаги каждой ветки сценария в порядке прохождения (см. packages/bot-core/src/scenario/engine.ts) —
 * считать конверсию "шаг за шагом" по объединённому списку FUNNEL_STEPS
 * нельзя: после start ветки расходятся, и шаг из одной ветки не следует за
 * шагом из другой. "start" — общий для обеих веток (выбор ветки ещё не сделан).
 */
export const FLOW_STEPS: Record<BotFunnelFlow, readonly FunnelStep[]> = {
	consult: [
		"start",
		"consult_click",
		"consent",
		"marketing_consent",
		"name",
		"phone",
		"deal",
	],
	guide: [
		"start",
		"guide_click",
		"consent",
		"marketing_consent",
		"category",
		"issue",
		"email",
		"phone",
		"deal",
		"subscribe",
	],
};

/** Человекочитаемые причины, по которым пользователь не пошёл дальше шага —
 * см. reason в bot_funnel_user_steps / packages/bot-core/src/scenario/engine.ts /reminders.ts. */
export const REASON_LABELS: Record<string, string> = {
	declined: "Отказался от согласия на обработку ПДн",
	phone_skipped: "Пропустил вопрос о телефоне",
	phone_invalid_exhausted: "Не смог продиктовать телефон (3 неверные попытки)",
	phone_invalid: "Не смог продиктовать телефон — заявка не создана (3 попытки)",
	email_invalid:
		"Не смог указать email — материал кампании не выдан (3 попытки)",
	timeout: "Не ответил вовремя (после напоминания)",
	blocked: "Заблокировал бота",
	send_failed: "Не удалось отправить сообщение (ошибка мессенджера)",
};

/** Каскад конверсий для одной ветки сценария: "start" берётся из общего (ещё
 * без ветки) счётчика, остальные шаги — только события этой ветки. */
function flowCascade(
	events: BotFunnelEvent[],
	flow: BotFunnelFlow,
): BotFunnelStepStats[] {
	const steps = FLOW_STEPS[flow];
	const totals = new Map<FunnelStep, number>();
	for (const event of events) {
		if (event.step === "start") {
			totals.set("start", (totals.get("start") ?? 0) + event.count);
			continue;
		}
		if (event.flow !== flow) continue;
		totals.set(event.step, (totals.get(event.step) ?? 0) + event.count);
	}

	const start = totals.get("start") ?? 0;
	return steps.map((step, i) => {
		const count = totals.get(step) ?? 0;
		const prevStep = steps[i - 1];
		const prev = i === 0 ? count : (totals.get(prevStep ?? "start") ?? 0);
		return {
			step,
			label: STEP_LABELS[step],
			count,
			shareOfStart: start > 0 ? count / start : 0,
			stepConversion: i === 0 ? 1 : prev > 0 ? count / prev : 0,
		};
	});
}

export interface BotFunnelFlowStats {
	flow: BotFunnelFlow;
	label: string;
	steps: BotFunnelStepStats[];
}

export function funnelStepStatsByFlow(
	events: BotFunnelEvent[],
): BotFunnelFlowStats[] {
	return (Object.keys(FLOW_LABELS) as BotFunnelFlow[]).map((flow) => ({
		flow,
		label: FLOW_LABELS[flow],
		steps: flowCascade(events, flow),
	}));
}

export function funnelByMessenger(
	events: BotFunnelEvent[],
): Array<{ messenger: string; flows: BotFunnelFlowStats[] }> {
	const byMessenger = new Map<string, BotFunnelEvent[]>();
	for (const event of events) {
		const bucket = byMessenger.get(event.messenger);
		if (bucket) bucket.push(event);
		else byMessenger.set(event.messenger, [event]);
	}
	return [...byMessenger.entries()]
		.map(([messenger, group]) => ({
			messenger,
			flows: funnelStepStatsByFlow(group),
		}))
		.sort((a, b) => a.messenger.localeCompare(b.messenger));
}

export interface BotFunnelSourceRow {
	key: string;
	source: string;
	campaign: string;
	starts: number;
	clicks: number;
	phones: number;
	deals: number;
	/** Конверсия старт → заявка. */
	conversion: number;
}

export function funnelBySourceCampaign(
	events: BotFunnelEvent[],
): BotFunnelSourceRow[] {
	const rows = new Map<string, BotFunnelSourceRow>();
	for (const event of events) {
		const key = `${event.source}|${event.campaign}`;
		let row = rows.get(key);
		if (!row) {
			row = {
				key,
				source: event.source,
				campaign: event.campaign,
				starts: 0,
				clicks: 0,
				phones: 0,
				deals: 0,
				conversion: 0,
			};
			rows.set(key, row);
		}
		if (event.step === "start") row.starts += event.count;
		// «Кликнули» = выбрали любую из веток на старте
		if (event.step === "consult_click" || event.step === "guide_click")
			row.clicks += event.count;
		if (event.step === "phone") row.phones += event.count;
		if (event.step === "deal") row.deals += event.count;
	}
	return [...rows.values()]
		.map((row) => ({
			...row,
			conversion: row.starts > 0 ? row.deals / row.starts : 0,
		}))
		.sort((a, b) => b.starts - a.starts);
}

export interface BotFunnelDropReasonRow {
	key: string;
	messenger: string;
	flow: string;
	step: FunnelStep;
	stepLabel: string;
	reason: string;
	reasonLabel: string;
	count: number;
}
