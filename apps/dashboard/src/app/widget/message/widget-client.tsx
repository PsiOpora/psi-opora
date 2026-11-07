"use client";

import type {
	ScheduledMessageItem,
	WidgetChannel,
	WidgetEntity,
	WidgetHistoryItem,
	WidgetRecipient,
} from "@psi-opora/api";
import { MESSAGE_MAX_LENGTH } from "@psi-opora/api/schemas";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	CircleAlertIcon,
	InfoIcon,
	Loader2Icon,
	RefreshCwIcon,
	SendIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { useB24Frame } from "@/components/bitrix/frame-provider";
import { ContactAvatar } from "@/components/messaging/contact-avatar";
import {
	type HistoryEntry,
	HistoryList,
	mergeHistory,
} from "@/components/messaging/history-list";
import { MessageComposer } from "@/components/messaging/message-composer";
import { MessengerIcon } from "@/components/messaging/messenger-icon";
import {
	formatScheduledAt,
	SchedulePopover,
} from "@/components/messaging/schedule-popover";
import { ScheduledMessagesList } from "@/components/messaging/scheduled-list";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { orpc, orpcClient } from "@/lib/orpc/client";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 5000;
/** Как часто перечитываем отложенные сообщения: отправленное воркером должно
 * пропасть из списка (оно уже появилось в переписке). */
const SCHEDULED_REFETCH_MS = 15_000;
/** Через сколько снимать надпись «отправляется…», даже если поллинг ещё не
 * подтвердил запись в БД (сама отправка клиенту при этом уже прошла успешно). */
const PENDING_LABEL_TIMEOUT_MS = 8000;

/** Битрикс24 не сообщает приложению высоту области вкладки, а iframe
 * CRM_DEAL_DETAIL_TAB по умолчанию — узкая форма. Поэтому просим высоту «на всё
 * окно»: высота экрана за вычетом шапки портала, заголовка карточки, вкладок и
 * панели браузера. Ширину не трогаем — её уже выделил Битрикс. */
const WIDGET_MIN_HEIGHT_PX = 600;
const WIDGET_MAX_HEIGHT_PX = 1400;
const PORTAL_CHROME_HEIGHT_PX = 320;

function computeWidgetHeight(): number {
	const available = window.screen.availHeight - PORTAL_CHROME_HEIGHT_PX;
	return Math.min(
		WIDGET_MAX_HEIGHT_PX,
		Math.max(WIDGET_MIN_HEIGHT_PX, available),
	);
}

function draftStorageKey(entity: WidgetEntity, entityId: string): string {
	return `psi-opora:widget-draft:${entity}:${entityId}`;
}

/** localStorage может быть недоступен в iframe виджета (Safari ITP и т.п.) —
 * тогда черновик просто не сохраняется, без падения виджета. */
function readDraft(key: string): string {
	try {
		return localStorage.getItem(key) ?? "";
	} catch {
		return "";
	}
}

function writeDraft(key: string, value: string): void {
	try {
		if (value) localStorage.setItem(key, value);
		else localStorage.removeItem(key);
	} catch {
		// недоступно — черновик не сохранится, отправка сообщений при этом не страдает
	}
}

function channelKey(
	channel: Pick<WidgetChannel, "messenger" | "lineId" | "connectorId">,
): string {
	return `${channel.messenger}:${channel.lineId ?? ""}:${channel.connectorId ?? ""}`;
}

/**
 * Канал по умолчанию — тот, через который уже идёт переписка с клиентом:
 * ищем канал последнего сообщения истории (свежие — в конце, см.
 * WidgetRecipient.history), сначала точным совпадением messenger+connectorId
 * (различает несколько личных номеров одного мессенджера), затем только по
 * messenger. Если истории ещё нет (новый контакт) — первый доступный канал.
 */
function pickDefaultChannel(
	channels: WidgetChannel[],
	history: WidgetHistoryItem[],
): WidgetChannel | null {
	for (let i = history.length - 1; i >= 0; i--) {
		const item = history[i];
		if (!item) continue;
		const match =
			channels.find(
				(c) =>
					c.messenger === item.messenger && c.connectorId === item.connectorId,
			) ?? channels.find((c) => c.messenger === item.messenger);
		if (match) return match;
	}
	return channels[0] ?? null;
}

/**
 * Вкладка «Мессенджер» в карточке сделки/контакта: полноразмерная переписка
 * с клиентом (как в едином инбоксе дашборда «Клиенты» или у Wazzup) — шапка
 * с контактом и выбором канала, лента сообщений на всю высоту и поле ввода
 * снизу. Список каналов — динамический (recipient.channels): боты — только
 * если контакт уже писал (поля контакта), личный(е) номер(а) Telegram —
 * всегда, если у контакта есть телефон (можно писать первым, см.
 * packages/tg-userbot).
 */
export function MessageWidget({
	entity,
	entityId,
}: {
	entity: WidgetEntity;
	entityId: string;
}) {
	const { b24 } = useB24Frame();
	const [recipient, setRecipient] = useState<WidgetRecipient | null>(null);
	const [history, setHistory] = useState<HistoryEntry[]>([]);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	const [channel, setChannel] = useState<WidgetChannel | null>(null);
	const [text, setText] = useState("");
	const [sendError, setSendError] = useState<string | null>(null);
	const [sending, startSending] = useTransition();
	const queryClient = useQueryClient();
	const [cancellingScheduledId, setCancellingScheduledId] = useState<
		string | null
	>(null);
	const scheduledQuery = useQuery({
		...orpc.scheduledMessages.listWidget.queryOptions({
			input: { entity, entityId },
		}),
		enabled: Boolean(entityId) && Boolean(recipient),
		refetchInterval: SCHEDULED_REFETCH_MS,
	});
	const scheduledMessages = scheduledQuery.data?.items ?? [];

	// Момент последнего известного сообщения — поллинг запрашивает только то, что новее.
	const sinceRef = useRef(new Date().toISOString());

	// Просим Битрикс выделить вкладке всю доступную высоту (см. computeWidgetHeight) —
	// без этого CRM_DEAL_DETAIL_TAB даёт лишь узкую форму, куда переписка не помещается.
	useEffect(() => {
		if (!b24) return;
		b24.parent
			.resizeWindow(document.documentElement.clientWidth, computeWidgetHeight())
			.catch(() => {
				// Согласно b24jssdk может не сработать при первом открытии — тогда
				// просто останется размер по умолчанию, без падения виджета.
			});
	}, [b24]);

	const load = useCallback(() => {
		if (!entityId) {
			setLoadError("Откройте вкладку из карточки сделки или контакта");
			setLoading(false);
			return;
		}
		setLoading(true);
		setLoadError(null);
		orpcClient.widgetMessage
			.loadRecipient({ entity, id: entityId })
			.then(({ recipient: loaded, error }) => {
				if (error || !loaded) {
					setLoadError(error ?? "Не удалось получить данные");
					return;
				}
				setRecipient(loaded);
				setHistory(loaded.history);
				sinceRef.current =
					loaded.history[loaded.history.length - 1]?.createdAt ??
					new Date().toISOString();
				setChannel(pickDefaultChannel(loaded.channels, loaded.history));
			})
			.catch((err) => setLoadError((err as Error).message))
			.finally(() => setLoading(false));
	}, [entity, entityId]);

	// Токены портала сохраняются BitrixFrameProvider чуть позже первого рендера —
	// при ошибке авторизации менеджер нажмёт «Повторить»
	useEffect(load, [load]);

	// Черновик переживает случайное закрытие/переключение вкладки CRM —
	// восстанавливается один раз на элемент CRM, если поле ещё пустое.
	useEffect(() => {
		if (!entityId) return;
		const saved = readDraft(draftStorageKey(entity, entityId));
		if (saved) setText(saved);
	}, [entity, entityId]);

	useEffect(() => {
		if (!entityId) return;
		writeDraft(draftStorageKey(entity, entityId), text);
	}, [entity, entityId, text]);

	// Поллинг: новые сообщения клиента (и отправленные из других мест — сценарий,
	// напоминание, рассылка) подтягиваются без перезагрузки вкладки. Пока вкладка
	// CRM не в фокусе — не дёргаем Bitrix API, а сразу опрашиваем при возврате.
	useEffect(() => {
		if (!entityId || loading || loadError || !recipient) return;
		if (recipient.channels.length === 0) return;

		const poll = async () => {
			if (document.hidden) return;
			const result = await orpcClient.widgetMessage.poll({
				entity,
				id: entityId,
				sinceIso: sinceRef.current,
			});
			if (!result.messages || result.messages.length === 0) return;
			sinceRef.current =
				result.messages[result.messages.length - 1]?.createdAt ??
				sinceRef.current;
			setHistory((prev) => mergeHistory(prev, result.messages ?? []));
		};

		const interval = setInterval(poll, POLL_INTERVAL_MS);
		const onVisibilityChange = () => {
			if (!document.hidden) poll();
		};
		document.addEventListener("visibilitychange", onVisibilityChange);

		return () => {
			clearInterval(interval);
			document.removeEventListener("visibilitychange", onVisibilityChange);
		};
	}, [entity, entityId, loading, loadError, recipient]);

	const trimmedText = text.trim();
	const overLimit = trimmedText.length > MESSAGE_MAX_LENGTH;

	const send = () => {
		if (!recipient || !channel || !trimmedText || overLimit || sending) return;

		setSendError(null);
		startSending(async () => {
			const result = await orpcClient.widgetMessage.send({
				entity,
				entityId,
				messenger: channel.messenger,
				lineId: channel.lineId,
				connectorId: channel.connectorId,
				text: trimmedText,
			});
			if (result.error) {
				setSendError(result.error);
				return;
			}
			setText("");
			// Показываем сообщение сразу же, не дожидаясь ближайшего поллинга —
			// он позже заменит эту запись подтверждённой (см. mergeHistory).
			const pendingId = `pending-${crypto.randomUUID()}`;
			setHistory((prev) => [
				...prev,
				{
					id: pendingId,
					messenger: channel.messenger,
					direction: "out",
					source: "widget",
					text: trimmedText,
					status: "sent",
					createdAt: new Date().toISOString(),
					pending: true,
				},
			]);
			// Сама отправка клиенту уже прошла успешно — если запись в журнал БД
			// почему-то подвиснет и поллинг её не подтвердит, не держим надпись
			// «отправляется…» вечно (mergeHistory всё равно бесшовно заменит эту
			// запись подтверждённой, когда/если она подтянется позже).
			setTimeout(() => {
				setHistory((prev) =>
					prev.map((item) =>
						item.id === pendingId ? { ...item, pending: false } : item,
					),
				);
			}, PENDING_LABEL_TIMEOUT_MS);
		});
	};

	const refreshScheduled = () =>
		queryClient.invalidateQueries({
			queryKey: orpc.scheduledMessages.listWidget.key(),
		});

	/** Откладывает написанное сообщение; возвращает текст ошибки или null. */
	const scheduleSend = async (sendAt: Date): Promise<string | null> => {
		if (!recipient || !channel) return "Выберите канал отправки";
		if (!trimmedText) return "Введите текст сообщения";
		if (overLimit) return "Сообщение слишком длинное";
		try {
			const result = await orpcClient.scheduledMessages.scheduleWidget({
				entity,
				entityId,
				messenger: channel.messenger,
				lineId: channel.lineId,
				connectorId: channel.connectorId,
				text: trimmedText,
				sendAt: sendAt.toISOString(),
			});
			if (!result.ok) return result.error;
		} catch (err) {
			return (err as Error).message;
		}
		setText("");
		setSendError(null);
		await refreshScheduled();
		toast.success(`Сообщение уйдёт ${formatScheduledAt(sendAt)}`);
		return null;
	};

	const cancelScheduled = async (item: ScheduledMessageItem) => {
		setCancellingScheduledId(item.id);
		try {
			const result = await orpcClient.scheduledMessages.cancel({ id: item.id });
			if (result.ok) {
				toast.success(
					item.status === "failed" ? "Убрано из списка" : "Отправка отменена",
				);
			} else {
				toast.error(result.error ?? "Не удалось отменить отправку");
			}
		} catch {
			toast.error("Не удалось отменить отправку");
		} finally {
			setCancellingScheduledId(null);
			await refreshScheduled();
		}
	};

	const canSend = Boolean(channel) && !sending && !overLimit;
	const composerDisabled = !channel;

	return (
		<div className="flex h-full min-h-0 flex-1 flex-col bg-background">
			{loading ? (
				<WidgetSkeleton />
			) : loadError ? (
				<div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
					<div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
						<CircleAlertIcon className="size-6" />
					</div>
					<div className="space-y-1">
						<p className="text-sm font-medium">Не удалось открыть переписку</p>
						<p className="max-w-sm text-sm text-muted-foreground">
							{loadError}
						</p>
					</div>
					<Button variant="outline" onClick={load}>
						<RefreshCwIcon className="size-4" />
						Повторить
					</Button>
				</div>
			) : recipient ? (
				<>
					<header className="flex items-center gap-3 border-b px-4 py-3 sm:px-6">
						<ContactAvatar name={recipient.contactName} />
						<div className="min-w-0 flex-1">
							<h1 className="truncate text-sm leading-tight font-semibold">
								{recipient.contactName}
							</h1>
							<p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
								{channel ? (
									<>
										<MessengerIcon
											messenger={channel.messenger}
											className="size-3.5 shrink-0"
										/>
										<span className="truncate">
											Ответ уйдёт в {channel.label}
										</span>
									</>
								) : (
									<span>Нет доступных каналов</span>
								)}
							</p>
						</div>
					</header>

					<main className="min-h-0 flex-1 bg-muted/30">
						<HistoryList history={history} />
					</main>

					<footer className="flex flex-col gap-2 bg-muted/30 px-4 pt-1 pb-3 sm:px-6">
						<div className="mx-auto flex w-full max-w-4xl flex-col gap-2">
							{recipient.channels.length === 0 && (
								<div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-900 dark:text-amber-200">
									<InfoIcon className="mt-0.5 size-4 shrink-0" />
									<p>
										{recipient.note ??
											"У контакта не найден Telegram/MAX и нет телефона. Мессенджер появляется в полях контакта, когда клиент пишет нашему боту, либо станут доступны личные номера Telegram/WhatsApp, если указан телефон."}
									</p>
								</div>
							)}
							<ScheduledMessagesList
								items={scheduledMessages}
								onCancel={cancelScheduled}
								cancellingId={cancellingScheduledId}
							/>
							<MessageComposer
								text={text}
								onTextChange={setText}
								onSend={send}
								disabled={composerDisabled}
								error={sendError}
								placeholder={
									composerDisabled
										? "Отправка недоступна — нет канала связи с клиентом"
										: "Напишите сообщение клиенту…"
								}
								header={
									recipient.channels.length > 0 ? (
										<ChannelPicker
											channels={recipient.channels}
											selected={channel}
											onSelect={setChannel}
										/>
									) : null
								}
								actions={
									<>
										<SchedulePopover
											onSchedule={scheduleSend}
											disabled={!canSend || !trimmedText}
										/>
										<Button
											size="lg"
											onClick={send}
											disabled={!canSend || !trimmedText}
											className="px-3.5"
										>
											{sending ? (
												<Loader2Icon className="size-4 animate-spin" />
											) : (
												<SendIcon className="size-4" />
											)}
											Отправить
										</Button>
									</>
								}
							/>
						</div>
					</footer>
				</>
			) : null}
		</div>
	);
}

/** Выбор канала отправки — в самой карточке ввода, рядом с тем, что пишет
 * менеджер: канал определяет, куда реально уйдёт сообщение. */
function ChannelPicker({
	channels,
	selected,
	onSelect,
}: {
	channels: WidgetChannel[];
	selected: WidgetChannel | null;
	onSelect: (channel: WidgetChannel) => void;
}) {
	return (
		<fieldset
			aria-label="Канал отправки"
			className="m-0 flex min-w-0 flex-wrap items-center gap-1.5 border-0 p-0"
		>
			<span className="mr-0.5 text-xs text-muted-foreground">
				Отправить через
			</span>
			{channels.map((c) => {
				const isSelected = selected && channelKey(selected) === channelKey(c);
				return (
					<button
						key={channelKey(c)}
						type="button"
						aria-pressed={Boolean(isSelected)}
						title={`Отправить через ${c.label}`}
						onClick={() => onSelect(c)}
						className={cn(
							"inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
							isSelected
								? "border-primary bg-primary text-primary-foreground"
								: "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
						)}
					>
						<MessengerIcon messenger={c.messenger} className="size-4" />
						{c.label}
					</button>
				);
			})}
		</fieldset>
	);
}

/** Скелет вместо спиннера: шапка, несколько пузырей и поле ввода — экран не
 * «прыгает», когда данные контакта приходят. */
function WidgetSkeleton() {
	return (
		<>
			<div className="flex items-center gap-3 border-b px-4 py-3 sm:px-6">
				<Skeleton className="size-10 rounded-full" />
				<div className="space-y-2">
					<Skeleton className="h-3.5 w-40" />
					<Skeleton className="h-3 w-28" />
				</div>
			</div>
			<div className="flex min-h-0 flex-1 flex-col justify-end gap-3 bg-muted/30 px-4 py-4 sm:px-6">
				<Skeleton className="h-12 w-2/5 rounded-2xl" />
				<Skeleton className="ml-auto h-16 w-1/2 rounded-2xl" />
				<Skeleton className="h-10 w-1/3 rounded-2xl" />
			</div>
			<div className="bg-muted/30 px-4 pb-4 sm:px-6">
				<Skeleton className="h-28 w-full rounded-2xl" />
			</div>
		</>
	);
}
