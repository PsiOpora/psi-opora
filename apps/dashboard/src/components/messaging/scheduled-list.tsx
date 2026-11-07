"use client";

import type { ScheduledMessageItem } from "@psi-opora/api";
import {
	CalendarClockIcon,
	ChevronDownIcon,
	CircleAlertIcon,
	FileIcon,
	Loader2Icon,
	XIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatScheduledAt } from "./schedule-popover";

interface ScheduledMessagesListProps {
	items: ScheduledMessageItem[];
	/** Отменить ожидающее сообщение (для упавшего — убрать из списка). */
	onCancel: (item: ScheduledMessageItem) => void;
	/** id сообщения, отмена которого сейчас выполняется. */
	cancellingId?: string | null;
	className?: string;
}

function pluralizeMessages(n: number): string {
	const mod10 = n % 10;
	const mod100 = n % 100;
	if (mod10 === 1 && mod100 !== 11) return "сообщение";
	if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
		return "сообщения";
	}
	return "сообщений";
}

/** Отложенные сообщения диалога: что и когда уйдёт, с возможностью отменить.
 * Свёрнуты в одну строку «Отложено: N», чтобы не отнимать высоту у переписки;
 * раскрыты по умолчанию, если сообщение одно или есть упавшее — сбой не должен
 * пройти незамеченным. */
export function ScheduledMessagesList({
	items,
	onCancel,
	cancellingId,
	className,
}: ScheduledMessagesListProps) {
	const hasFailed = items.some((item) => item.status === "failed");
	// null — пользователь ещё не трогал переключатель, действует значение по умолчанию
	const listId = useId();
	const [userOpen, setUserOpen] = useState<boolean | null>(null);

	if (items.length === 0) return null;

	const open = userOpen ?? (hasFailed || items.length === 1);
	const nextAt = items.find((item) => item.status !== "failed")?.sendAt;

	return (
		<div
			className={cn(
				"overflow-hidden rounded-xl border bg-background shadow-xs",
				hasFailed && "border-destructive/40",
				className,
			)}
		>
			<button
				type="button"
				aria-expanded={open}
				aria-controls={listId}
				onClick={() => setUserOpen(!open)}
				className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-muted/50"
			>
				{hasFailed ? (
					<CircleAlertIcon className="size-4 shrink-0 text-destructive" />
				) : (
					<CalendarClockIcon className="size-4 shrink-0 text-muted-foreground" />
				)}
				<span className="shrink-0 font-medium">
					Отложено: {items.length} {pluralizeMessages(items.length)}
				</span>
				{nextAt && !open && (
					<span className="truncate text-muted-foreground">
						ближайшее — {formatScheduledAt(nextAt)}
					</span>
				)}
				<ChevronDownIcon
					className={cn(
						"ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-200",
						open && "rotate-180",
					)}
				/>
			</button>
			{open && (
				<ul
					id={listId}
					className="flex max-h-40 flex-col divide-y overflow-y-auto border-t">
					{items.map((item) => {
						const failed = item.status === "failed";
						const sending = item.status === "sending";
						return (
							<li
								key={item.id}
								className={cn(
									"flex items-start gap-2 px-3 py-2 text-xs",
									failed && "bg-destructive/5",
								)}
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
										<p className="line-clamp-2 whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
											{item.text}
										</p>
									)}
									{item.attachment && (
										<p className="mt-0.5 flex items-center gap-1 text-muted-foreground">
											<FileIcon className="size-3 shrink-0" />
											<span className="truncate">
												{item.attachment.fileName}
											</span>
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
										aria-label={
											failed ? "Убрать из списка" : "Отменить отправку"
										}
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
			)}
		</div>
	);
}
