"use client";

import type { WidgetHistoryItem } from "@psi-opora/api";
import {
	CheckCheckIcon,
	CheckIcon,
	CircleAlertIcon,
	Clock3Icon,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { MessengerIcon } from "@/components/messaging/messenger-icon";
import { messengerLabel } from "@/components/messaging/messenger-meta";
import { cn } from "@/lib/utils";

/** Оптимистично добавленное сообщение до подтверждения записи в БД поллингом. */
export type HistoryEntry = WidgetHistoryItem & { pending?: boolean };

export const SOURCE_LABELS: Record<string, string> = {
	reminder: "напоминание",
	widget: "оператор",
	broadcast: "рассылка",
	operator: "оператор",
};

/** Кто фактически отправил исходящее сообщение — определяет цвет пузыря:
 * бот/автоматика получает один стиль, живой оператор (ответ из этой вкладки
 * или из линии Bitrix) — другой. */
const BOT_SOURCES = new Set(["reminder", "broadcast", "scenario"]);

/** Статус доставки исходящего сообщения. Выше "sent" его поднимает только
 * WhatsApp (ack WAHA) — у Telegram/MAX нет вебхуков доставки, это ограничение
 * их API. "failed" ставят пути отправки, когда мессенджер отклонил сообщение. */
const STATUS_META: Record<
	string,
	{ icon: typeof CheckIcon; className?: string; label: string }
> = {
	queued: { icon: Clock3Icon, label: "ожидает отправки" },
	sent: { icon: CheckIcon, label: "отправлено" },
	delivered: { icon: CheckCheckIcon, label: "доставлено" },
	read: { icon: CheckCheckIcon, className: "text-sky-500", label: "прочитано" },
	failed: {
		icon: CircleAlertIcon,
		className: "text-destructive",
		label: "не доставлено",
	},
};

const BUBBLE_STYLES = {
	in: "self-start rounded-bl-md border bg-message-client text-message-client-foreground border-message-client-border",
	bot: "self-end rounded-br-md bg-message-bot text-message-bot-foreground",
	operator:
		"self-end rounded-br-md bg-message-operator text-message-operator-foreground",
};

/** Насколько близко к низу нужно быть, чтобы новое сообщение автоскроллило —
 * иначе менеджер, читающий историю выше, не будет «дёрнут» вниз поллингом. */
const STICK_TO_BOTTOM_THRESHOLD_PX = 60;

/** Вливает новые сообщения с поллинга в локальную историю: уже известный id —
 * обновляет запись на месте (так долетают статусные апдейты sent → delivered
 * → read → failed по уже показанным сообщениям, поллинг ходит по updatedAt),
 * совпадающее по смыслу оптимистичное сообщение — заменяет подтверждённой
 * записью (чтобы не задваивать только что отправленное), остальное —
 * добавляет. Матчинг оптимистичной записи идёт по id с префиксом "pending-",
 * а не по флагу `pending` — он мог быть уже снят по таймауту, но запись всё
 * ещё нужно бесшовно заменить подтверждённой, без дубля. */
export function mergeHistory(
	prev: HistoryEntry[],
	incoming: WidgetHistoryItem[],
): HistoryEntry[] {
	let next = prev;
	for (const msg of incoming) {
		const existingIdx = next.findIndex((item) => item.id === msg.id);
		if (existingIdx !== -1) {
			next = [
				...next.slice(0, existingIdx),
				{ ...next[existingIdx], ...msg },
				...next.slice(existingIdx + 1),
			];
			continue;
		}
		const pendingIdx = next.findIndex(
			(item) =>
				item.id.startsWith("pending-") &&
				item.messenger === msg.messenger &&
				item.direction === msg.direction &&
				item.text === msg.text,
		);
		if (pendingIdx !== -1) {
			next = [...next.slice(0, pendingIdx), msg, ...next.slice(pendingIdx + 1)];
		} else {
			next = [...next, msg];
		}
	}
	return next;
}

function dayKey(iso: string): string {
	return new Date(iso).toDateString();
}

function formatDayLabel(iso: string): string {
	const date = new Date(iso);
	const today = new Date();
	const yesterday = new Date();
	yesterday.setDate(today.getDate() - 1);
	if (dayKey(iso) === dayKey(today.toISOString())) return "Сегодня";
	if (dayKey(iso) === dayKey(yesterday.toISOString())) return "Вчера";
	return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "long" });
}

function formatTime(iso: string): string {
	return new Date(iso).toLocaleTimeString("ru-RU", {
		hour: "2-digit",
		minute: "2-digit",
	});
}

export function HistoryList({ history }: { history: HistoryEntry[] }) {
	const containerRef = useRef<HTMLDivElement>(null);
	const stickToBottomRef = useRef(true);

	useEffect(() => {
		const el = containerRef.current;
		if (el && stickToBottomRef.current && history.length > 0) {
			el.scrollTop = el.scrollHeight;
		}
	}, [history.length]);

	const handleScroll = () => {
		const el = containerRef.current;
		if (!el) return;
		stickToBottomRef.current =
			el.scrollHeight - el.scrollTop - el.clientHeight <
			STICK_TO_BOTTOM_THRESHOLD_PX;
	};

	if (history.length === 0) {
		return (
			<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
				Сообщений пока нет — напишите первым
			</div>
		);
	}

	return (
		<div
			ref={containerRef}
			onScroll={handleScroll}
			className="flex h-full flex-col overflow-y-auto px-4 py-3"
		>
			{history.map((item, index) => {
				const prev = history[index - 1];
				const showDay =
					!prev || dayKey(prev.createdAt) !== dayKey(item.createdAt);
				const bubbleKind =
					item.direction === "in"
						? "in"
						: BOT_SOURCES.has(item.source)
							? "bot"
							: "operator";
				const groupedWithPrev =
					!showDay &&
					!!prev &&
					prev.direction === item.direction &&
					prev.source === item.source &&
					prev.messenger === item.messenger;
				const statusMeta =
					item.direction === "out" && !item.pending
						? STATUS_META[item.status]
						: undefined;
				const StatusIcon = statusMeta?.icon;

				return (
					<div
						key={item.id}
						className={cn(
							"flex flex-col",
							showDay ? "mt-0" : groupedWithPrev ? "mt-1" : "mt-3",
						)}
					>
						{showDay && (
							<div className="my-3 flex items-center gap-3">
								<div className="h-px flex-1 bg-border" />
								<span className="text-xs text-muted-foreground">
									{formatDayLabel(item.createdAt)}
								</span>
								<div className="h-px flex-1 bg-border" />
							</div>
						)}
						<div
							className={cn(
								"flex",
								item.direction === "out" ? "justify-end" : "justify-start",
							)}
						>
							<div
								className={cn(
									"max-w-[80%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap shadow-sm",
									BUBBLE_STYLES[bubbleKind],
									item.pending && "opacity-60",
									item.direction === "out" &&
										item.status === "failed" &&
										"ring-1 ring-destructive/40",
								)}
							>
								{item.text}
								<div
									className={cn(
										"mt-1 flex items-center gap-1 text-[10px] opacity-70",
										item.direction === "out" && "justify-end",
									)}
								>
									<MessengerIcon
										messenger={item.messenger}
										className="size-3 shrink-0"
									/>
									<span>{messengerLabel(item.messenger)}</span>
									{SOURCE_LABELS[item.source] && (
										<>
											<span>·</span>
											<span>{SOURCE_LABELS[item.source]}</span>
										</>
									)}
									<span>·</span>
									<span>{formatTime(item.createdAt)}</span>
									{item.pending && <span>· отправляется…</span>}
									{StatusIcon && (
										<span
											className={cn(
												"flex items-center gap-0.5",
												statusMeta?.className,
											)}
										>
											<StatusIcon className="size-3" />
											{statusMeta?.label}
										</span>
									)}
								</div>
							</div>
						</div>
					</div>
				);
			})}
		</div>
	);
}
