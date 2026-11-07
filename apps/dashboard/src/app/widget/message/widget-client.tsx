"use client";

import type {
	ScheduledMessageItem,
	UploadedAttachment,
	WidgetChannel,
	WidgetEntity,
	WidgetHistoryItem,
	WidgetRecipient,
} from "@psi-opora/api";
import { MESSAGE_MAX_LENGTH } from "@psi-opora/api/schemas";
import { Text } from "@bitrix24/b24jssdk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	BellIcon,
	BellOffIcon,
	CircleAlertIcon,
	InfoIcon,
	Loader2Icon,
	RefreshCwIcon,
	SendIcon,
} from "lucide-react";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useTransition,
} from "react";
import { toast } from "sonner";
import { useB24Frame } from "@/components/bitrix/frame-provider";
import {
	AttachmentPreview,
	type PendingAttachment,
} from "@/components/messaging/attachment-preview";
import { ContactAvatar } from "@/components/messaging/contact-avatar";
import {
	type HistoryEntry,
	HistoryList,
	mergeHistory,
	prependHistory,
} from "@/components/messaging/history-list";
import { MessageComposer } from "@/components/messaging/message-composer";
import { MessengerIcon } from "@/components/messaging/messenger-icon";
import {
	type CurrentOperator,
	NotesPopover,
} from "@/components/messaging/notes-popover";
import {
	formatScheduledAt,
	SchedulePopover,
} from "@/components/messaging/schedule-popover";
import { ScheduledMessagesList } from "@/components/messaging/scheduled-list";
import { SearchPopover } from "@/components/messaging/search-popover";
import { applyTemplateVariables } from "@/components/messaging/template-variables";
import {
	type TemplateItem,
	TemplatesPopover,
} from "@/components/messaging/templates-popover";
import { Button } from "@/components/ui/button";
import { orpc, orpcClient } from "@/lib/orpc/client";
import {
	channelKey,
	computeWidgetHeight,
	draftStorageKey,
	findChannelForMessage,
	pickDefaultChannel,
	playIncomingSound,
	readSoundEnabled,
	readStored,
	uploadAttachment,
	writeSoundEnabled,
	writeStored,
} from "./widget-helpers";
import {
	ChannelMismatchWarning,
	ChannelPicker,
	WidgetSkeleton,
} from "./widget-parts";

const POLL_INTERVAL_MS = 5000;
/** Как часто перечитываем отложенные сообщения: отправленное воркером должно
 * пропасть из списка (оно уже появилось в переписке). */
const SCHEDULED_REFETCH_MS = 15_000;
/** Через сколько снимать надпись «отправляется…», даже если поллинг ещё не
 * подтвердил запись в БД (сама отправка клиенту при этом уже прошла успешно). */
const PENDING_LABEL_TIMEOUT_MS = 8000;
/** Предупреждение о смене канала не показываем, если клиент писал давно. */
const MISMATCH_WARNING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Сколько страниц истории дозагружаем ради перехода к найденному сообщению. */
const MAX_JUMP_PAGES = 40;
const QUOTE_MAX_LENGTH = 160;

/**
 * Вкладка «Мессенджер» в карточке сделки/контакта: полноразмерная переписка
 * с клиентом (как в едином инбоксе дашборда «Клиенты» или у Wazzup) — шапка
 * с контактом, поиском и заметками, лента сообщений на всю высоту и поле
 * ввода с выбором канала, шаблонами и вложениями. Список каналов —
 * динамический (recipient.channels): боты — только если контакт уже писал
 * (поля контакта), личный(е) номер(а) Telegram — всегда, если у контакта есть
 * телефон (можно писать первым, см. packages/tg-userbot).
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
	const [hasMore, setHasMore] = useState(false);
	const [loadingMore, setLoadingMore] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	const [channel, setChannel] = useState<WidgetChannel | null>(null);
	const [text, setText] = useState("");
	const [attachment, setAttachment] = useState<PendingAttachment | null>(null);
	const [uploaded, setUploaded] = useState<UploadedAttachment | null>(null);
	const uploadAbortRef = useRef<AbortController | null>(null);
	const [sendError, setSendError] = useState<string | null>(null);
	const [sending, startSending] = useTransition();
	const [retriedIds, setRetriedIds] = useState<ReadonlySet<string>>(new Set());
	const [operator, setOperator] = useState<CurrentOperator | null>(null);
	const [soundOn, setSoundOn] = useState(true);
	const [unreadFromId, setUnreadFromId] = useState<string | null>(null);
	const [focusRequest, setFocusRequest] = useState<{
		id: string;
		nonce: number;
	} | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
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

	const templatesQuery = useQuery(orpc.messages.quickReplies.queryOptions());
	const templates: TemplateItem[] = templatesQuery.data?.items ?? [];

	// Актуальные история и признак «есть ещё» нужны асинхронным функциям
	// (поллинг, переход к найденному сообщению) без пересоздания замыканий.
	const historyRef = useRef<HistoryEntry[]>([]);
	historyRef.current = history;
	const hasMoreRef = useRef(false);
	hasMoreRef.current = hasMore;

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

	// Текущий оператор — для подписи исходящих и заметок (как в инбоксе «Клиенты»).
	useEffect(() => {
		if (!b24) return;
		b24.actions.v2.call
			.make({
				method: "user.current",
				params: {},
				requestId: Text.getUuidRfc4122(),
			})
			.then((res) => {
				if (!res.isSuccess) return;
				const data = (
					res.getData() as
						| { result?: { ID?: string; NAME?: string; LAST_NAME?: string } }
						| undefined
				)?.result;
				if (!data?.ID) return;
				setOperator({
					id: data.ID,
					name:
						[data.NAME, data.LAST_NAME].filter(Boolean).join(" ") ||
						`#${data.ID}`,
				});
			})
			.catch(() => {
				// не критично — сообщения просто уйдут без имени оператора
			});
	}, [b24]);

	useEffect(() => {
		setSoundOn(readSoundEnabled());
	}, []);

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
				setHasMore(loaded.hasMoreHistory);
				sinceRef.current =
					loaded.history[loaded.history.length - 1]?.createdAt ??
					new Date().toISOString();
				setChannel(pickDefaultChannel(loaded.channels, loaded.history));
				// Открытая вкладка = переписка просмотрена: гасим бейдж в инбоксе.
				if (loaded.channels.length > 0) {
					orpcClient.widgetMessage
						.markRead({ entity, id: entityId })
						.catch(() => {});
				}
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
		const saved = readStored(draftStorageKey(entity, entityId));
		if (saved) setText(saved);
	}, [entity, entityId]);

	useEffect(() => {
		if (!entityId) return;
		writeStored(draftStorageKey(entity, entityId), text);
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
			const messages = result.messages;
			if (!messages || messages.length === 0) return;
			sinceRef.current =
				messages[messages.length - 1]?.createdAt ?? sinceRef.current;

			// Новые входящие: звук и разделитель «Новые сообщения», если оператор
			// сейчас смотрит не в эту вкладку (фокус в другой части карточки CRM).
			const known = new Set(historyRef.current.map((item) => item.id));
			const freshIncoming = messages.filter(
				(m) => m.direction === "in" && !known.has(m.id),
			);
			if (freshIncoming.length > 0) {
				if (readSoundEnabled()) playIncomingSound();
				if (!document.hasFocus()) {
					setUnreadFromId((current) => current ?? freshIncoming[0]?.id ?? null);
				} else {
					orpcClient.widgetMessage
						.markRead({ entity, id: entityId })
						.catch(() => {});
				}
			}
			setHistory((prev) => mergeHistory(prev, messages));
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

	// Оператор вернулся во вкладку — прочитал: сбрасываем счётчик в инбоксе, а
	// разделитель «Новые сообщения» оставляем ещё ненадолго, чтобы успеть увидеть.
	useEffect(() => {
		if (!entityId || !recipient || recipient.channels.length === 0) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const onFocus = () => {
			orpcClient.widgetMessage
				.markRead({ entity, id: entityId })
				.catch(() => {});
			timer = setTimeout(() => setUnreadFromId(null), 6000);
		};
		window.addEventListener("focus", onFocus);
		return () => {
			window.removeEventListener("focus", onFocus);
			if (timer) clearTimeout(timer);
		};
	}, [entity, entityId, recipient]);

	const trimmedText = text.trim();
	const overLimit = trimmedText.length > MESSAGE_MAX_LENGTH;
	const attachmentReady = attachment?.status === "ready" && uploaded;
	const attachmentBlocked = attachment?.status === "uploading";
	const hasPayload = Boolean(trimmedText) || Boolean(attachmentReady);
	const attachmentUnsupported =
		Boolean(attachment) && channel?.messenger === "max-personal";
	const canSend =
		Boolean(channel) &&
		!sending &&
		!overLimit &&
		hasPayload &&
		!attachmentBlocked &&
		!attachmentUnsupported;

	const clearAttachment = useCallback(() => {
		uploadAbortRef.current?.abort();
		uploadAbortRef.current = null;
		setAttachment(null);
		setUploaded(null);
	}, []);

	const pickFile = useCallback((file: File) => {
		uploadAbortRef.current?.abort();
		const controller = new AbortController();
		uploadAbortRef.current = controller;
		setUploaded(null);
		setAttachment({ file, status: "uploading" });
		setSendError(null);
		uploadAttachment(file, controller.signal)
			.then((result) => {
				if (controller.signal.aborted) return;
				setUploaded(result);
				setAttachment({ file, status: "ready" });
			})
			.catch((err) => {
				if (controller.signal.aborted) return;
				setAttachment({
					file,
					status: "error",
					error: (err as Error).message,
				});
			});
	}, []);

	/** Отправляет сообщение выбранным каналом и добавляет его в ленту сразу, не
	 * дожидаясь поллинга: он позже заменит эту запись подтверждённой (mergeHistory).
	 * Возвращает true при успехе. */
	const dispatchMessage = async (params: {
		channel: WidgetChannel;
		text: string;
		attachment?: UploadedAttachment;
	}): Promise<boolean> => {
		const result = await orpcClient.widgetMessage.send({
			entity,
			entityId,
			messenger: params.channel.messenger,
			lineId: params.channel.lineId,
			connectorId: params.channel.connectorId,
			text: params.text,
			attachment: params.attachment,
			operatorName: operator?.name,
		});
		if (result.error) {
			setSendError(result.error);
			return false;
		}
		const pendingId = `pending-${crypto.randomUUID()}`;
		setHistory((prev) => [
			...prev,
			{
				id: pendingId,
				messenger: params.channel.messenger,
				connectorId: params.channel.connectorId,
				direction: "out",
				source: "widget",
				text:
					params.text ||
					(params.attachment?.kind === "image" ? "Фото" : "Файл"),
				kind: params.attachment?.kind ?? "text",
				mediaFileName: params.attachment?.fileName,
				operatorName: operator?.name,
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
		return true;
	};

	const send = () => {
		if (!recipient || !channel || !canSend) return;
		setSendError(null);
		const payload = {
			channel,
			text: trimmedText,
			attachment: attachmentReady ? (uploaded ?? undefined) : undefined,
		};
		startSending(async () => {
			const ok = await dispatchMessage(payload);
			if (!ok) return;
			setText("");
			clearAttachment();
		});
	};

	/** Повторяет неудавшееся текстовое сообщение тем же каналом, которым оно
	 * уходило (канал определяется по самому сообщению, а не по выбору в поле). */
	const retryMessage = (item: HistoryEntry) => {
		if (!recipient || sending) return;
		const target = findChannelForMessage(recipient.channels, item);
		if (!target) {
			toast.error("Канал этого сообщения больше недоступен у контакта");
			return;
		}
		setSendError(null);
		startSending(async () => {
			const ok = await dispatchMessage({ channel: target, text: item.text });
			if (ok) {
				setRetriedIds((prev) => new Set(prev).add(item.id));
				toast.success("Сообщение отправлено повторно");
			} else {
				toast.error("Повторная отправка не удалась");
			}
		});
	};

	const quoteMessage = (item: HistoryEntry) => {
		const snippet = item.text.replace(/\s+/g, " ").trim();
		const short =
			snippet.length > QUOTE_MAX_LENGTH
				? `${snippet.slice(0, QUOTE_MAX_LENGTH)}…`
				: snippet;
		setText((prev) => `«${short}»\n${prev}`);
		requestAnimationFrame(() => {
			const el = textareaRef.current;
			el?.focus();
			el?.setSelectionRange(el.value.length, el.value.length);
		});
	};

	const insertTemplate = (template: TemplateItem, replace: boolean) => {
		const filled = applyTemplateVariables(
			template.text,
			recipient?.contactName ?? "",
		);
		setText((prev) =>
			replace || !prev.trim() ? filled : `${prev.trimEnd()}\n\n${filled}`,
		);
		requestAnimationFrame(() => textareaRef.current?.focus());
	};

	const loadOlder = useCallback(async (): Promise<boolean> => {
		const oldest = historyRef.current[0];
		if (!oldest || !hasMoreRef.current) return false;
		const result = await orpcClient.widgetMessage.loadOlder({
			entity,
			id: entityId,
			beforeIso: oldest.createdAt,
		});
		if (result.error || !result.messages) {
			toast.error(result.error ?? "Не удалось загрузить историю");
			return false;
		}
		const next = prependHistory(historyRef.current, result.messages);
		historyRef.current = next;
		hasMoreRef.current = result.hasMore ?? false;
		setHistory(next);
		setHasMore(result.hasMore ?? false);
		return true;
	}, [entity, entityId]);

	const handleLoadMore = () => {
		setLoadingMore(true);
		loadOlder()
			.catch(() => toast.error("Не удалось загрузить историю"))
			.finally(() => setLoadingMore(false));
	};

	/** Переход к найденному сообщению: если оно старше загруженных — докачиваем
	 * историю страницами, пока оно не появится в ленте. */
	const jumpToMessage = async (item: WidgetHistoryItem) => {
		setLoadingMore(true);
		try {
			let pages = 0;
			while (
				!historyRef.current.some((m) => m.id === item.id) &&
				hasMoreRef.current &&
				pages < MAX_JUMP_PAGES
			) {
				pages++;
				if (!(await loadOlder())) break;
			}
		} finally {
			setLoadingMore(false);
		}
		if (historyRef.current.some((m) => m.id === item.id)) {
			setFocusRequest({ id: item.id, nonce: Date.now() });
		} else {
			toast.error("Не удалось найти это сообщение в ленте");
		}
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

	const toggleSound = () => {
		const next = !soundOn;
		setSoundOn(next);
		writeSoundEnabled(next);
		if (next) playIncomingSound();
	};

	// Клиент последний раз писал не в тот канал, куда сейчас уйдёт ответ
	const mismatch = useMemo(() => {
		if (!recipient || !channel) return null;
		const lastIncoming = [...history]
			.reverse()
			.find((item) => item.direction === "in");
		if (!lastIncoming) return null;
		if (
			Date.now() - new Date(lastIncoming.createdAt).getTime() >
			MISMATCH_WARNING_MAX_AGE_MS
		) {
			return null;
		}
		const target = findChannelForMessage(recipient.channels, lastIncoming);
		if (!target || channelKey(target) === channelKey(channel)) return null;
		return { lastIncoming, target };
	}, [history, recipient, channel]);

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
						<div className="flex shrink-0 items-center gap-0.5">
							<SearchPopover
								entity={entity}
								entityId={entityId}
								disabled={recipient.channels.length === 0}
								onJump={(item) => void jumpToMessage(item)}
							/>
							<NotesPopover
								entity={entity}
								entityId={entityId}
								operator={operator}
								disabled={recipient.channels.length === 0}
							/>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								onClick={toggleSound}
								title={
									soundOn
										? "Звук о новых сообщениях включён"
										: "Звук о новых сообщениях выключен"
								}
								aria-label={
									soundOn
										? "Выключить звук сообщений"
										: "Включить звук сообщений"
								}
								aria-pressed={soundOn}
							>
								{soundOn ? (
									<BellIcon className="size-4" />
								) : (
									<BellOffIcon className="size-4" />
								)}
							</Button>
						</div>
					</header>

					<main className="min-h-0 flex-1 bg-muted/30">
						<HistoryList
							history={history}
							hasMore={hasMore}
							loadingMore={loadingMore}
							onLoadMore={handleLoadMore}
							onRetry={retryMessage}
							retriedIds={retriedIds}
							onQuote={quoteMessage}
							unreadFromId={unreadFromId}
							focusRequest={focusRequest}
						/>
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
							{mismatch && (
								<ChannelMismatchWarning
									lastIncoming={mismatch.lastIncoming}
									target={mismatch.target}
									onSwitch={() => setChannel(mismatch.target)}
								/>
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
								error={
									sendError ??
									(attachmentUnsupported
										? "Через личный номер MAX файлы пока не отправляются — выберите другой канал или уберите вложение"
										: null)
								}
								placeholder={
									composerDisabled
										? "Отправка недоступна — нет канала связи с клиентом"
										: attachment
											? "Подпись к файлу (необязательно)"
											: "Напишите сообщение клиенту…"
								}
								textareaRef={textareaRef}
								onPickFile={composerDisabled ? undefined : pickFile}
								attachmentPreview={
									attachment ? (
										<AttachmentPreview
											attachment={attachment}
											onRemove={clearAttachment}
										/>
									) : null
								}
								slashItems={templates}
								onSlashPick={(item) => insertTemplate(item, true)}
								toolbarExtra={
									<TemplatesPopover
										templates={templates}
										loading={templatesQuery.isLoading}
										currentText={text}
										disabled={composerDisabled}
										onInsert={(item) => insertTemplate(item, false)}
										onChanged={() =>
											queryClient.invalidateQueries({
												queryKey: orpc.messages.quickReplies.key(),
											})
										}
									/>
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
											disabled={!canSend || !trimmedText || Boolean(attachment)}
										/>
										<Button
											size="lg"
											onClick={send}
											disabled={!canSend}
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
