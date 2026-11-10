import type { BitrixApi } from "@psi-opora/bitrix-client";
import type { RedisClient } from "@psi-opora/bot-core";
import { DEAL_CATEGORY_ID, DEAL_STAGE_IDS } from "./reminders/shared";
import { handleStageConsentTrigger } from "./stage-consent";

const STAGE_ID = DEAL_STAGE_IDS[0];
const NOTICE_SENT_FIELD = "UF_CRM_STAGE_NOTICE_SENT_DT";

/**
 * Насколько давно сделка могла перейти в стадию, чтобы крон ещё досылал
 * согласия. Ограничение обязательно: без него первый же прогон разослал бы
 * сообщения всем сделкам, которые стоят в стадии давно и без отметки.
 */
export const STAGE_CONSENT_SWEEP_LOOKBACK_MS = 24 * 60 * 60 * 1000;

interface SweepDeal {
	ID?: string | number;
	[NOTICE_SENT_FIELD]?: unknown;
}

type StageConsentHandler = typeof handleStageConsentTrigger;

export interface SweepMissedStageConsentsResult {
	checked: number;
	sent: number;
	skipped: number;
	errors: number;
}

/**
 * Страховка триггера согласий стадии «Б/п консультация»: он запускается только
 * вебхуком ONCRMDEALUPDATE, и если событие о смене стадии потерялось, клиент
 * не получал сообщений до следующей правки сделки. Крон calendar-reminders раз
 * в 10 минут находит сделки, недавно перешедшие в стадию и без отметки об
 * отправке, и прогоняет их через тот же обработчик. Повторной отправки не
 * будет: её исключает флаг в Redis внутри handleStageConsentTrigger.
 */
export async function sweepMissedStageConsents(
	api: BitrixApi,
	redis: RedisClient,
	options: { now?: () => number; handler?: StageConsentHandler } = {},
): Promise<SweepMissedStageConsentsResult> {
	const now = options.now?.() ?? Date.now();
	const handler = options.handler ?? handleStageConsentTrigger;

	const deals = await api.list<SweepDeal>("crm.deal.list", {
		select: ["ID", NOTICE_SENT_FIELD],
		filter: {
			CATEGORY_ID: DEAL_CATEGORY_ID,
			STAGE_ID,
			">=MOVED_TIME": new Date(
				now - STAGE_CONSENT_SWEEP_LOOKBACK_MS,
			).toISOString(),
		},
		order: { ID: "ASC" },
	});

	const summary: SweepMissedStageConsentsResult = {
		checked: 0,
		sent: 0,
		skipped: 0,
		errors: 0,
	};
	for (const deal of deals) {
		const dealId = Number(deal.ID ?? 0);
		if (!Number.isInteger(dealId) || dealId <= 0) continue;
		// Отметка стоит — вебхук отработал штатно.
		if (String(deal[NOTICE_SENT_FIELD] ?? "").trim()) continue;

		summary.checked++;
		try {
			const result = await handler(api, redis, dealId);
			if (result.action === "sent") {
				summary.sent++;
				console.info(
					`[stage-consent-sweep] сделка ${dealId}: согласия досланы кроном — вебхук о смене стадии не отработал`,
				);
			} else {
				summary.skipped++;
			}
		} catch (error) {
			summary.errors++;
			console.error(
				`[stage-consent-sweep] сделка ${dealId}: ${(error as Error).message}`,
			);
		}
	}
	return summary;
}
