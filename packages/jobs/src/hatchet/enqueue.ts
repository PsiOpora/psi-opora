import { getHatchetClient } from "./client";
import { type DeliverBroadcastPayload, deliverBroadcast } from "./broadcast";
import { type CrmBackupPayload, crmBackup } from "./crm-backup";
import {
	type DeliverEmailCampaignPayload,
	deliverEmailCampaign,
} from "./email-campaign";

export interface EnqueuedRun {
	id: string;
}

async function toEnqueuedRun(
	refPromise: ReturnType<ReturnType<typeof getHatchetClient>["runNoWait"]>,
): Promise<EnqueuedRun> {
	const ref = await refPromise;
	return { id: await ref.getWorkflowRunId() };
}

export function enqueueBroadcast(
	payload: DeliverBroadcastPayload,
): Promise<EnqueuedRun> {
	return toEnqueuedRun(getHatchetClient().runNoWait(deliverBroadcast, payload));
}

export function enqueueEmailCampaign(
	payload: DeliverEmailCampaignPayload,
): Promise<EnqueuedRun> {
	return toEnqueuedRun(
		getHatchetClient().runNoWait(deliverEmailCampaign, payload),
	);
}

export function enqueueCrmBackup(
	payload: CrmBackupPayload,
): Promise<EnqueuedRun> {
	return toEnqueuedRun(getHatchetClient().runNoWait(crmBackup, payload));
}
