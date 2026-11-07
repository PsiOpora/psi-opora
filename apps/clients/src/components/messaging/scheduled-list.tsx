"use client";

import type { ScheduledMessageItem } from "@psi-opora/api";
import {
	CalendarClockIcon,
	CircleAlertIcon,
	FileIcon,
	Loader2Icon,
	XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatScheduledAt } from "./schedule-popover";

interface ScheduledMessagesListProps {
	items: ScheduledMessageItem[];
	/** Отменить ожидающее сообщение (для упавшего — убрать из списка). */
	onCancel: (item: ScheduledMessageItem) => void;
	/** id сообщения, отмена которого сейчас выполняется. */
	cancellingId?: string | null;
}

/** Отложенные сообщения диалога: что и когда уйдёт, с возможностью отменить.
 * Упавшие остаются в списке с причиной, чтобы сбой не прошёл незамеченным. */
export function ScheduledMessagesList({
	items,
	onCancel,
	cancellingId,
}: ScheduledMessagesListProps) {
	if (items.length === 0) return null;

	return (
		<ul className="mb-2 flex flex-col gap-1">
			{items.map((item) => {
				const failed = item.status === "failed";
				const sending = item.status === "sending";
				return (
					<li
						key={item.id}
						className={
							failed
								? "flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-xs"
								: "flex items-start gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5 text-xs"
						}
					>
						{failed ? (
							<CircleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
						) : sending ? (
							<Loader2Icon className="mt-0.5 size-3.5 shrink-0 animate-spin text-muted-foreground" />
						) : (
							<CalendarClockIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
						)}
						<div className="min-w-0 flex-1">
							<p className="font-medium">
								{failed
									? `Не отправлено (на ${formatScheduledAt(item.sendAt)})`
									: sending
										? "Отправляется…"
										: `Уйдёт ${formatScheduledAt(item.sendAt)}`}
							</p>
							{item.text && (
								<p className="line-clamp-2 whitespace-pre-wrap break-words text-muted-foreground">
									{item.text}
								</p>
							)}
							{item.attachment && (
								<p className="mt-0.5 flex items-center gap-1 text-muted-foreground">
									<FileIcon className="size-3 shrink-0" />
									<span className="truncate">{item.attachment.fileName}</span>
								</p>
							)}
							{failed && item.error && (
								<p className="mt-0.5 text-destructive">{item.error}</p>
							)}
						</div>
						{!sending && (
							<Button
								type="button"
								variant="ghost"
								size="icon-xs"
								title={failed ? "Убрать из списка" : "Отменить отправку"}
								aria-label={failed ? "Убрать из списка" : "Отменить отправку"}
								disabled={cancellingId === item.id}
								onClick={() => onCancel(item)}
							>
								{cancellingId === item.id ? (
									<Loader2Icon className="animate-spin" />
								) : (
									<XIcon />
								)}
							</Button>
						)}
					</li>
				);
			})}
		</ul>
	);
}
