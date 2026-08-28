"use client";

import type { ClientListItem, InboxMessenger } from "@psi-opora/api";
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
	UserCheckIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ClientAvatar } from "@/components/inbox/client-avatar";
import {
	MessageList,
	mergeThread,
	type ThreadMessage,
} from "@/components/inbox/message-list";
import { messengerLabel } from "@/components/inbox/messenger-meta";
import { QuickReplies } from "@/components/inbox/quick-replies";
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
import { buildDialogLink, copyText } from "@/lib/dialog-link";
import { orpcClient } from "@/lib/orpc/client";
import { cn } from "@/lib/utils";

const THREAD_POLL_INTERVAL_MS = 5000;

interface PersonalAccountOption {
	connectorId: string;
	phone: string;
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
}

export function ThreadPane({
	selected,
	client,
	operator,
	showProfile,
	onToggleProfile,
	onAfterSend,
	onAssigned,
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
	const sinceRef = useRef(new Date().toISOString());
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

	// Личные номера (Telegram/WhatsApp) на портале может быть несколько —
	// без явного выбора отправка ушла бы с первого попавшегося, а это не
	// обязательно тот номер, с которым переписывается клиент.
	const [personalAccounts, setPersonalAccounts] = useState<
		PersonalAccountOption[]
	>([]);
	const [connectorId, setConnectorId] = useState<string | undefined>();

	// Загрузка переписки и (для личных номеров) списка подключённых аккаунтов
	// при смене выбранного клиента — в одном эффекте, чтобы по истории треда
	// можно было сразу выставить номер по умолчанию тем же, с которого шла
	// переписка, а не первым попавшимся из personalAccounts[0].
	useEffect(() => {
		clearAttachment();
		revokeAllPendingPreviewUrls();
		setMessages([]);
		setText("");
		setSendError(null);
		setEditTarget(null);
		setEditText("");
		setDeleteTarget(null);
		setPersonalAccounts([]);
		setConnectorId(undefined);
		if (!selected) return;
		const { messenger, userId } = selected;
		const isPersonal =
			messenger === "telegram-personal" ||
			messenger === "whatsapp-personal" ||
			messenger === "max-personal";
		let cancelled = false;

		setThreadLoading(true);

		Promise.all([
			orpcClient.messages.thread({ messenger, userId }),
			isPersonal
				? messenger === "telegram-personal"
					? orpcClient.telegramPersonal.list()
					: messenger === "whatsapp-personal"
						? orpcClient.whatsappPersonal.list()
						: orpcClient.maxPersonal.list()
				: Promise.resolve({ accounts: [] as PersonalAccountOption[] }),
		])
			.then(([threadRes, accountsRes]) => {
				if (cancelled) return;
				setMessages(
					threadRes.messages.map((m) => ({
						id: m.id,
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
					})),
				);
				sinceRef.current = latestUpdatedAt(threadRes.messages);

				if (!isPersonal) return;
				const accounts = accountsRes.accounts;
				setPersonalAccounts(accounts);
				// Номер, с которого реально шла переписка (последнее сообщение с
				// известным connectorId) — приоритетнее первого подключённого,
				// чтобы ответ по умолчанию ушёл с того же номера, что видел клиент.
				const lastKnown = [...threadRes.messages]
					.reverse()
					.find((m) => m.connectorId)?.connectorId;
				const fallback = accounts[0]?.connectorId;
				setConnectorId(
					lastKnown && accounts.some((a) => a.connectorId === lastKnown)
						? lastKnown
						: fallback,
				);
			})
			.finally(() => {
				if (!cancelled) setThreadLoading(false);
			});

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
			if (document.hidden || polling) return;
			polling = true;
			try {
				const result = await orpcClient.messages.poll({
					messenger: selectedMessenger,
					userId: selectedUserId,
					sinceIso: sinceRef.current,
				});
				// Запрос мог завершиться уже после переключения на другой диалог.
				// В таком случае его сообщения нельзя вливать в новый открытый тред.
				if (cancelled || !result.messages || result.messages.length === 0)
					return;
				const polledMessages = result.messages;
				sinceRef.current = latestUpdatedAt(polledMessages);
				setMessages((prev) =>
					mergeThread(
						prev,
						polledMessages.map((m) => ({
							id: m.id,
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
						})),
					),
				);
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
		fetch("/api/attachments", {
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
		if (!selected) return;
		const trimmed = text.trim();
		const readyAttachment =
			attachment?.status === "done" ? attachment.uploaded : undefined;
		if ((!trimmed && !readyAttachment) || sending) return;
		if (attachment?.status === "uploading") return;

		setSendError(null);
		startSending(async () => {
			const result = await orpcClient.messages.send({
				messenger: selected.messenger,
				userId: selected.userId,
				connectorId,
				text: trimmed,
				attachment: readyAttachment,
				operatorId: operator?.id,
				operatorName: operator?.name,
			});
			if (result.error) {
				setSendError(result.error);
				return;
			}
			setText("");
			// previewUrl отправленного вложения не отзываем сразу: он ещё нужен
			// как mediaUrl оптимистичного сообщения ниже, пока поллинг не заменит
			// его настоящим — см. mergeThread по text+direction в message-list.tsx.
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
					direction: "out",
					source: "widget",
					text: trimmed,
					operatorName: operator?.name,
					createdAt: new Date().toISOString(),
					pending: true,
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
			const updated: ThreadMessage = {
				id: result.message.id,
				direction: result.message.direction,
				source: result.message.source,
				text: result.message.text,
				operatorName: result.message.operatorName,
				status: result.message.status,
				createdAt: result.message.createdAt,
				updatedAt: result.message.updatedAt,
				editedAt: result.message.editedAt,
				deletedAt: result.message.deletedAt,
				canEdit: result.message.canEdit,
				canDelete: result.message.canDelete,
				kind: result.message.kind,
				mediaUrl: result.message.mediaUrl,
				mediaFileName: result.message.mediaFileName,
				connectorId: result.message.connectorId,
			};
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
			const updated: ThreadMessage = {
				id: result.message.id,
				direction: result.message.direction,
				source: result.message.source,
				text: result.message.text,
				operatorName: result.message.operatorName,
				status: result.message.status,
				createdAt: result.message.createdAt,
				updatedAt: result.message.updatedAt,
				editedAt: result.message.editedAt,
				deletedAt: result.message.deletedAt,
				canEdit: result.message.canEdit,
				canDelete: result.message.canDelete,
				kind: result.message.kind,
				mediaUrl: result.message.mediaUrl,
				mediaFileName: result.message.mediaFileName,
				connectorId: result.message.connectorId,
			};
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
					<p className="truncate text-xs text-muted-foreground">
						{messengerLabel(selected.messenger)}
						{client?.username ? ` · @${client.username}` : ""}
						{client?.assignedOperatorName
							? ` · Ответственный: ${client.assignedOperatorName}`
							: " · Без ответственного"}
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
						connectorLabels={Object.fromEntries(
							personalAccounts.map((a) => [a.connectorId, a.phone]),
						)}
					/>
				)}
			</div>

			<div className="border-t p-3">
				{personalAccounts.length > 1 && (
					<div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
						<span>Отправить с номера:</span>
						{personalAccounts.map((acc) => (
							<button
								key={acc.connectorId}
								type="button"
								onClick={() => setConnectorId(acc.connectorId)}
								className={cn(
									"rounded-md border px-2 py-0.5 transition-colors",
									connectorId === acc.connectorId
										? "border-primary bg-primary text-primary-foreground"
										: "hover:bg-muted",
								)}
							>
								{acc.phone}
							</button>
						))}
					</div>
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
							attachment?.status === "uploading" ||
							(!text.trim() && attachment?.status !== "done")
						}
					>
						{sending ? (
							<Loader2Icon className="size-4 animate-spin" />
						) : (
							<SendIcon className="size-4" />
						)}
						Отправить
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
							{selected?.messenger === "max" ? "MAX" : "Telegram"}.
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
		</div>
	);
}
