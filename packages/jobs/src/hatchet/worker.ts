import { botBackgroundTasks } from "../bot-background";
import { adsStatsSync } from "./ads-stats-sync";
import { bookPreorderDrip } from "./book-preorder-drip";
import { deliverBroadcast } from "./broadcast";
import { getHatchetClient } from "./client";
import { consultationReminders } from "./consultation-reminders";
import { crmBackup, crmBackupSchedule } from "./crm-backup";
import { dealStageHistorySync } from "./deal-stage-history-sync";
import { dealsSync } from "./deals-sync";
import { diagnosticReminders } from "./diagnostic-reminders";
import { deliverEmailCampaign, pollEmailCampaigns } from "./email-campaign";
import { guideFollowUps } from "./guide-follow-ups";
import { maxWebhookHealthcheck } from "./max-webhook-healthcheck";
import { scenarioReminders } from "./scenario-reminders";
import { stageConsentOutbox } from "./stage-consent";

export const hatchetTasks = [
	deliverBroadcast,
	deliverEmailCampaign,
	crmBackup,
	crmBackupSchedule,
	dealsSync,
	dealStageHistorySync,
	adsStatsSync,
	pollEmailCampaigns,
	consultationReminders,
	diagnosticReminders,
	scenarioReminders,
	guideFollowUps,
	maxWebhookHealthcheck,
	stageConsentOutbox,
	bookPreorderDrip,
	...botBackgroundTasks,
];

export async function startHatchetWorker(): Promise<void> {
	const worker = await getHatchetClient().worker("psi-opora-worker", {
		slots: 10,
		handleKill: true,
	});
	await worker.registerWorkflows(hatchetTasks);

	console.info(
		`[hatchet] worker запускается, зарегистрировано задач: ${hatchetTasks.length}`,
	);
	await worker.start();
}
