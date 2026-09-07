import type { BitrixApi } from "@psi-opora/bitrix-client";
import type { RedisClient } from "@psi-opora/bot-core";
import {
	getScenarioTexts,
	removePendingStageDeal,
	setPendingStageDeal,
	toInlineKeyboard,
} from "@psi-opora/bot-core";
import type { MessengerButton } from "./messenger";
import { sendMessengerMessage } from "./messenger";
import {
	DEAL_CATEGORY_ID,
	DEAL_STAGE_IDS,
	resolveDirectBotTarget,
} from "./reminders/shared";

// Стадия «Б/п консультация» — та же воронка/стадия, что отслеживают
// напоминания о бесплатной консультации (см. reminders/shared.ts).
const STAGE_ID = DEAL_STAGE_IDS[0];

interface StageConsentContact {
	IM?: Array<{ VALUE?: string; VALUE_TYPE?: string }>;
}

function sentFlagKey(dealId: number): string {
	return `stage-consent:sent:${dealId}`;
}

const SENT_TTL_SECONDS = 90 * 24 * 60 * 60;

/**
 * Обработка вебхука ONCRMDEALUPDATE для триггеров Жени: как только сделка
 * попадает в стадию «Б/п консультация», клиенту напрямую от бота уходят три
 * сообщения — оповещение, согласие с офертой (1 кнопка) и согласие на
 * рекламную рассылку (2 кнопки). Повторно на ту же сделку не срабатывает —
 * отмечается флагом в Redis, а не таймингом, в отличие от напоминаний.
 */
export async function handleStageConsentTrigger(
	api: BitrixApi,
	redis: RedisClient,
	dealId: number,
): Promise<{ action: "sent" | "skip"; reason?: string }> {
	const deal = await api.call<Record<string, unknown> | false>("crm.deal.get", {
		id: dealId,
	});
	if (!deal) return { action: "skip", reason: "deal_not_found" };

	if (Number(deal.CATEGORY_ID ?? -1) !== DEAL_CATEGORY_ID) {
		return { action: "skip", reason: "category_mismatch" };
	}
	if (String(deal.STAGE_ID ?? "") !== STAGE_ID) {
		return { action: "skip", reason: "stage_mismatch" };
	}

	const contactId = Number(deal.CONTACT_ID ?? 0);
	if (contactId <= 0) return { action: "skip", reason: "no_client_contact" };

	const contact = await api.call<StageConsentContact | false>(
		"crm.contact.get",
		{
			id: contactId,
		},
	);
	const target = resolveDirectBotTarget(deal, contact);
	if (!target) return { action: "skip", reason: "bot_target_not_found" };

	const texts = await getScenarioTexts();
	const offerButtons: MessengerButton[][] = toInlineKeyboard(
		["stage_offer_agree"],
		dealId,
		texts,
	).map((row) =>
		row.map((button) => ({ text: button.label, payload: button.action })),
	);
	const adsButtons: MessengerButton[][] = toInlineKeyboard(
		["stage_ads_agree", "stage_ads_decline"],
		dealId,
		texts,
	).map((row) =>
		row.map((button) => ({ text: button.label, payload: button.action })),
	);

	const claimed = await redis.set(sentFlagKey(dealId), true, {
		ex: SENT_TTL_SECONDS,
		nx: true,
	});
	if (claimed !== "OK") return { action: "skip", reason: "already_sent" };

	await sendMessengerMessage(
		target.messenger,
		target.userId,
		texts.stage_consent_notice,
	);

	await setPendingStageDeal(redis, target.messenger, target.userId, dealId);
	try {
		await sendMessengerMessage(
			target.messenger,
			target.userId,
			texts.stage_consent_offer_text,
			offerButtons,
		);

		// Согласие на рассылку задаём отдельным сообщением сразу вслед за офертой —
		// клиент отвечает кнопками в любом порядке, порядок вопросов только
		// задаёт, что он увидит раньше.
		await sendMessengerMessage(
			target.messenger,
			target.userId,
			texts.stage_consent_ads_text,
			adsButtons,
		);
	} catch (error) {
		await removePendingStageDeal(
			redis,
			target.messenger,
			target.userId,
			dealId,
		);
		throw error;
	}

	await api.call("crm.deal.update", {
		id: dealId,
		fields: { UF_CRM_STAGE_NOTICE_SENT_DT: new Date().toISOString() },
	});
	// Комментарий в таймлайне — чтобы Женя видела в сделке сам факт отправки,
	// не только дату/время в поле.
	await api
		.call("crm.timeline.comment.add", {
			fields: {
				ENTITY_ID: dealId,
				ENTITY_TYPE: "deal",
				COMMENT: `📨 Отправлены оповещение и запросы согласий (оферта, реклама) — ${new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК`,
			},
		})
		.catch(() => {});

	return { action: "sent" };
}
