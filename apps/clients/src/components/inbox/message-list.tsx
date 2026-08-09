"use client";

import type { MessageDeliveryStatus } from "@psi-opora/api";
import {
	BotIcon,
	CheckCheckIcon,
	CheckIcon,
	CircleAlertIcon,
	HeadsetIcon,
	MailCheckIcon,
	PencilIcon,
	Trash2Icon,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { formatDayLabel, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Сообщение треда; pending — оптимистично добавленное до подтверждения
 * поллингом, ещё без серверного status. */
export interface ThreadMessage {
	id: string;
	direction: "in" | "out";
	source: string;
	text: string;
	/** Имя оператора Bitrix, реально написавшего сообщение — показываем вместо
	 * общей подписи «оператор», если известно (см. bot_messages.operator_name). */
	operatorName?: string | null;
	createdAt: string;
	updatedAt?: string;
	editedAt?: string | null;
	deletedAt?: string | null;
	canEdit?: boolean;
	canDelete?: boolean;
	status?: MessageDeliveryStatus;
	pending?: boolean;
	/** "voice" — рендерим плеер вместо текста (см. bot_messages.kind). */
	kind?: "text" | "voice";
	mediaUrl?: string | null;
	/** Только для telegram-personal/whatsapp-personal — с какого из нескольких
	 * личных номеров портала отправлено/получено сообщение. */
	connectorId?: string | null;
	/** Когда гайд-PDF из этого сообщения был продублирован клиенту на email
	 * (см. bot_messages.guide_email_sent_at) — null/undefined, если письмо
	 * сценарием не предусмотрено или не отправилось. */
	guideEmailSentAt?: string | null;
}

/** Доставку/прочтение сейчас отдаёт только WAHA (WhatsApp) — для остальных
 * каналов статус никогда не станет "delivered"/"read", это ограничение
 * внешних API, не баг. */
const STATUS_META: Record<
	MessageDeliveryStatus,
	{ icon: typeof CheckIcon; className?: string; label?: string }
> = {
	sent: { icon: CheckIcon },
	delivered: { icon: CheckCheckIcon },
	read: { icon: CheckCheckIcon, className: "text-sky-500" },
	failed: {
		icon: CircleAlertIcon,
		className: "text-destructive",
		label: "не доставлено",
	},
};

/** Кто фактически отправил исходящее сообщение — определяет цвет пузыря и иконку:
 * бот/автоматика получает один стиль, живой оператор — другой. */
const SOURCE_META: Record<
	string,
	{ label: string; category: "bot" | "operator" }
> = {
	scenario: { label: "бот", category: "bot" },
	reminder: { label: "напоминание", category: "bot" },
	broadcast: { label: "рассылка", category: "bot" },
	widget: { label: "оператор", category: "operator" },
	operator: { label: "оператор", category: "operator" },
};

const DEFAULT_SOURCE_META = { label: null, category: "operator" as const };

/** Заглушка текста голосового без подписи — та же строка, что кладут боты в
 * bot_messages.text (packages/bot-core/src/bot.ts, apps/max-bot/src/bot.ts,
 * apps/bitrix-webhook/src/server.ts). Нужна, чтобы не дублировать её под
 * плеером — сам факт "voice" уже понятен по иконке плеера. */
const VOICE_PLACEHOLDER_TEXT = "Голосовое сообщение";

const BUBBLE_STYLES = {
	in: "self-start rounded-bl-md border bg-message-client text-message-client-foreground border-message-client-border",
	bot: "self-end rounded-br-md bg-message-bot text-message-bot-foreground",
	operator:
		"self-end rounded-br-md bg-message-operator text-message-operator-foreground",
};

/** Насколько близко к низу нужно быть, чтобы новое сообщение автоскроллило —
 * иначе менеджера, читающего историю выше, не «дёрнет» вниз поллингом. */
const STICK_TO_BOTTOM_THRESHOLD_PX = 60;

/** Вливает сообщения с поллинга в локальную историю: уже известный id —
 * обновляет запись на месте (так долетают статусные апдейты sent → delivered
 * → read у уже показанных сообщений, см. listBotMessagesSince/updatedAt),
 * совпадающее оптимистичное сообщение — заменяет подтверждённой записью
 * (чтобы не задваивать только что отправленное), остальное — добавляет. */
export function mergeThread(
	prev: ThreadMessage[],
	incoming: ThreadMessage[],
): ThreadMessage[] {
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

export function MessageList({
	messages,
	connectorLabels,
	onEdit,
	onDelete,
}: {
	messages: ThreadMessage[];
	/** connectorId → номер телефона (только подключённые сейчас номера —
	 * для отключённого исторический connectorId просто не найдётся, тег не
	 * покажем, чем гадать по неактуальным данным). */
	connectorLabels?: Record<string, string>;
	onEdit?: (message: ThreadMessage) => void;
	onDelete?: (message: ThreadMessage) => void;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const stickToBottomRef = useRef(true);

	useEffect(() => {
		const el = containerRef.current;
		if (el && stickToBottomRef.current && messages.length > 0) {
			el.scrollTop = el.scrollHeight;
		}
	}, [messages.length]);

	const handleScroll = () => {
		const el = containerRef.current;
		if (!el) return;
		stickToBottomRef.current =
			el.scrollHeight - el.scrollTop - el.clientHeight <
			STICK_TO_BOTTOM_THRESHOLD_PX;
	};

	return (
		<div
			ref={containerRef}
			onScroll={handleScroll}
			className="flex h-full flex-col overflow-y-auto px-4 py-3"
		>
			{messages.map((item, index) => {
				const prev = messages[index - 1];
				const showDay =
					!prev || dayKey(prev.createdAt) !== dayKey(item.createdAt);
				const meta =
					item.direction === "out"
						? (SOURCE_META[item.source] ?? DEFAULT_SOURCE_META)
						: null;
				// Для живого оператора конкретное имя (кто из Bitrix написал)
				// важнее общей подписи "оператор".
				const metaLabel =
					meta?.category === "operator" && item.operatorName
						? item.operatorName
						: meta?.label;
				const groupedWithPrev =
					!showDay &&
					!!prev &&
					prev.direction === item.direction &&
					prev.source === item.source;
				const Icon = meta?.category === "bot" ? BotIcon : HeadsetIcon;
				const statusMeta =
					item.direction === "out" && !item.pending && item.status
						? STATUS_META[item.status]
						: null;
				const StatusIcon = statusMeta?.icon;
				const phoneLabel = item.connectorId
					? connectorLabels?.[item.connectorId]
					: undefined;

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
								"group/message relative max-w-[70%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap shadow-sm",
								BUBBLE_STYLES[
									item.direction === "in"
										? "in"
										: (meta?.category ?? "operator")
								],
								item.pending && "opacity-60",
								item.deletedAt && "italic opacity-70",
							)}
						>
							{(item.canEdit || item.canDelete) && (
								<div className="absolute top-1/2 -left-8 flex -translate-y-1/2 flex-col">
									{item.canEdit && onEdit && (
										<button
											type="button"
											onClick={() => onEdit(item)}
											className="flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-60 transition-opacity hover:bg-muted hover:text-foreground hover:opacity-100 focus:opacity-100"
											title="Редактировать сообщение"
											aria-label="Редактировать сообщение"
										>
											<PencilIcon className="size-3.5" />
										</button>
									)}
									{item.canDelete && onDelete && (
										<button
											type="button"
											onClick={() => onDelete(item)}
											className="flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-60 transition-opacity hover:bg-destructive/10 hover:text-destructive hover:opacity-100 focus:opacity-100"
											title="Удалить сообщение у клиента"
											aria-label="Удалить сообщение у клиента"
										>
											<Trash2Icon className="size-3.5" />
										</button>
									)}
								</div>
							)}
							{item.kind === "voice" && item.mediaUrl ? (
								<>
									{/* biome-ignore lint/a11y/useMediaCaption: голосовое сообщение клиента, субтитров нет */}
									<audio
										controls
										preload="none"
										src={item.mediaUrl}
										className="max-w-full"
									/>
									{item.text && item.text !== VOICE_PLACEHOLDER_TEXT && (
										<p className="mt-1.5">{item.text}</p>
									)}
								</>
							) : (
								item.text
							)}
							<div
								className={cn(
									"mt-1 flex items-center gap-1 text-[10px] opacity-70",
									item.direction === "out" ? "justify-end" : "",
								)}
							>
								{metaLabel && (
									<>
										<Icon className="size-3" />
										<span>{metaLabel}</span>
										<span>·</span>
									</>
								)}
								<span>{formatTime(item.createdAt)}</span>
								{item.editedAt && (
									<>
										<span>·</span>
										<span>изменено</span>
									</>
								)}
								{item.deletedAt && (
									<>
										<span>·</span>
										<span>удалено</span>
									</>
								)}
								{phoneLabel && (
									<>
										<span>·</span>
										<span>{phoneLabel}</span>
									</>
								)}
								{item.guideEmailSentAt && (
									<>
										<span>·</span>
										<span
											className="flex items-center gap-0.5"
											title={`Гайд продублирован на email: ${formatTime(item.guideEmailSentAt)}`}
										>
											<MailCheckIcon className="size-3" />
											гайд отправлен на почту
										</span>
									</>
								)}
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
				);
			})}
		</div>
	);
}
