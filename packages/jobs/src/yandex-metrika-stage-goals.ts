import type { BitrixApi } from "@psi-opora/bitrix-client";
import { sendYandexMetrikaGoal } from "@psi-opora/bot-core";
import { logger } from "@psi-opora/config";
import {
	claimYandexMetrikaGoalEvent,
	findYandexMetrikaMessengerVisitor,
	getYandexMetrikaDealVisitor,
	getYandexMetrikaSettings,
	hasEnabledYandexMetrikaStageGoals,
	listEnabledYandexMetrikaGoalsForStage,
	markYandexMetrikaGoalEventSent,
	releaseYandexMetrikaGoalEvent,
	saveYandexMetrikaDealVisitor,
	type YandexMetrikaDealVisitor,
} from "@psi-opora/db/queries";
import { type ContactIm, listContactBotTargets } from "./contact-bot-targets";

export interface YandexMetrikaStageGoalsResult {
	/** Идентификаторы целей Метрики, конверсии по которым отправлены. */
	sent: string[];
	skipped?:
		| "no_goals"
		| "no_goals_for_stage"
		| "deal_not_found"
		| "no_visitor"
		| "no_stage_time";
}

/**
 * Обработка вебхука ONCRMDEALUPDATE для целей Метрики по стадиям воронки
 * (владелец портала привязывает их в /settings/metrika, таблица
 * yandex_metrika_stage_goals): когда сделка оказывается в стадии, к которой
 * привязана цель, в Метрику уходит офлайн-конверсия по ClientID/yclid сделки.
 * Повторно на ту же пару «цель + сделка» не срабатывает — журнал
 * yandex_metrika_goal_events (в отличие от напоминаний, возврат сделки в
 * стадию цель не дублирует).
 *
 * ClientID ищется по порядку: что запомнил бот при создании сделки →
 * пользовательское поле Bitrix (если задано в настройках) → визит, с которым
 * клиент открыл бота (`/start …_ym…`), через IM-поле контакта сделки — так
 * находятся сделки, которые завёл оператор, а не бот. Найденный по контакту
 * визит закрепляется за сделкой. У сделок без ClientID/yclid конверсию
 * привязать не к чему — они пропускаются.
 */
export async function handleYandexMetrikaStageGoals(
	api: BitrixApi,
	dealId: number,
): Promise<YandexMetrikaStageGoalsResult> {
	// Дешёвая проверка до обращения к Bitrix: событие приходит на любое
	// изменение любой сделки.
	if (!(await hasEnabledYandexMetrikaStageGoals())) {
		return { sent: [], skipped: "no_goals" };
	}

	const deal = await api.call<Record<string, unknown> | false>("crm.deal.get", {
		id: dealId,
	});
	if (!deal) return { sent: [], skipped: "deal_not_found" };

	const stageId = String(deal.STAGE_ID ?? "");
	const categoryId = String(deal.CATEGORY_ID ?? "0");
	const goals = await listEnabledYandexMetrikaGoalsForStage(
		stageId,
		categoryId,
	);
	if (goals.length === 0) return { sent: [], skipped: "no_goals_for_stage" };

	const dealKey = String(dealId);
	const visitor = await getYandexMetrikaDealVisitor(dealKey);
	let clientId = visitor?.clientId || undefined;
	let yclid = visitor?.yclid || undefined;
	if (!clientId) {
		const field = (await getYandexMetrikaSettings())?.bitrixClientIdField;
		const fromBitrix = field ? deal[field] : undefined;
		if (typeof fromBitrix === "string" && fromBitrix.trim()) {
			clientId = fromBitrix.trim();
		}
	}
	if (!clientId && !yclid) {
		const contactVisitor = await findContactVisitor(api, deal);
		clientId = contactVisitor?.clientId || undefined;
		yclid = contactVisitor?.yclid || undefined;
		if (clientId || yclid) {
			await saveYandexMetrikaDealVisitor(dealKey, { clientId, yclid });
		}
	}
	if (!clientId && !yclid) {
		logger.warn("yandex_metrika.stage_goal_no_visitor", {
			dealId,
			stageId,
		});
		return { sent: [], skipped: "no_visitor" };
	}

	// Без времени перехода нельзя подменять дату конверсии временем отправки.
	const occurredAt =
		typeof deal.MOVED_TIME === "string" && deal.MOVED_TIME.trim()
			? new Date(deal.MOVED_TIME)
			: null;
	if (!occurredAt || !Number.isFinite(occurredAt.getTime())) {
		logger.warn("yandex_metrika.stage_goal_no_stage_time", { dealId, stageId });
		return { sent: [], skipped: "no_stage_time" };
	}

	const sent: string[] = [];
	for (const goal of goals) {
		const claimToken = await claimYandexMetrikaGoalEvent(goal.id, dealKey);
		if (!claimToken) continue;
		let ok: boolean;
		try {
			ok = await sendYandexMetrikaGoal({
				target: goal.goalId,
				clientId,
				yclid,
				dealId,
				occurredAt,
			});
		} catch (err) {
			await releaseYandexMetrikaGoalEvent(goal.id, dealKey, claimToken);
			throw err;
		}
		if (ok) {
			// Ошибка записи результата не должна немедленно освобождать резерв:
			// Метрика уже приняла конверсию.
			await markYandexMetrikaGoalEventSent(goal.id, dealKey, claimToken);
			sent.push(goal.goalId);
		} else {
			await releaseYandexMetrikaGoalEvent(goal.id, dealKey, claimToken);
		}
	}
	return { sent };
}

/** Визит, с которым контакт сделки открыл нашего бота в Telegram/MAX. */
async function findContactVisitor(
	api: BitrixApi,
	deal: Record<string, unknown>,
): Promise<YandexMetrikaDealVisitor | null> {
	const contactId = Number(deal.CONTACT_ID ?? 0);
	if (!(contactId > 0)) return null;
	const contact = await api.call<{ IM?: ContactIm[] } | false>(
		"crm.contact.get",
		{ id: contactId },
	);
	return findYandexMetrikaMessengerVisitor(listContactBotTargets(contact));
}
