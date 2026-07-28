import { getHatchetClient } from "./client";
import { deliverBroadcast } from "./broadcast";
import { consultationReminders } from "./consultation-reminders";
import { crmBackup, crmBackupSchedule } from "./crm-backup";
import { diagnosticReminders } from "./diagnostic-reminders";
import {
  deliverEmailCampaign,
  pollEmailCampaigns,
} from "./email-campaign";
import { maxWebhookHealthcheck } from "./max-webhook-healthcheck";
import { scenarioReminders } from "./scenario-reminders";

export const hatchetTasks = [
  deliverBroadcast,
  deliverEmailCampaign,
  crmBackup,
  crmBackupSchedule,
  pollEmailCampaigns,
  consultationReminders,
  diagnosticReminders,
  scenarioReminders,
  maxWebhookHealthcheck,
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
