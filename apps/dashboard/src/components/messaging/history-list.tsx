"use client";

import type { WidgetHistoryItem } from "@psi-opora/api";
import {
	ArrowDownIcon,
	CheckCheckIcon,
	CheckIcon,
	CircleAlertIcon,
	Clock3Icon,
	DownloadIcon,
	FileIcon,
	Loader2Icon,
	MessageSquareTextIcon,
	QuoteIcon,
	RotateCcwIcon,
} from "lucide-react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { MessengerIcon } from "@/components/messaging/messenger-icon";
import { messengerLabel } from "@/components/messaging/messenger-meta";
import { RichText } from "@/components/messaging/rich-text";
import { Button } from "@/components/ui/button";
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
/** Ближе к верху — подгружаем более старые сообщения. */
const LOAD_MORE_THRESHOLD_PX = 120;
/** Сообщения без подписи хранятся с текстом-заглушкой — под вложением его не дублируем. */
const MEDIA_PLACEHOLDERS = new Set(["Фото", "Файл", "Голосовое сообщение", ""]);

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

/** Добавляет в начало более старую страницу истории, пропуская уже известные id. */
export function prependHistory(
	prev: HistoryEntry[],
	older: WidgetHistoryItem[],
): HistoryEntry[] {
	const known = new Set(prev.map((item) => item.id));
	const fresh = older.filter((item) => !known.has(item.id));
	return fresh.length === 0 ? prev : [...fresh, ...prev];
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
		a.messenger === b.messenger &&
		(a.operatorName ?? null) === (b.operatorName ?? null)
	);
}

function MessageMedia({ item }: { item: HistoryEntry }) {
	if (!item.mediaUrl) {
		// Файл удалён или ещё не сохранён — оставляем хотя бы подпись.
		return item.kind !== "text" ? (
			<p className="mb-1 flex items-center gap-1.5 text-xs opacity-70">
				<FileIcon className="size-3.5" />
				{item.mediaFileName ?? "Вложение недоступно"}
			</p>
		) : null;
	}
	if (item.kind === "image") {
		return (
			<a
				href={item.mediaUrl}
				target="_blank"
				rel="noopener noreferrer"
				className="mb-1 block"
			>
				{/* biome-ignore lint/performance/noImgElement: подписанная внешняя ссылка, next/image не нужен */}
				<img
					src={item.mediaUrl}
					alt={item.mediaFileName ?? "Изображение"}
					loading="lazy"
					className="max-h-72 max-w-full rounded-lg object-cover"
				/>
			</a>
		);
	}
	if (item.kind === "voice") {
		return (
			// biome-ignore lint/a11y/useMediaCaption: голосовое сообщение, субтитров нет
			<audio
				controls
				preload="none"
				src={item.mediaUrl}
				className="mb-1 h-9 w-60 max-w-full"
			/>
		);
	}
	return (
		<a
			href={item.mediaUrl}
			target="_blank"
			rel="noopener noreferrer"
			download={item.mediaFileName ?? undefined}
			className="mb-1 flex items-center gap-2 rounded-lg bg-foreground/5 px-2.5 py-2 text-xs transition-colors hover:bg-foreground/10"
		>
			<FileIcon className="size-4 shrink-0" />
			<span className="min-w-0 flex-1 truncate font-medium">
				{item.mediaFileName ?? "Файл"}
			</span>
			<DownloadIcon className="size-3.5 shrink-0 opacity-70" />
		</a>
	);
}

export interface HistoryListProps {
	history: HistoryEntry[];
	/** Есть ли в журнале сообщения старше загруженных. */
	hasMore?: boolean;
	loadingMore?: boolean;
	onLoadMore?: () => void;
	/** Повторить отправку неудавшегося текстового сообщения. */
	onRetry?: (item: HistoryEntry) => void;
	/** id неудавшихся сообщений, уже отправленных повторно. */
	retriedIds?: ReadonlySet<string>;
	/** Процитировать сообщение в поле ввода. */
	onQuote?: (item: HistoryEntry) => void;
	/** id первого непрочитанного входящего — над ним рисуется разделитель. */
	unreadFromId?: string | null;
	/** Прокрутить к сообщению и подсветить (nonce позволяет повторить тот же id). */
	focusRequest?: { id: string; nonce: number } | null;
}

export function HistoryList({
	history,
	hasMore,
	loadingMore,
	onLoadMore,
	onRetry,
	retriedIds,
	onQuote,
	unreadFromId,
	focusRequest,
}: HistoryListProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	const stickToBottomRef = useRef(true);
	// true, пока идёт плавная прокрутка кнопкой «К последним»: промежуточные
	// события scroll не должны считаться уходом читать историю выше
	const smoothScrollingRef = useRef(false);
	const lastIdRef = useRef<string | null>(null);
	const firstIdRef = useRef<string | null>(null);
	// Положение до подгрузки старых сообщений — чтобы после вставки сверху
	// остаться на том же сообщении, а не улететь к началу.
	const prependAnchorRef = useRef<{ height: number; top: number } | null>(null);
	const [showJump, setShowJump] = useState(false);
	const [unseen, setUnseen] = useState(0);
	const [highlightId, setHighlightId] = useState<string | null>(null);

	const scrollToBottom = useCallback((smooth: boolean) => {
		const el = containerRef.current;
		if (!el) return;
		stickToBottomRef.current = true;
		smoothScrollingRef.current = smooth;
		el.scrollTo({
			top: el.scrollHeight,
			behavior: smooth ? "smooth" : "auto",
		});
	}, []);

	// useLayoutEffect — прокрутка до отрисовки, без мерцания первой загрузки
	useLayoutEffect(() => {
		const el = containerRef.current;
		const firstId = history[0]?.id ?? null;
		const lastId = history[history.length - 1]?.id ?? null;

		if (
			el &&
			prependAnchorRef.current &&
			firstId !== firstIdRef.current &&
			lastId === lastIdRef.current
		) {
			el.scrollTop =
				prependAnchorRef.current.top +
				(el.scrollHeight - prependAnchorRef.current.height);
			prependAnchorRef.current = null;
		}
		firstIdRef.current = firstId;

		if (lastId === lastIdRef.current) return;
		const prevLastId = lastIdRef.current;
		lastIdRef.current = lastId;
		if (!lastId) return;

		const prevIdx = prevLastId
			? history.findIndex((item) => item.id === prevLastId)
			: -1;
		const added =
			prevLastId === null
				? history.length
				: prevIdx === -1
					? 1
					: history.length - 1 - prevIdx;
		if (added <= 0) return;

		const newest = history[history.length - 1];
		// Своё сообщение оператор всегда видит сразу, независимо от прокрутки.
		if (stickToBottomRef.current || newest?.direction === "out") {
			// мгновенно: плавная анимация конфликтует с приходом следующего сообщения
			scrollToBottom(false);
		} else {
			// Менеджер читает историю выше — не дёргаем вниз, а подсказываем кнопкой.
			setUnseen((n) => n + added);
		}
	}, [history, scrollToBottom]);

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
		// Содержимое растёт и без смены размера контейнера — например, когда
		// догружаются картинки: остаёмся у конца ленты и тогда.
		if (contentRef.current) observer.observe(contentRef.current);
		return () => observer.disconnect();
	}, [scrollToBottom, isEmpty]);

	const loadMore = useCallback(() => {
		const el = containerRef.current;
		if (!el || !onLoadMore || loadingMore || !hasMore) return;
		prependAnchorRef.current = { height: el.scrollHeight, top: el.scrollTop };
		onLoadMore();
	}, [onLoadMore, loadingMore, hasMore]);

	// Короткая история не заполняет экран — подгружать по прокрутке нечем,
	// поэтому докачиваем сами, пока лента не станет прокручиваемой.
	useEffect(() => {
		const el = containerRef.current;
		if (!el || isEmpty || !hasMore || loadingMore) return;
		if (el.scrollHeight <= el.clientHeight + LOAD_MORE_THRESHOLD_PX) loadMore();
	}, [isEmpty, hasMore, loadingMore, loadMore]);

	// Переход к найденному сообщению (поиск по переписке)
	useEffect(() => {
		if (!focusRequest) return;
		const el = containerRef.current?.querySelector(
			`[data-msg-id="${CSS.escape(focusRequest.id)}"]`,
		);
		if (!el) return;
		el.scrollIntoView({ block: "center", behavior: "smooth" });
		setHighlightId(focusRequest.id);
		const timer = setTimeout(() => setHighlightId(null), 2200);
		return () => clearTimeout(timer);
	}, [focusRequest]);

	const handleScroll = () => {
		const el = containerRef.current;
		if (!el) return;
		const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
		const atBottom = distance < STICK_TO_BOTTOM_THRESHOLD_PX;
		if (el.scrollTop < LOAD_MORE_THRESHOLD_PX) loadMore();
		if (smoothScrollingRef.current) {
			if (!atBottom) return;
			smoothScrollingRef.current = false;
		}
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
				onWheel={() => {
					smoothScrollingRef.current = false;
				}}
				onTouchStart={() => {
					smoothScrollingRef.current = false;
				}}
				className="h-full overflow-y-auto overscroll-contain px-4 pt-2 pb-4 sm:px-6"
			>
				<div
					ref={contentRef}
					className="mx-auto flex w-full max-w-4xl flex-col"
				>
					{(hasMore || loadingMore) && (
						<div className="flex justify-center py-2">
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={loadingMore}
								onClick={loadMore}
							>
								{loadingMore && <Loader2Icon className="animate-spin" />}
								{loadingMore ? "Загружаем…" : "Показать более ранние сообщения"}
							</Button>
						</div>
					)}
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
						const authorLabel =
							isOut && !BOT_SOURCES.has(item.source) && item.operatorName
								? item.operatorName
								: sourceLabel;
						const showText =
							item.kind === "text" || !MEDIA_PLACEHOLDERS.has(item.text);
						const canRetry =
							failed &&
							item.kind === "text" &&
							!item.id.startsWith("pending-") &&
							Boolean(onRetry);
						const retried = retriedIds?.has(item.id) ?? false;

						return (
							<div
								key={item.id}
								data-msg-id={item.id}
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
								{unreadFromId === item.id && (
									<div className="my-3 flex items-center gap-3 text-xs font-medium text-primary">
										<div className="h-px flex-1 bg-primary/30" />
										Новые сообщения
										<div className="h-px flex-1 bg-primary/30" />
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
											{authorLabel ? ` · ${authorLabel}` : ""}
										</span>
									</div>
								)}
								<div
									className={cn(
										"group flex items-center gap-1.5",
										isOut ? "flex-row-reverse justify-start" : "justify-start",
									)}
								>
									<div
										className={cn(
											"max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-xs transition-shadow sm:max-w-[75%]",
											BUBBLE_STYLES[bubbleKind],
											endsSeries && BUBBLE_TAIL[isOut ? "out" : "in"],
											item.pending && "opacity-70",
											failed && "ring-1 ring-destructive/50",
											highlightId === item.id && "ring-2 ring-primary",
										)}
									>
										<MessageMedia item={item} />
										<div className="flex flex-wrap items-end justify-end gap-x-3">
											{showText && (
												<span className="min-w-0 flex-1 basis-auto whitespace-pre-wrap [overflow-wrap:anywhere]">
													<RichText
														text={item.text}
														markup={isOut && item.kind === "text"}
													/>
												</span>
											)}
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
										{canRetry && (
											<div className="mt-1.5 flex justify-end">
												{retried ? (
													<span className="text-[11px] text-muted-foreground">
														Отправлено повторно
													</span>
												) : (
													<Button
														type="button"
														variant="outline"
														size="xs"
														onClick={() => onRetry?.(item)}
													>
														<RotateCcwIcon />
														Повторить отправку
													</Button>
												)}
											</div>
										)}
									</div>
									{onQuote && item.kind === "text" && !item.pending && (
										<Button
											type="button"
											variant="ghost"
											size="icon-xs"
											title="Процитировать в ответе"
											aria-label="Процитировать в ответе"
											className="shrink-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
											onClick={() => onQuote(item)}
										>
											<QuoteIcon />
										</Button>
									)}
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
