"use client";

import type { ClientListItem } from "@psi-opora/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2Icon, Loader2Icon, XIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { messengerLabel } from "@/components/inbox/messenger-meta";
import type {
	CurrentOperator,
	SelectedClient,
} from "@/components/inbox/thread-pane";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { orpc, orpcClient } from "@/lib/orpc/client";

/**
 * Каналы одного человека (например, Telegram и MAX), объединённые в единую
 * карточку клиента — см. packages/db/src/queries/client-identity-links.ts.
 * Переписка/заметки/теги после слияния читаются и пишутся у выбранного здесь
 * primary, secondary остаются только ссылкой в этой таблице.
 */
export function MergeSection({
	selected,
	linkedIdentities,
	operator,
	onMerged,
}: {
	selected: SelectedClient;
	linkedIdentities: SelectedClient[];
	operator: CurrentOperator | null;
	onMerged: (primary: SelectedClient) => void;
}) {
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [merging, startMerging] = useTransition();
	const [unmerging, startUnmerging] = useTransition();

	const { data, isFetching } = useQuery(
		orpc.messages.list.queryOptions({
			input: { search: search.trim() || undefined },
			enabled: open,
		}),
	);

	const candidates = (data?.items ?? []).filter(
		(c) =>
			!(c.messenger === selected.messenger && c.userId === selected.userId) &&
			!linkedIdentities.some(
				(l) => l.messenger === c.messenger && l.userId === c.userId,
			),
	);

	const invalidateAround = (identities: SelectedClient[]) => {
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
		}
	};

	const mergeInto = (target: ClientListItem) => {
		startMerging(async () => {
			const result = await orpcClient.messages.mergeClients({
				messenger: selected.messenger,
				userId: selected.userId,
				intoMessenger: target.messenger,
				intoUserId: target.userId,
				operatorId: operator?.id,
				operatorName: operator?.name,
			});
			setOpen(false);
			setSearch("");
			invalidateAround([
				selected,
				{ messenger: target.messenger, userId: target.userId },
			]);
			onMerged(result.primary);
		});
	};

	const unmerge = (identity: SelectedClient) => {
		if (!window.confirm("Отвязать канал? Он снова станет отдельным клиентом."))
			return;
		startUnmerging(async () => {
			await orpcClient.messages.unmergeClient(identity);
			invalidateAround([selected, identity]);
		});
	};

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase">
				<Link2Icon className="size-3.5" />
				Объединённые каналы
			</div>

			{linkedIdentities.length > 0 && (
				<div className="flex flex-wrap gap-1.5">
					{linkedIdentities.map((identity) => (
						<Badge
							key={`${identity.messenger}:${identity.userId}`}
							variant="secondary"
							className="gap-1 pr-1 text-xs"
						>
							{messengerLabel(identity.messenger)}
							<button
								type="button"
								onClick={() => unmerge(identity)}
								disabled={unmerging}
								title="Отвязать канал"
								className="rounded-full p-0.5 hover:bg-muted-foreground/20"
							>
								<XIcon className="size-2.5" />
							</button>
						</Badge>
					))}
				</div>
			)}

			<Dialog open={open} onOpenChange={setOpen}>
				<DialogTrigger asChild>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="self-start"
					>
						Объединить с другим клиентом
					</Button>
				</DialogTrigger>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Объединить с другим клиентом</DialogTitle>
						<DialogDescription>
							Если это один и тот же человек писал из другого канала —
							объедините карточки. Переписка, заметки и теги соберутся у
							клиента, которого вы выберете ниже.
						</DialogDescription>
					</DialogHeader>
					<Input
						autoFocus
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder="Поиск по имени или username…"
					/>
					<div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
						{isFetching && (
							<div className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
								<Loader2Icon className="size-4 animate-spin" />
								Ищем…
							</div>
						)}
						{!isFetching &&
							candidates.map((c) => (
								<button
									key={`${c.messenger}:${c.userId}`}
									type="button"
									onClick={() => mergeInto(c)}
									disabled={merging}
									className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50"
								>
									<span className="truncate">{c.name}</span>
									<span className="shrink-0 text-xs text-muted-foreground">
										{messengerLabel(c.messenger)}
									</span>
								</button>
							))}
						{!isFetching && search.trim() && candidates.length === 0 && (
							<p className="p-2 text-xs text-muted-foreground">
								Никого не найдено
							</p>
						)}
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}
