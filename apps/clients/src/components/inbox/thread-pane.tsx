"use client";

import type {
	ClientListItem,
	ClientMessageItem,
	ClientThreadChannel,
	InboxMessenger,
} from "@psi-opora/api";
import {
	MAX_ATTACHMENT_SIZE,
	messageAttachmentSchema,
} from "@psi-opora/api/schemas";
import {
	LinkIcon,
	Loader2Icon,
	MessageSquareIcon,
	PanelRightCloseIcon,
	PanelRightOpenIcon,
	SaveIcon,
	SendIcon,
	Trash2Icon,
	TriangleAlertIcon,
	UserCheckIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ChannelChip } from "@/components/inbox/channel-chip";
import {
	ChannelPicker,
	type ReplyChannel,
	replyChannelKey,
} from "@/components/inbox/channel-picker";
import { ClientAvatar } from "@/components/inbox/client-avatar";
import {
	MessageList,
	mergeThread,
	type ThreadMessage,
} from "@/components/inbox/message-list";
import {
	conversationKey,
	messengerMeta,
	summarizeChannelActivity,
} from "@/components/inbox/messenger-meta";
import { QuickReplies } from "@/components/inbox/quick-replies";
import {
	getSendResultError,
	isSuccessfulSendResult,
} from "@/components/inbox/send-result";
import { resolveThreadPoll } from "@/components/inbox/thread-poll";
import {
	type ComposerAttachment,
	MessageComposer,
} from "@/components/messaging/message-composer";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { fetchWithSessionRenewal } from "@/lib/bitrix-session";
import { buildDialogLink, copyText } from "@/lib/dialog-link";
import { orpcClient } from "@/lib/orpc/client";
import { cn } from "@/lib/utils";

const THREAD_POLL_INTERVAL_MS = 5000;

interface PersonalAccountOption {
	connectorId: string;
	phone: string;
	status: string;
}

type PersonalMessenger =
	| "telegram-personal"
	| "whatsapp-personal"
	| "max-personal";

function isPersonalMessenger(
	messenger: InboxMessenger,
): messenger is PersonalMessenger {
	return (
		messenger === "telegram-personal" ||
		messenger === "whatsapp-personal" ||
		messenger === "max-personal"
	);
}

function listPersonalAccounts(
	messenger: PersonalMessenger,
): Promise<{ accounts: PersonalAccountOption[] }> {
	switch (messenger) {
		case "telegram-personal":
			return orpcClient.telegramPersonal.list();
		case "whatsapp-personal":
			return orpcClient.whatsappPersonal.list();
		case "max-personal":
			return orpcClient.maxPersonal.list();
	}
}

function toThreadMessage(m: ClientMessageItem): ThreadMessage {
	return {
		id: m.id,
		messenger: m.messenger,
		direction: m.direction,
		source: m.source,
		text: m.text,
		operatorName: m.operatorName,
		status: m.status,
		createdAt: m.createdAt,
		updatedAt: m.updatedAt,
		editedAt: m.editedAt,
		deletedAt: m.deletedAt,
		canEdit: m.canEdit,
		canDelete: m.canDelete,
		kind: m.kind,
		mediaUrl: m.mediaUrl,
		mediaFileName: m.mediaFileName,
		connectorId: m.connectorId,
		guideEmailSentAt: m.guideEmailSentAt,
	};
}

/** Каналы, в которые можно ответить: по одному на каждый мессенджер клиента,
 * а для личных номеров — по одному на каждый подключённый номер. */
function buildReplyChannels(
	identities: ClientThreadChannel[],
	accounts: Partial<Record<InboxMessenger, PersonalAccountOption[]>>,
): ReplyChannel[] {
	return identities.flatMap(({ messenger, userId }): ReplyChannel[] => {
		const numbers = isPersonalMessenger(messenger)
			? (accounts[messenger] ?? [])
			: [];
		if (numbers.length === 0) return [{ messenger, userId }];
		return numbers.map((a) => ({
			messenger,
			userId,
			connectorId: a.connectorId,
			accountPhone: a.phone,
		}));
	});
}

/** Канал по умолчанию — туда, где клиент написал последним (ответ уходит
 * туда, где его увидят); если он ещё не писал — где последнее сообщение
 * вообще; иначе канал выбранной строки списка. */
function pickDefaultChannel(
	channels: ReplyChannel[],
	messages: ThreadMessage[],
	selected: SelectedClient,
): ReplyChannel | null {
	const lastIn = [...messages]
		.reverse()
		.find((m) => m.direction === "in" && m.messenger);
	const lastAny = [...messages].reverse().find((m) => m.messenger);
	for (const m of [lastIn, lastAny]) {
		if (!m?.messenger) continue;
		const key = conversationKey(m.messenger, m.connectorId);
		const hit = channels.find(
			(c) => conversationKey(c.messenger, c.connectorId) === key,
		);
		if (hit) return hit;
	}
	return (
		channels.find(
			(c) => c.messenger === selected.messenger && c.userId === selected.userId,
		) ??
		channels[0] ??
		null
	);
}

/** Курсор поллинга — максимальный updatedAt среди сообщений, а не createdAt:
 * listBotMessagesSince ловит и статусные апдейты уже показанных сообщений
 * (sent → delivered → read), не только новые строки, поэтому нельзя
 * полагаться на порядок массива и брать «последний» элемент. */
function latestUpdatedAt(messages: { updatedAt: string }[]): string {
	const max = messages.reduce(
		(acc, m) => (m.updatedAt > acc ? m.updatedAt : acc),
		"",
	);
	return max || new Date().toISOString();
}

export interface SelectedClient {
	messenger: InboxMessenger;
	userId: string;
}

export interface CurrentOperator {
	id: string;
	name: string;
}

interface ThreadPaneProps {
	selected: SelectedClient | null;
	client: ClientListItem | undefined;
	operator: CurrentOperator | null;
	showProfile: boolean;
	onToggleProfile: () => void;
	/** Обновить список диалогов (последнее сообщение, порядок) после отправки. */
	onAfterSend: () => void;
	/** Отразить назначение ответственного в списке диалогов. */
	onAssigned: (operator: CurrentOperator) => void;
	/** Диалог удалён из инбокса — закрыть его и убрать из списка. */
	onConversationDeleted: (client: SelectedClient) => void;
}

export function ThreadPane({
	selected,
	client,
	operator,
	showProfile,
	onToggleProfile,
	onAfterSend,
	onAssigned,
	onConversationDeleted,
}: ThreadPaneProps) {
	const [messages, setMessages] = useState<ThreadMessage[]>([]);
	const [threadLoading, setThreadLoading] = useState(false);
	const [text, setText] = useState("");
	const [attachment, setAttachment] = useState<ComposerAttachment | null>(null);
	const [sendError, setSendError] = useState<string | null>(null);
	const [sending, startSending] = useTransition();
	const [editing, startEditing] = useTransition();
	const [editTarget, setEditTarget] = useState<ThreadMessage | null>(null);
	const [editText, setEditText] = useState("");
	const [deleting, startDeleting] = useTransition();
	const [deleteTarget, setDeleteTarget] = useState<ThreadMessage | null>(null);
	const [assigning, startAssigning] = useTransition();
	const [deletingConversation, startDeletingConversation] = useTransition();
	const [confirmConversationDelete, setConfirmConversationDelete] =
		useState(false);
	const sinceRef = useRef(new Date().toISOString());
	const deletionVersionRef = useRef<string | undefined>(undefined);
	const attachmentUploadRef = useRef<AbortController | null>(null);
	const attachmentPreviewUrlRef = useRef("");
	const pendingPreviewUrlsRef = useRef(new Map<string, string>());
	const selectedMessenger = selected?.messenger;
	const selectedUserId = selected?.userId;
	const revokePendingPreviewUrl = useCallback((messageId: string) => {
		const previewUrl = pendingPreviewUrlsRef.current.get(messageId);
		if (!previewUrl) return;
		URL.revokeObjectURL(previewUrl);
		pendingPreviewUrlsRef.current.delete(messageId);
	}, []);
	const revokeAllPendingPreviewUrls = useCallback(() => {
		for (const previewUrl of pendingPreviewUrlsRef.current.values()) {
			URL.revokeObjectURL(previewUrl);
		}
		pendingPreviewUrlsRef.current.clear();
	}, []);
	const clearAttachment = useCallback(() => {
		attachmentUploadRef.current?.abort();
		attachmentUploadRef.current = null;
		if (attachmentPreviewUrlRef.current) {
			URL.revokeObjectURL(attachmentPreviewUrlRef.current);
			attachmentPreviewUrlRef.current = "";
		}
		setAttachment(null);
	}, []);

	// Каналы клиента: у объединённого клиента (см. merge.ts) в одном диалоге
	// несколько мессенджеров, а личных номеров одного мессенджера на портале
	// может быть несколько — без явного выбора ответ ушёл бы не туда, куда
	// смотрит клиент.
	const [identities, setIdentities] = useState<ClientThreadChannel[]>([]);
	const [accountsByMessenger, setAccountsByMessenger] = useState<
		Partial<Record<InboxMessenger, PersonalAccountOption[]>>
	>({});
	const [target, setTarget] = useState<ReplyChannel | null>(null);

	// Загрузка переписки и (для личных номеров) списка подключённых аккаунтов
	// при смене выбранного клиента — в одном эффекте, чтобы по истории треда
	// можно было сразу выставить номер по умолчанию тем же, с которого шла
	// переписка, а не первым попавшимся из personalAccounts[0].
	useEffect(() => {
		clearAttachment();
		revokeAllPendingPreviewUrls();
		setMessages([]);
		deletionVersionRef.current = undefined;
		setText("");
		setSendError(null);
		setEditTarget(null);
		setEditText("");
		setDeleteTarget(null);
		setConfirmConversationDelete(false);
		setIdentities([]);
		setAccountsByMessenger({});
		setTarget(null);
		if (!selected) return;
		const { messenger, userId } = selected;
		let cancelled = false;

		setThreadLoading(true);

		(async () => {
			try {
				const threadRes = await orpcClient.messages.thread({
					messenger,
					userId,
				});
				if (cancelled) return;
				const threadMessages = threadRes.messages.map(toThreadMessage);
				const ids: ClientThreadChannel[] =
					threadRes.channels.length > 0
						? threadRes.channels
						: [{ messenger, userId }];
				const personal = [
					...new Set(ids.map((i) => i.messenger).filter(isPersonalMessenger)),
				];
				const lists = await Promise.all(
					personal.map(async (m) => {
						const res = await listPersonalAccounts(m).catch(() => ({
							accounts: [] as PersonalAccountOption[],
						}));
						return [
							m,
							res.accounts.filter((a) => a.status === "connected"),
						] as const;
					}),
				);
				if (cancelled) return;
				const accounts: Partial<
					Record<InboxMessenger, PersonalAccountOption[]>
				> = Object.fromEntries(lists);
				setMessages(threadMessages);
				sinceRef.current = latestUpdatedAt(threadRes.messages);
				deletionVersionRef.current = threadRes.deletionVersion;
				setIdentities(ids);
				setAccountsByMessenger(accounts);
				setTarget(
					pickDefaultChannel(
						buildReplyChannels(ids, accounts),
						threadMessages,
						{ messenger, userId },
					),
				);
			} catch {
				if (!cancelled) toast.error("Не удалось загрузить переписку");
			} finally {
				if (!cancelled) setThreadLoading(false);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [selected, clearAttachment, revokeAllPendingPreviewUrls]);

	useEffect(
		() => () => {
			attachmentUploadRef.current?.abort();
			if (attachmentPreviewUrlRef.current) {
				URL.revokeObjectURL(attachmentPreviewUrlRef.current);
			}
			revokeAllPendingPreviewUrls();
		},
		[revokeAllPendingPreviewUrls],
	);

	useEffect(() => {
		const activeMessageIds = new Set(messages.map((message) => message.id));
		for (const pendingId of pendingPreviewUrlsRef.current.keys()) {
			if (!activeMessageIds.has(pendingId)) {
				revokePendingPreviewUrl(pendingId);
			}
		}
	}, [messages, revokePendingPreviewUrl]);

	// Поллинг открытого диалога — новые сообщения (клиент, оператор из Bitrix, виджет CRM).
	useEffect(() => {
		if (!selectedMessenger || !selectedUserId) return;
		let cancelled = false;
		let polling = false;

		const poll = async () => {
			if (
				document.hidden ||
				polling ||
				deletionVersionRef.current === undefined
			)
				return;
			polling = true;
			try {
				const result = await orpcClient.messages.poll({
					messenger: selectedMessenger,
					userId: selectedUserId,
					sinceIso: sinceRef.current,
				});
				// Запрос мог завершиться уже после переключения на другой диалог.
				// В таком случае его сообщения нельзя вливать в новый открытый тред.
				if (cancelled) return;
				const update = await resolveThreadPoll(
					result,
					deletionVersionRef.current,
					() =>
						orpcClient.messages.thread({
							messenger: selectedMessenger,
							userId: selectedUserId,
						}),
				);
				if (cancelled || !update) return;
				deletionVersionRef.current = update.deletionVersion;
				if (update.replace) {
					setMessages(update.messages);
					// An empty reload must not skip messages arriving during the request.
					if (update.messages.length > 0) {
						sinceRef.current = latestUpdatedAt(update.messages);
					}
					setEditTarget(null);
					setDeleteTarget(null);
					return;
				}
				const polledMessages = update.messages;
				if (polledMessages.length === 0) return;
				sinceRef.current = latestUpdatedAt(polledMessages);
				setMessages((prev) =>
					mergeThread(prev, polledMessages.map(toThreadMessage)),
				);
			} catch {
				// Keep the cursors unchanged after a failed request and retry next poll.
			} finally {
				polling = false;
			}
		};

		const interval = setInterval(poll, THREAD_POLL_INTERVAL_MS);
		const onVisibilityChange = () => {
			if (!document.hidden) poll();
		};
		document.addEventListener("visibilitychange", onVisibilityChange);

		return () => {
			cancelled = true;
			clearInterval(interval);
			document.removeEventListener("visibilitychange", onVisibilityChange);
		};
	}, [selectedMessenger, selectedUserId]);

	// Загрузка вложения — сразу по выбору файла в composer'е, не дожидаясь
	// отправки сообщения: так превью и прогресс не завязаны на send().
	const attachFile = (file: File) => {
		clearAttachment();
		if (file.size > MAX_ATTACHMENT_SIZE) {
			setSendError(
				`Файл больше ${Math.floor(MAX_ATTACHMENT_SIZE / (1024 * 1024))} МБ`,
			);
			return;
		}
		setSendError(null);
		const previewUrl =
			file.type.startsWith("image/") || file.type.startsWith("audio/")
				? URL.createObjectURL(file)
				: "";
		const pending: ComposerAttachment = {
			file,
			previewUrl,
			status: "uploading",
		};
		attachmentPreviewUrlRef.current = previewUrl;
		setAttachment(pending);

		const controller = new AbortController();
		attachmentUploadRef.current = controller;
		const formData = new FormData();
		formData.append("file", file);
		fetchWithSessionRenewal("/api/attachments", {
			method: "POST",
			body: formData,
			signal: controller.signal,
		})
			.then(async (res) => {
				const json: unknown = await res.json();
				setAttachment((current) => {
					if (current?.file !== file) return current;
					if (!res.ok) {
						const error =
							typeof json === "object" &&
							json !== null &&
							"error" in json &&
							typeof json.error === "string"
								? json.error
								: `HTTP ${res.status}`;
						return { ...current, status: "error", error };
					}
					const parsed = messageAttachmentSchema.safeParse(json);
					return parsed.success
						? { ...current, status: "done", uploaded: parsed.data }
						: {
								...current,
								status: "error",
								error:
									parsed.error.issues[0]?.message ??
									"Некорректный ответ сервера",
							};
				});
			})
			.catch((err) => {
				if (controller.signal.aborted) return;
				setAttachment((current) =>
					current?.file === file
						? { ...current, status: "error", error: (err as Error).message }
						: current,
				);
			})
			.finally(() => {
				if (attachmentUploadRef.current === controller) {
					attachmentUploadRef.current = null;
				}
			});
	};

	const removeAttachment = () => {
		clearAttachment();
	};

	const send = () => {
		if (!selected || !target) return;
		const trimmed = text.trim();
		const readyAttachment =
			attachment?.status === "done" ? attachment.uploaded : undefined;
		if ((!trimmed && !readyAttachment) || sending) return;
		if (attachment?.status === "uploading") return;

		setSendError(null);
		startSending(async () => {
			const result = await orpcClient.messages.send({
				messenger: target.messenger,
				userId: target.userId,
				connectorId: target.connectorId,
				text: trimmed,
				attachment: readyAttachment,
				operatorId: operator?.id,
				operatorName: operator?.name,
			});
			if (!isSuccessfulSendResult(result)) {
				setSendError(getSendResultError(result));
				return;
			}
			setText("");
			// previewUrl отправленного вложения не отзываем сразу: он ещё нужен
			// как mediaUrl оптимистичного сообщения ниже, пока поллинг не заменит
			// его настоящим — см. mergeThread по expectedId в message-list.tsx.
			const sentPreviewUrl = attachment?.previewUrl;
			const pendingId = `pending-${crypto.randomUUID()}`;
			if (sentPreviewUrl) {
				pendingPreviewUrlsRef.current.set(pendingId, sentPreviewUrl);
				attachmentPreviewUrlRef.current = "";
			}
			setAttachment(null);
			setMessages((prev) => [
				...prev,
				{
					id: pendingId,
					messenger: target.messenger,
					connectorId: target.connectorId,
					direction: "out",
					source: "widget",
					text: trimmed,
					operatorName: operator?.name,
					createdAt: new Date().toISOString(),
					pending: true,
					expectedId: result.id,
					...(readyAttachment
						? {
								kind: readyAttachment.kind,
								...(sentPreviewUrl ? { mediaUrl: sentPreviewUrl } : {}),
								mediaFileName: readyAttachment.fileName,
							}
						: {}),
				},
			]);
			onAfterSend();
		});
	};

	const assignToMe = () => {
		if (!selected || !operator) return;
		startAssigning(async () => {
			await orpcClient.messages.assign({
				messenger: selected.messenger,
				userId: selected.userId,
				operatorId: operator.id,
				operatorName: operator.name,
			});
			onAssigned(operator);
		});
	};

	const openEditor = (message: ThreadMessage) => {
		setEditTarget(message);
		setEditText(message.text);
	};

	const saveEdit = () => {
		const trimmed = editText.trim();
		if (!editTarget || !trimmed || editing) return;

		startEditing(async () => {
			const result = await orpcClient.messages.edit({
				messageId: editTarget.id,
				text: trimmed,
			});
			if (result.error || !result.message) {
				toast.error(result.error ?? "Не удалось изменить сообщение");
				return;
			}
			const updated = toThreadMessage(result.message);
			setMessages((prev) => mergeThread(prev, [updated]));
			setEditTarget(null);
			setEditText("");
			onAfterSend();
			toast.success("Сообщение изменено");
		});
	};

	const confirmDelete = () => {
		if (!deleteTarget || deleting) return;

		startDeleting(async () => {
			const result = await orpcClient.messages.delete({
				messageId: deleteTarget.id,
			});
			if (result.error || !result.message) {
				toast.error(result.error ?? "Не удалось удалить сообщение");
				return;
			}
			const updated = toThreadMessage(result.message);
			setMessages((prev) => mergeThread(prev, [updated]));
			setDeleteTarget(null);
			onAfterSend();
			if (result.warning) {
				toast.warning(result.warning);
			} else {
				toast.success("Сообщение удалено у клиента");
			}
		});
	};

	const deleteConversation = () => {
		if (!selected || deletingConversation) return;
		const target = selected;

		startDeletingConversation(async () => {
			try {
				await orpcClient.messages.deleteConversation({
					messenger: target.messenger,
					userId: target.userId,
				});
			} catch {
				toast.error("Не удалось удалить диалог");
				return;
			}
			setConfirmConversationDelete(false);
			onConversationDeleted(target);
			toast.success("Диалог удалён");
		});
	};

	const copyDialogLink = async () => {
		if (!selected) return;
		const link = buildDialogLink(selected, window.location);

		try {
			await copyText(link);
			toast.success("Ссылка на диалог скопирована", {
				description: "Отправьте её боту для анализа переписки.",
			});
		} catch {
			toast.error("Не удалось скопировать ссылку");
		}
	};

	if (!selected) {
		return (
			<div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
				<MessageSquareIcon className="size-10" />
				<p className="text-sm">Выберите диалог из списка слева</p>
			</div>
		);
	}

	const name = client?.name ?? selected.userId;
	const dialogLink = buildDialogLink(selected, window.location);

	const replyChannels = buildReplyChannels(
		identities.length > 0 ? identities : [selected],
		accountsByMessenger,
	);
	const activity = summarizeChannelActivity(replyChannels, messages);
	const targetMeta = target ? messengerMeta(target.messenger) : undefined;
	// Кто участвует в переписке: каналы, где уже есть сообщения (по одному
	// бейджу на канал); у нового диалога — канал выбранной строки.
	const participants = [
		...new Map(
			replyChannels
				.filter(
					(c) =>
						activity.get(conversationKey(c.messenger, c.connectorId))?.lastAt,
				)
				.map((c) => [conversationKey(c.messenger, c.connectorId), c]),
		).values(),
	];
	const headerChannels =
		participants.length > 0 ? participants : target ? [target] : [];
	const connectorLabels = Object.fromEntries(
		Object.values(accountsByMessenger)
			.flat()
			.map((a) => [a.connectorId, a.phone]),
	);
	// Клиент в последний раз писал не в тот канал, в который сейчас уйдёт ответ.
	const lastInbound = [...messages]
		.reverse()
		.find((m) => m.direction === "in" && m.messenger);
	const lastInboundChannel = lastInbound?.messenger
		? replyChannels.find(
				(c) =>
					conversationKey(c.messenger, c.connectorId) ===
					conversationKey(
						lastInbound.messenger as string,
						lastInbound.connectorId,
					),
			)
		: undefined;
	const replyElsewhere =
		target &&
		lastInboundChannel &&
		replyChannelKey(target) !== replyChannelKey(lastInboundChannel)
			? lastInboundChannel
			: null;

	return (
		<div className="flex min-w-0 flex-1 flex-col">
			<div className="flex items-center gap-3 border-b px-4 py-2.5">
				<ClientAvatar
					name={name}
					avatarUrl={client?.avatarUrl ?? null}
					messenger={selected.messenger}
				/>
				<div className="min-w-0 flex-1">
					<p className="truncate text-sm font-semibold">{name}</p>
					<div className="mt-0.5 flex flex-wrap items-center gap-1.5">
						{headerChannels.map((c) => (
							<ChannelChip
								key={conversationKey(c.messenger, c.connectorId)}
								messenger={c.messenger}
								accountPhone={c.accountPhone}
							/>
						))}
					</div>
					<p className="mt-0.5 truncate text-xs text-muted-foreground">
						{client?.username ? `@${client.username} · ` : ""}
						{client?.assignedOperatorName
							? `Ответственный: ${client.assignedOperatorName}`
							: "Без ответственного"}
					</p>
				</div>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button variant="outline" size="sm" onClick={copyDialogLink}>
							<LinkIcon data-icon="inline-start" />
							Ссылка для анализа
						</Button>
					</TooltipTrigger>
					<TooltipContent>{dialogLink}</TooltipContent>
				</Tooltip>
				{operator && client?.assignedOperatorId !== operator.id && (
					<Button
						variant="outline"
						size="sm"
						onClick={assignToMe}
						disabled={assigning}
					>
						{assigning ? (
							<Loader2Icon className="size-3.5 animate-spin" />
						) : (
							<UserCheckIcon className="size-3.5" />
						)}
						Назначить на себя
					</Button>
				)}
				<Button
					variant="ghost"
					size="icon"
					onClick={() => setConfirmConversationDelete(true)}
					title="Удалить диалог"
				>
					<Trash2Icon className="size-4" />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					onClick={onToggleProfile}
					title={
						showProfile
							? "Скрыть карточку клиента"
							: "Показать карточку клиента"
					}
				>
					{showProfile ? (
						<PanelRightCloseIcon className="size-4" />
					) : (
						<PanelRightOpenIcon className="size-4" />
					)}
				</Button>
			</div>

			<div className="min-h-0 flex-1">
				{threadLoading ? (
					<div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
						<Loader2Icon className="size-4 animate-spin" />
						Загружаем переписку…
					</div>
				) : messages.length === 0 ? (
					<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
						Сообщений пока нет — напишите первым
					</div>
				) : (
					<MessageList
						messages={messages}
						onEdit={openEditor}
						onDelete={setDeleteTarget}
						connectorLabels={connectorLabels}
					/>
				)}
			</div>

			<div
				className={cn(
					"border-t-2 p-3",
					targetMeta?.accent.edge ?? "border-t-border",
				)}
			>
				<ChannelPicker
					channels={replyChannels}
					selected={target}
					activity={activity}
					onSelect={setTarget}
				/>
				{replyElsewhere && (
					<p className="mb-2 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
						<TriangleAlertIcon className="size-3.5 shrink-0 text-amber-600" />
						Клиент последний раз писал в{" "}
						{messengerMeta(replyElsewhere.messenger)?.name}, а ответ уйдёт в{" "}
						{targetMeta?.name}.
						<button
							type="button"
							onClick={() => setTarget(replyElsewhere)}
							className="font-medium text-foreground underline underline-offset-2 hover:no-underline"
						>
							Ответить в {messengerMeta(replyElsewhere.messenger)?.name}
						</button>
					</p>
				)}
				<MessageComposer
					text={text}
					onTextChange={setText}
					onSend={send}
					placeholder="Ответить клиенту… (Enter — отправить, Shift+Enter — новая строка)"
					attachment={attachment}
					onAttachFile={attachFile}
					onRemoveAttachment={removeAttachment}
				/>
				<div className="mt-1.5 flex items-center justify-between gap-2">
					<div className="flex items-center gap-2">
						<QuickReplies
							onInsert={(template) =>
								setText((prev) =>
									prev.trim() ? `${prev}\n${template}` : template,
								)
							}
						/>
						{sendError && (
							<p className="text-sm text-destructive">{sendError}</p>
						)}
					</div>
					<Button
						onClick={send}
						disabled={
							sending ||
							!target ||
							attachment?.status === "uploading" ||
							(!text.trim() && attachment?.status !== "done")
						}
					>
						{sending ? (
							<Loader2Icon className="size-4 animate-spin" />
						) : (
							<SendIcon className="size-4" />
						)}
						{targetMeta ? `Отправить в ${targetMeta.name}` : "Отправить"}
					</Button>
				</div>
			</div>

			<Dialog
				open={Boolean(editTarget)}
				onOpenChange={(open) => {
					if (!open && !editing) {
						setEditTarget(null);
						setEditText("");
					}
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Редактировать сообщение</DialogTitle>
						<DialogDescription>
							Изменение сразу увидит клиент в{" "}
							{
								messengerMeta(
									editTarget?.messenger ?? selected?.messenger ?? "telegram",
								)?.name
							}
							.
						</DialogDescription>
					</DialogHeader>
					<MessageComposer
						text={editText}
						onTextChange={setEditText}
						onSend={saveEdit}
						placeholder="Новый текст сообщения"
					/>
					<DialogFooter>
						<Button
							onClick={saveEdit}
							disabled={
								editing ||
								!editText.trim() ||
								editText.trim() === editTarget?.text
							}
						>
							{editing ? (
								<Loader2Icon className="size-4 animate-spin" />
							) : (
								<SaveIcon className="size-4" />
							)}
							Сохранить
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog
				open={Boolean(deleteTarget)}
				onOpenChange={(open) => {
					if (!open && !deleting) setDeleteTarget(null);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Удалить сообщение?</DialogTitle>
						<DialogDescription>
							Сообщение будет отозвано у клиента и скрыто в истории. Это
							действие нельзя отменить.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setDeleteTarget(null)}
							disabled={deleting}
						>
							Отмена
						</Button>
						<Button
							variant="destructive"
							onClick={confirmDelete}
							disabled={deleting}
						>
							{deleting && <Loader2Icon className="size-4 animate-spin" />}
							Удалить
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog
				open={confirmConversationDelete}
				onOpenChange={(open) => {
					if (!open && !deletingConversation)
						setConfirmConversationDelete(false);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Удалить диалог?</DialogTitle>
						<DialogDescription>
							Переписка с «{name}» пропадёт из списка «Клиенты», ответственный и
							теги будут сброшены. У клиента в мессенджере и в Открытой линии
							Битрикс24 ничего не удалится. Если клиент напишет снова, диалог
							появится заново — только с новыми сообщениями.
							{client?.linkedChannels.length
								? " Объединённые каналы этого клиента тоже будут удалены."
								: ""}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setConfirmConversationDelete(false)}
							disabled={deletingConversation}
						>
							Отмена
						</Button>
						<Button
							variant="destructive"
							onClick={deleteConversation}
							disabled={deletingConversation}
						>
							{deletingConversation && (
								<Loader2Icon className="size-4 animate-spin" />
							)}
							Удалить диалог
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
