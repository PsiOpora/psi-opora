"use client";

import type { WidgetHistoryItem } from "@psi-opora/api";
import {
	ArrowDownIcon,
	CheckCheckIcon,
	CheckIcon,
	CircleAlertIcon,
	Clock3Icon,
	MessageSquareTextIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
	in: "border bg-message-client text-message-client-foreground border-message-client-border",
	bot: "bg-message-bot text-message-bot-foreground",
	operator: "bg-message-operator text-message-operator-foreground",
};

/** «Хвостик» у последнего пузыря в серии — угол со стороны отправителя. */
const BUBBLE_TAIL = { in: "rounded-bl-md", out: "rounded-br-md" } as const;

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

/** Серия — подряд идущие сообщения одного отправителя в одном канале: подпись
 * «канал · кто отправил» показываем один раз над первым пузырём, а не в каждом. */
function sameSeries(a: HistoryEntry, b: HistoryEntry): boolean {
	return (
		dayKey(a.createdAt) === dayKey(b.createdAt) &&
		a.direction === b.direction &&
		a.source === b.source &&
		a.messenger === b.messenger
	);
}

export function HistoryList({ history }: { history: HistoryEntry[] }) {
	const containerRef = useRef<HTMLDivElement>(null);
	const stickToBottomRef = useRef(true);
	const prevLengthRef = useRef(0);
	const [showJump, setShowJump] = useState(false);
	const [unseen, setUnseen] = useState(0);

	const scrollToBottom = useCallback((smooth: boolean) => {
		const el = containerRef.current;
		if (!el) return;
		el.scrollTo({
			top: el.scrollHeight,
			behavior: smooth ? "smooth" : "auto",
		});
	}, []);

	useEffect(() => {
		const added = history.length - prevLengthRef.current;
		const firstRender = prevLengthRef.current === 0;
		prevLengthRef.current = history.length;
		if (added <= 0) return;
		if (stickToBottomRef.current) {
			scrollToBottom(!firstRender);
		} else {
			// Менеджер читает историю выше — не дёргаем вниз, а подсказываем кнопкой.
			setUnseen((n) => n + added);
		}
	}, [history.length, scrollToBottom]);

	// Область переписки меняет высоту, когда внизу появляется/сворачивается
	// список отложенных, растёт поле ввода или окно меняет размер — если были
	// у конца ленты, остаёмся у конца, иначе последнее сообщение уезжает под поле.
	const isEmpty = history.length === 0;
	useEffect(() => {
		const el = containerRef.current;
		if (!el || isEmpty) return;
		const observer = new ResizeObserver(() => {
			if (stickToBottomRef.current) scrollToBottom(false);
		});
		observer.observe(el);
		return () => observer.disconnect();
	}, [scrollToBottom, isEmpty]);

	const handleScroll = () => {
		const el = containerRef.current;
		if (!el) return;
		const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
		const atBottom = distance < STICK_TO_BOTTOM_THRESHOLD_PX;
		stickToBottomRef.current = atBottom;
		setShowJump(!atBottom);
		if (atBottom) setUnseen(0);
	};

	if (history.length === 0) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
				<div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
					<MessageSquareTextIcon className="size-6" />
				</div>
				<div className="space-y-1">
					<p className="text-sm font-medium">Переписки пока нет</p>
					<p className="max-w-xs text-sm text-muted-foreground">
						Напишите первым — сообщение уйдёт через выбранный внизу канал.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="relative h-full">
			<div
				ref={containerRef}
				onScroll={handleScroll}
				className="h-full overflow-y-auto overscroll-contain px-4 pt-2 pb-4 sm:px-6"
			>
				<div className="mx-auto flex w-full max-w-4xl flex-col">
					{history.map((item, index) => {
						const prev = history[index - 1];
						const next = history[index + 1];
						const showDay =
							!prev || dayKey(prev.createdAt) !== dayKey(item.createdAt);
						const startsSeries = !prev || !sameSeries(prev, item);
						const endsSeries = !next || !sameSeries(item, next);
						const bubbleKind =
							item.direction === "in"
								? "in"
								: BOT_SOURCES.has(item.source)
									? "bot"
									: "operator";
						const isOut = item.direction === "out";
						const failed = isOut && item.status === "failed";
						const statusMeta =
							isOut && !item.pending ? STATUS_META[item.status] : undefined;
						const StatusIcon = item.pending ? Clock3Icon : statusMeta?.icon;
						const statusLabel = item.pending
							? "отправляется"
							: statusMeta?.label;
						const sourceLabel = SOURCE_LABELS[item.source];

						return (
							<div
								key={item.id}
								className={cn(
									"flex flex-col",
									!showDay && (startsSeries ? "mt-4" : "mt-1"),
								)}
							>
								{showDay && (
									<div className="my-3 flex justify-center">
										<span className="rounded-full border bg-background/90 px-3 py-1 text-xs font-medium text-muted-foreground shadow-xs backdrop-blur">
											{formatDayLabel(item.createdAt)}
										</span>
									</div>
								)}
								{startsSeries && (
									<div
										className={cn(
											"mb-1 flex items-center gap-1.5 px-1 text-xs text-muted-foreground",
											isOut ? "justify-end" : "justify-start",
										)}
									>
										<MessengerIcon
											messenger={item.messenger}
											className="size-3.5 shrink-0"
										/>
										<span>
											{messengerLabel(item.messenger)}
											{sourceLabel ? ` · ${sourceLabel}` : ""}
										</span>
									</div>
								)}
								<div
									className={cn(
										"flex",
										isOut ? "justify-end" : "justify-start",
									)}
								>
									<div
										className={cn(
											"max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-xs sm:max-w-[75%]",
											BUBBLE_STYLES[bubbleKind],
											endsSeries && BUBBLE_TAIL[isOut ? "out" : "in"],
											item.pending && "opacity-70",
											failed && "ring-1 ring-destructive/50",
										)}
									>
										<div className="flex flex-wrap items-end justify-end gap-x-3">
											<span className="min-w-0 flex-1 basis-auto whitespace-pre-wrap [overflow-wrap:anywhere]">
												{item.text}
											</span>
											<span
												className={cn(
													"ml-auto inline-flex shrink-0 translate-y-px items-center gap-1 text-[11px] leading-none tabular-nums opacity-70",
													failed && "text-destructive opacity-100",
												)}
											>
												{formatTime(item.createdAt)}
												{StatusIcon && (
													<span
														role="img"
														title={statusLabel}
														aria-label={statusLabel}
														className={cn(
															"inline-flex items-center gap-0.5",
															statusMeta?.className,
														)}
													>
														<StatusIcon className="size-3.5" />
														{failed && <span>{statusLabel}</span>}
													</span>
												)}
											</span>
										</div>
									</div>
								</div>
							</div>
						);
					})}
				</div>
			</div>

			{showJump && (
				<button
					type="button"
					onClick={() => scrollToBottom(true)}
					className="absolute right-4 bottom-3 z-20 inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-xs font-medium shadow-md transition-colors hover:bg-muted sm:right-6"
				>
					<ArrowDownIcon className="size-3.5" />
					{unseen > 0 ? `Новых: ${unseen}` : "К последним"}
				</button>
			)}
		</div>
	);
}
