import { getHatchetClient } from "./client";
import {
  type DeliverBroadcastPayload,
  deliverBroadcast,
} from "./broadcast";
import { type CrmBackupPayload, crmBackup } from "./crm-backup";
import {
  type DeliverEmailCampaignPayload,
  deliverEmailCampaign,
} from "./email-campaign";

export interface EnqueuedRun {
  id: string;
}

async function enqueue<I extends Record<string, unknown>>(
  task: Parameters<ReturnType<typeof getHatchetClient>["runNoWait"]>[0],
  payload: I,
): Promise<EnqueuedRun> {
  const ref = await getHatchetClient().runNoWait(task, payload);
  return { id: await ref.getWorkflowRunId() };
}

export function enqueueBroadcast(
  payload: DeliverBroadcastPayload,
): Promise<EnqueuedRun> {
  return enqueue(deliverBroadcast, payload);
}

export function enqueueEmailCampaign(
  payload: DeliverEmailCampaignPayload,
): Promise<EnqueuedRun> {
  return enqueue(deliverEmailCampaign, payload);
}

export function enqueueCrmBackup(
  payload: CrmBackupPayload,
): Promise<EnqueuedRun> {
  return enqueue(crmBackup, payload);
}
