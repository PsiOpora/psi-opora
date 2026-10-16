import { botBackgroundTasks } from "../bot-background";
import { adsSync } from "./ads-sync";
import { deliverBroadcast } from "./broadcast";
import { calendarReminders } from "./calendar-reminders";
import { getHatchetClient } from "./client";
import { crmBackup, crmBackupSchedule } from "./crm-backup";
import { dealStageHistorySync } from "./deal-stage-history-sync";
import { dealsSync } from "./deals-sync";
import { deliverEmailCampaign, pollEmailCampaigns } from "./email-campaign";
import { ingestEmailEvents } from "./email-events";
import { hourlyDrips } from "./hourly-drips";
import { maxWebhookHealthcheck } from "./max-webhook-healthcheck";
import { scenarioReminders } from "./scenario-reminders";
import { stageConsentOutbox } from "./stage-consent";

export const hatchetTasks = [
	deliverBroadcast,
	deliverEmailCampaign,
	ingestEmailEvents,
	crmBackup,
	crmBackupSchedule,
	dealsSync,
	dealStageHistorySync,
	adsSync,
	pollEmailCampaigns,
	calendarReminders,
	scenarioReminders,
	hourlyDrips,
	maxWebhookHealthcheck,
	stageConsentOutbox,
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
