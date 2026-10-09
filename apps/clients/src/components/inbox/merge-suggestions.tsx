"use client";

import type { MergeSuggestion } from "@psi-opora/api";
import { formatPhone } from "@psi-opora/api/schemas";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UsersIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { invalidateAroundMerge } from "@/components/inbox/merge-invalidate";
import { messengerLabel } from "@/components/inbox/messenger-meta";
import type {
	CurrentOperator,
	SelectedClient,
} from "@/components/inbox/thread-pane";
import { Button } from "@/components/ui/button";
import { orpc, orpcClient } from "@/lib/orpc/client";

function reasonText(suggestion: MergeSuggestion): string {
	if (suggestion.reason === "same-contact") {
		return "Диалог привязан к тому же контакту в CRM";
	}
	return suggestion.phone
		? `Совпадает номер ${formatPhone(suggestion.phone)}`
		: "Совпадает номер телефона";
}

/**
 * Подсказка «возможно, это тот же клиент»: тот же контакт CRM или телефон в
 * другом мессенджере — см. packages/api/src/routers/messages/merge-suggestions.ts.
 * Слияние всегда по решению оператора; «Это разные люди» прячет пару навсегда.
 * Обновляется сразу после сохранения телефона в PhoneSection — номер часто и
 * есть тот самый признак.
 */
export function MergeSuggestions({
	selected,
	operator,
	onMerged,
}: {
	selected: SelectedClient;
	operator: CurrentOperator | null;
	onMerged: (primary: SelectedClient) => void;
}) {
	const queryClient = useQueryClient();
	const input = { messenger: selected.messenger, userId: selected.userId };
	const [busyKey, setBusyKey] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();

	const { data } = useQuery(
		orpc.messages.mergeSuggestions.queryOptions({ input, staleTime: 60_000 }),
	);
	const suggestions = data?.suggestions ?? [];
	if (suggestions.length === 0) return null;

	const run = (suggestion: MergeSuggestion, action: "merge" | "dismiss") => {
		setBusyKey(`${suggestion.messenger}:${suggestion.userId}`);
		startTransition(async () => {
			try {
				if (action === "merge") {
					// Выбранная карточка остаётся главной — оператор не теряет её из виду.
					const result = await orpcClient.messages.mergeClients({
						messenger: suggestion.messenger,
						userId: suggestion.userId,
						intoMessenger: selected.messenger,
						intoUserId: selected.userId,
						operatorId: operator?.id,
						operatorName: operator?.name,
					});
					invalidateAroundMerge(queryClient, [selected, suggestion]);
					toast.success(`Каналы объединены: ${suggestion.name}`);
					onMerged(result.primary);
				} else {
					await orpcClient.messages.dismissMergeSuggestion({
						...input,
						otherMessenger: suggestion.messenger,
						otherUserId: suggestion.userId,
						operatorId: operator?.id,
						operatorName: operator?.name,
					});
					await queryClient.invalidateQueries({
						queryKey: orpc.messages.mergeSuggestions.key({ input }),
					});
				}
			} catch (err) {
				toast.error((err as Error).message || "Не удалось выполнить действие");
			} finally {
				setBusyKey(null);
			}
		});
	};

	return (
		<div className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
			<div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase">
				<UsersIcon className="size-3.5" />
				Возможный дубль
			</div>
			{suggestions.map((suggestion) => {
				const key = `${suggestion.messenger}:${suggestion.userId}`;
				return (
					<div key={key} className="flex flex-col gap-1.5 text-sm">
						<p>
							<span className="font-medium">{suggestion.name}</span>
							<span className="text-muted-foreground">
								{" "}
								· {messengerLabel(suggestion.messenger)}
								{suggestion.username ? ` · @${suggestion.username}` : ""}
							</span>
						</p>
						<p className="text-xs text-muted-foreground">
							{reasonText(suggestion)}. Если это один человек — объедините
							карточки: переписка, заметки и теги соберутся в одном месте.
						</p>
						<div className="flex gap-1.5">
							<Button
								size="xs"
								disabled={pending && busyKey === key}
								onClick={() => run(suggestion, "merge")}
							>
								Объединить
							</Button>
							<Button
								size="xs"
								variant="ghost"
								disabled={pending && busyKey === key}
								onClick={() => run(suggestion, "dismiss")}
							>
								Это разные люди
							</Button>
						</div>
					</div>
				);
			})}
		</div>
	);
}
