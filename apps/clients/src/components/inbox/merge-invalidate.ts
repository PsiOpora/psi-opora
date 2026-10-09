import type { QueryClient } from "@tanstack/react-query";
import type { SelectedClient } from "@/components/inbox/thread-pane";
import { orpc } from "@/lib/orpc/client";

/** После слияния/расцепления каналов сбрасываем всё, что читается по группе identity. */
export function invalidateAroundMerge(
	queryClient: QueryClient,
	identities: SelectedClient[],
) {
	queryClient.invalidateQueries({ queryKey: orpc.messages.list.key() });
	for (const identity of identities) {
		const input = { messenger: identity.messenger, userId: identity.userId };
		queryClient.invalidateQueries({
			queryKey: orpc.messages.profile.key({ input }),
		});
		queryClient.invalidateQueries({
			queryKey: orpc.messages.thread.key({ input }),
		});
		queryClient.invalidateQueries({
			queryKey: orpc.messages.notes.key({ input }),
		});
		queryClient.invalidateQueries({
			queryKey: orpc.messages.mergeSuggestions.key({ input }),
		});
	}
}
