import type { ClientMessageItem } from "@psi-opora/api";

interface ThreadSnapshot {
	messages: ClientMessageItem[];
	deletionVersion: string;
}

/** A deletion can return no message deltas. Replace history before advancing
 * its version; a failed reload must be retried by the next poll. */
export async function resolveThreadPoll(
	result: Partial<ThreadSnapshot>,
	deletionVersion: string,
	loadThread: () => Promise<ThreadSnapshot>,
): Promise<(ThreadSnapshot & { replace: boolean }) | undefined> {
	if (!result.messages || result.deletionVersion === undefined) return;
	if (result.deletionVersion !== deletionVersion) {
		return { ...(await loadThread()), replace: true };
	}
	return {
		messages: result.messages,
		deletionVersion: result.deletionVersion,
		replace: false,
	};
}
