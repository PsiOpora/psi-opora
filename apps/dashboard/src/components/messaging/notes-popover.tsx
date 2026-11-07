"use client";

import type { WidgetEntity } from "@psi-opora/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2Icon, StickyNoteIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { orpc, orpcClient } from "@/lib/orpc/client";

export interface CurrentOperator {
	id: string;
	name: string;
}

interface NotesPopoverProps {
	entity: WidgetEntity;
	entityId: string;
	operator: CurrentOperator | null;
	/** Нет каналов — заметку не к чему привязать. */
	disabled?: boolean;
}

function formatNoteDate(iso: string): string {
	return new Date(iso).toLocaleString("ru-RU", {
		day: "2-digit",
		month: "short",
		hour: "2-digit",
		minute: "2-digit",
	});
}

/** Внутренние заметки по клиенту — видны только операторам, клиенту не
 * отправляются. Те же заметки показывает единый инбокс «Клиенты». */
export function NotesPopover({
	entity,
	entityId,
	operator,
	disabled,
}: NotesPopoverProps) {
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState("");
	const [busy, setBusy] = useState(false);

	const notesQuery = useQuery({
		...orpc.widgetMessage.notes.queryOptions({
			input: { entity, id: entityId },
		}),
		enabled: Boolean(entityId) && !disabled,
	});
	const notes = notesQuery.data?.notes ?? [];

	const refresh = () =>
		queryClient.invalidateQueries({
			queryKey: orpc.widgetMessage.notes.key(),
		});

	const add = async () => {
		const text = draft.trim();
		if (!text || busy) return;
		setBusy(true);
		try {
			const result = await orpcClient.widgetMessage.addNote({
				entity,
				id: entityId,
				text,
				operatorId: operator?.id,
				operatorName: operator?.name,
			});
			if (result.error) {
				toast.error(result.error);
				return;
			}
			setDraft("");
			await refresh();
		} catch {
			toast.error("Не удалось сохранить заметку");
		} finally {
			setBusy(false);
		}
	};

	const remove = async (noteId: string) => {
		try {
			await orpcClient.messages.deleteNote({ noteId });
			await refresh();
		} catch {
			toast.error("Не удалось удалить заметку");
		}
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					disabled={disabled}
					title="Заметки об этом клиенте"
					aria-label={`Заметки${notes.length ? `: ${notes.length}` : ""}`}
					className="relative"
				>
					<StickyNoteIcon className="size-4" />
					{notes.length > 0 && (
						<span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-4 font-medium text-primary-foreground">
							{notes.length}
						</span>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-96 gap-3">
				<div>
					<p className="text-sm font-medium">Заметки</p>
					<p className="text-xs text-muted-foreground">
						Видны только сотрудникам — клиент их не получит.
					</p>
				</div>
				<ul className="flex max-h-64 flex-col gap-2 overflow-y-auto">
					{notesQuery.isLoading && (
						<li className="flex items-center gap-2 text-xs text-muted-foreground">
							<Loader2Icon className="size-3.5 animate-spin" />
							Загружаем…
						</li>
					)}
					{!notesQuery.isLoading && notes.length === 0 && (
						<li className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
							Заметок пока нет. Запишите то, что важно помнить о клиенте.
						</li>
					)}
					{notes.map((note) => (
						<li
							key={note.id}
							className="group rounded-lg bg-amber-500/10 px-3 py-2 text-sm"
						>
							<p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
								{note.text}
							</p>
							<div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
								<span>
									{note.operatorName ? `${note.operatorName} · ` : ""}
									{formatNoteDate(note.createdAt)}
								</span>
								<Button
									type="button"
									variant="ghost"
									size="icon-xs"
									title="Удалить заметку"
									aria-label="Удалить заметку"
									className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
									onClick={() => void remove(note.id)}
								>
									<Trash2Icon />
								</Button>
							</div>
						</li>
					))}
				</ul>
				<div className="flex flex-col gap-2">
					<textarea
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (
								e.key === "Enter" &&
								(e.ctrlKey || e.metaKey) &&
								!e.nativeEvent.isComposing
							) {
								e.preventDefault();
								void add();
							}
						}}
						placeholder="Новая заметка (Ctrl+Enter — сохранить)"
						aria-label="Текст заметки"
						maxLength={2000}
						rows={3}
						className="w-full resize-none rounded-lg border bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
					/>
					<Button
						type="button"
						disabled={busy || !draft.trim()}
						onClick={() => void add()}
					>
						{busy && <Loader2Icon className="size-4 animate-spin" />}
						Добавить заметку
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
