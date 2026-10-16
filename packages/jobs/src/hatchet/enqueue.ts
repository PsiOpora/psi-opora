import { type DeliverBroadcastPayload, deliverBroadcast } from "./broadcast";
import { getHatchetClient } from "./client";
import { type CrmBackupPayload, crmBackup } from "./crm-backup";
import {
	type DeliverEmailCampaignPayload,
	deliverEmailCampaign,
} from "./email-campaign";
import {
	type IngestEmailEventsPayload,
	ingestEmailEvents,
} from "./email-events";
import { type DeliverOutreachPayload, deliverOutreach } from "./outreach";

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

export function enqueueOutreach(
	payload: DeliverOutreachPayload,
): Promise<EnqueuedRun> {
	return toEnqueuedRun(getHatchetClient().runNoWait(deliverOutreach, payload));
}

export function enqueueEmailEvents(
	payload: IngestEmailEventsPayload,
): Promise<EnqueuedRun> {
	return toEnqueuedRun(
		getHatchetClient().runNoWait(ingestEmailEvents, payload),
	);
}

export function enqueueCrmBackup(
	payload: CrmBackupPayload,
): Promise<EnqueuedRun> {
	return toEnqueuedRun(getHatchetClient().runNoWait(crmBackup, payload));
}
