import {
	listDueGuideFollowUps,
	markGuideFollowUpSent,
} from "@psi-opora/db/queries";
import { type Messenger, sendMessengerMessage } from "./messenger";

export interface SendGuideFollowUpsResult {
	sent: number;
	errors: number;
}

/**
 * Follow-up по кампаниям гайдов: клиентам, получившим материал не менее
 * campaign.followUpDelayDays назад и ещё не получавшим напоминание,
 * отправляется campaign.followUpMessage с кнопкой записи на диагностику
 * (см. sc_guide_diagnostic в apps/tg-bot и apps/max-bot).
 */
export async function sendGuideFollowUps(): Promise<SendGuideFollowUpsResult> {
	const due = await listDueGuideFollowUps();
	let sent = 0;
	let errors = 0;

	for (const { delivery, campaign } of due) {
		try {
			await sendMessengerMessage(
				delivery.messenger as Messenger,
				delivery.userId,
				campaign.followUpMessage,
				[
					[
						{
							text: campaign.diagnosticCtaText,
							payload: "sc_guide_diagnostic",
						},
					],
				],
			);
			await markGuideFollowUpSent(delivery.id);
			sent++;
		} catch (err) {
			errors++;
			console.error(
				`[guide-follow-ups] delivery=${delivery.id} messenger=${delivery.messenger}: ${(err as Error).message}`,
			);
		}
	}

	return { sent, errors };
}
