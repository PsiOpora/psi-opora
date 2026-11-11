import { botBackgroundTasks } from "../bot-background";
import { adsSync } from "./ads-sync";
import { deliverBroadcast } from "./broadcast";
import { calendarReminders } from "./calendar-reminders";
import { getHatchetClient } from "./client";
import { crmBackup, crmBackupSchedule } from "./crm-backup";
import { diagnosticDealRecheck } from "./diagnostic-recheck";
import { dealStageHistorySync } from "./deal-stage-history-sync";
import { dealsSync } from "./deals-sync";
import { deliverEmailCampaign, pollEmailCampaigns } from "./email-campaign";
import { ingestEmailEvents } from "./email-events";
import { hourlyDrips } from "./hourly-drips";
import { maxWebhookHealthcheck } from "./max-webhook-healthcheck";
import { deliverOutreach } from "./outreach";
import { scenarioReminders } from "./scenario-reminders";
import { stageConsentOutbox } from "./stage-consent";

export const hatchetTasks = [
	deliverBroadcast,
	deliverEmailCampaign,
	deliverOutreach,
	ingestEmailEvents,
	crmBackup,
	crmBackupSchedule,
	dealsSync,
	dealStageHistorySync,
	adsSync,
	pollEmailCampaigns,
	calendarReminders,
	diagnosticDealRecheck,
	scenarioReminders,
	hourlyDrips,
	maxWebhookHealthcheck,
	stageConsentOutbox,
	...botBackgroundTasks,
];

export type StartHatchetWorkerOptions = {
	/**
	 * Вызывается при SIGTERM/SIGINT вместе с остановкой воркера: процесс
	 * завершится, только когда отработают и задачи Hatchet, и этот колбэк.
	 */
	onShutdown?: () => Promise<void>;
};

export async function startHatchetWorker(
	options: StartHatchetWorkerOptions = {},
): Promise<void> {
	const worker = await getHatchetClient().worker("psi-opora-worker", {
		slots: 10,
		// Выходим сами (см. ниже): SDK завершил бы процесс, не дожидаясь
		// фоновой работы вне Hatchet — например, отправки отложенных сообщений.
		handleKill: false,
	});
	await worker.registerWorkflows(hatchetTasks);

	let exiting = false;
	const exit = async () => {
		if (exiting) return;
		exiting = true;
		const results = await Promise.allSettled([
			worker.stop(),
			options.onShutdown?.(),
		]);
		for (const result of results) {
			if (result.status === "rejected") {
				console.error("[hatchet] сбой при остановке воркера", result.reason);
			}
		}
		process.exit(0);
	};
	process.on("SIGTERM", () => void exit());
	process.on("SIGINT", () => void exit());

	console.info(
		`[hatchet] worker запускается, зарегистрировано задач: ${hatchetTasks.length}`,
	);
	await worker.start();
}
