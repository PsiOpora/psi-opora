"use client";

import type {
	WidgetChannel,
	WidgetEntity,
	WidgetHistoryItem,
	WidgetRecipient,
} from "@psi-opora/api";
import { MESSAGE_MAX_LENGTH } from "@psi-opora/api/schemas";
import { Loader2Icon, SendIcon, TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useB24Frame } from "@/components/bitrix/frame-provider";
import { ChannelChip } from "@/components/messaging/channel-chip";
import { ChannelPicker } from "@/components/messaging/channel-picker";
import { ContactAvatar } from "@/components/messaging/contact-avatar";
import {
	type HistoryEntry,
	HistoryList,
	mergeHistory,
} from "@/components/messaging/history-list";
import { MessageComposer } from "@/components/messaging/message-composer";
import {
	conversationKey,
	messengerMeta,
	summarizeChannelActivity,
} from "@/components/messaging/messenger-meta";
import { Button } from "@/components/ui/button";
import { orpcClient } from "@/lib/orpc/client";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 5000;
/** Через сколько снимать надпись «отправляется…», даже если поллинг ещё не
 * подтвердил запись в БД (сама отправка клиенту при этом уже прошла успешно). */
const PENDING_LABEL_TIMEOUT_MS = 8000;

/** Целевая высота вкладки в портале — как у полноразмерного окна мессенджера
 * (Wazzup и т.п.), а не узкой формы на пол-экрана. Ширину не трогаем, чтобы
 * не спорить с шириной, которую уже выделил Битрикс под область вкладки. */
const WIDGET_TARGET_HEIGHT_PX = 640;

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

	// Момент последнего известного сообщения — поллинг запрашивает только то, что новее.
	const sinceRef = useRef(new Date().toISOString());

	// Просим Битрикс выделить вкладке высоту полноценного окна мессенджера —
	// без этого CRM_DEAL_DETAIL_TAB даёт лишь узкую форму, куда переписка не
	// помещается. Ширину не запрашиваем явно — берём текущую, чтобы не
	// спорить с раскладкой самой карточки сделки.
	useEffect(() => {
		if (!b24) return;
		b24.parent
			.resizeWindow(
				document.documentElement.clientWidth,
				WIDGET_TARGET_HEIGHT_PX,
			)
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

	const activity = summarizeChannelActivity(recipient?.channels ?? [], history);
	const participants = (recipient?.channels ?? []).filter(
		(c) => activity.get(conversationKey(c.messenger, c.connectorId))?.lastAt,
	);
	const selectedMeta = channel ? messengerMeta(channel.messenger) : undefined;
	// Клиент в последний раз писал не в тот канал, в который сейчас уйдёт ответ.
	const lastInbound = [...history].reverse().find((h) => h.direction === "in");
	const lastInboundChannel = lastInbound
		? recipient?.channels.find(
				(c) =>
					conversationKey(c.messenger, c.connectorId) ===
					conversationKey(lastInbound.messenger, lastInbound.connectorId),
			)
		: undefined;
	const replyElsewhere =
		channel &&
		lastInboundChannel &&
		conversationKey(channel.messenger, channel.connectorId) !==
			conversationKey(
				lastInboundChannel.messenger,
				lastInboundChannel.connectorId,
			)
			? {
					channel: lastInboundChannel,
					name:
						messengerMeta(lastInboundChannel.messenger)?.name ??
						"другом канале",
				}
			: null;

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
					connectorId: channel.connectorId,
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

	return (
		<div className="flex h-full min-h-0 flex-1 flex-col">
			{loading ? (
				<div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
					<Loader2Icon className="size-4 animate-spin" />
					Загружаем данные контакта…
				</div>
			) : loadError ? (
				<div className="flex flex-1 flex-col items-center justify-center gap-3 p-4">
					<p className="text-sm text-destructive">{loadError}</p>
					<Button variant="outline" size="sm" onClick={load}>
						Повторить
					</Button>
				</div>
			) : recipient ? (
				<>
					<div className="flex items-center gap-3 border-b px-4 py-3">
						<ContactAvatar name={recipient.contactName} />
						<div className="min-w-0 flex-1">
							<p className="truncate text-sm font-semibold">
								{recipient.contactName}
							</p>
							{participants.length > 0 ? (
								<div className="mt-1 flex flex-wrap items-center gap-1.5">
									<span className="text-xs text-muted-foreground">
										Переписка идёт в:
									</span>
									{participants.map((c) => (
										<ChannelChip
											key={conversationKey(c.messenger, c.connectorId)}
											messenger={c.messenger}
											accountPhone={c.accountPhone}
										/>
									))}
								</div>
							) : (
								<p className="truncate text-xs text-muted-foreground">
									Переписки пока нет
								</p>
							)}
						</div>
					</div>

					<div className="min-h-0 flex-1 bg-muted/10">
						<HistoryList history={history} channels={recipient.channels} />
					</div>

					{recipient.channels.length === 0 && (
						<div className="border-t bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
							{recipient.note ??
								"У контакта не найден Telegram/MAX и нет телефона. Мессенджер появляется в полях контакта, когда клиент пишет нашему боту, либо станут доступны личные номера Telegram/WhatsApp, если указан телефон."}
						</div>
					)}

					<div
						className={cn(
							"border-t-2 p-3",
							selectedMeta?.accent.edge ?? "border-t-border",
						)}
					>
						{recipient.channels.length > 0 && (
							<ChannelPicker
								channels={recipient.channels}
								selected={channel}
								activity={activity}
								onSelect={setChannel}
							/>
						)}
						{replyElsewhere && (
							<p className="mb-2 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
								<TriangleAlertIcon className="size-3.5 shrink-0 text-amber-600" />
								Клиент последний раз писал в {replyElsewhere.name}, а ответ
								уйдёт в {selectedMeta?.name}.
								<button
									type="button"
									onClick={() => setChannel(replyElsewhere.channel)}
									className="font-medium text-foreground underline underline-offset-2 hover:no-underline"
								>
									Ответить в {replyElsewhere.name}
								</button>
							</p>
						)}
						<MessageComposer
							text={text}
							onTextChange={setText}
							onSend={send}
							placeholder="Здравствуйте! Это Психологический центр «Опора»… (Enter — отправить, Shift+Enter — новая строка)"
						/>
						<div className="mt-1.5 flex items-center justify-between gap-2">
							{sendError && (
								<p className="text-sm text-destructive">{sendError}</p>
							)}
							<Button
								onClick={send}
								disabled={sending || !trimmedText || !channel || overLimit}
								className="ml-auto"
							>
								{sending ? (
									<Loader2Icon className="size-4 animate-spin" />
								) : (
									<SendIcon className="size-4" />
								)}
								{selectedMeta
									? `Отправить в ${selectedMeta.name}`
									: "Отправить"}
							</Button>
						</div>
					</div>
				</>
			) : null}
		</div>
	);
}
