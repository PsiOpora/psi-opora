import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import {
	insertBotMessage,
	listConnectedTelegramPersonalAccounts,
	markTelegramPersonalAccountError,
	type TelegramPersonalAccount,
	updateBotMessageExternalResult,
	updateExistingBotUserPresence,
	upsertBotUser,
	upsertBotUserPresence,
} from "@psi-opora/db/queries";
import {
	createS3Client,
	getObjectStream,
	uploadObject,
} from "@psi-opora/storage";
import {
	createUserbotClient,
	decryptSecret,
	deleteUserbotMessage,
	drainOutboundMessages,
	getUserPresence,
	listenForMessages,
	listenForUserPresence,
	resolveClientPhoneNumber,
	resolveClientUsername,
	sendUserbotMedia,
	sendUserbotMessage,
	setSendResult,
} from "@psi-opora/tg-userbot";

const OUTBOX_POLL_INTERVAL_MS = 3000;
const ACCOUNTS_RESCAN_INTERVAL_MS = 60_000;
const MAX_INBOUND_MEDIA_SIZE = 20 * 1024 * 1024;

/** Скачивает вложение, загруженное оператором (apps/clients/api/attachments)
 * в bot/media/outbound/ — тот же бакет, что и остальное S3-хранилище, здесь
 * своя копия вместо импорта из packages/api, т.к. воркер не тянет весь oRPC-
 * роутер ради одной функции (см. apps/bitrix-webhook/src/media-storage.ts —
 * тот же приём для голосовых WhatsApp). */
async function downloadOutboundAttachment(s3Key: string): Promise<Uint8Array> {
	const { client, bucket } = await createS3Client();
	const { stream } = await getObjectStream({ client, bucket, key: s3Key });
	const buffer = await new Response(stream).arrayBuffer();
	return new Uint8Array(buffer);
}

/** Заливает фото/файл, полученный от клиента по MTProto, в наше S3 — тот же
 * bot/media/ префикс, что и у остальных каналов (см. apps/bitrix-webhook/src/
 * media-storage.ts, apps/max-bot/src/avatar-storage.ts). */
async function uploadInboundMedia(params: {
	bytes: Uint8Array;
	contentType: string;
	fileName: string;
	messageId: string;
}): Promise<{ mediaS3Key: string }> {
	const { client, bucket } = await createS3Client();
	const safeName = params.fileName.replace(/[^\p{L}\p{N}._-]+/gu, "_");
	const key = `bot/media/telegram-personal/${params.messageId}-${crypto.randomUUID()}-${safeName}`;
	await uploadObject({
		client,
		bucket,
		key,
		body: params.bytes,
		contentType: params.contentType,
	});
	return { mediaS3Key: key };
}

async function saveTelegramPresence(
	presence: {
		userId: number;
		status: string;
		lastOnline: Date | null;
	},
	onlyExisting = false,
): Promise<void> {
	const save = onlyExisting
		? updateExistingBotUserPresence
		: upsertBotUserPresence;
	await save({
		messenger: "telegram-personal",
		userId: String(presence.userId),
		status: presence.status,
		lastSeenAt: presence.lastOnline,
	});
}

function accountLabel(account: TelegramPersonalAccount): string {
	return `${account.memberId}:${account.openLineId} (${account.phone})`;
}

/**
 * Журналирует входящее сообщение личного номера в bot_messages/bot_users —
 * без этого единый инбокс дашборда (apps/clients) видел бы только реплики,
 * отправленные из него самого, без единого сообщения от клиента. Не
 * блокирует пересылку в Открытую линию при сбое — только логируется.
 */
async function logInboundMessage(
	senderId: number,
	text: string,
	connectorId: string,
	profile: {
		firstName?: string;
		lastName?: string;
		username?: string | null;
		isPremium?: boolean;
	},
	media?: {
		kind: "image" | "file";
		mediaS3Key: string;
		mediaMimeType?: string;
		mediaFileName?: string;
	},
): Promise<void> {
	const userId = String(senderId);
	try {
		await upsertBotUser({
			messenger: "telegram-personal",
			userId,
			firstName: profile.firstName,
			lastName: profile.lastName,
			username: profile.username ?? undefined,
			isPremium: profile.isPremium,
		});
		await insertBotMessage({
			messenger: "telegram-personal",
			userId,
			direction: "in",
			source: "scenario",
			text,
			connectorId,
			...media,
		});
	} catch (err) {
		console.error(
			`[tg-userbot-worker] не удалось записать входящее сообщение в журнал: ${(err as Error).message}`,
		);
	}
}

/**
 * Дублирует входящее сообщение личного аккаунта в Открытую линию через
 * imconnector.send.messages — CONNECTOR/LINE берутся из самой записи
 * аккаунта (не из env, как у бота: у каждого личного номера своя линия).
 *
 * `user.phone`, когда он виден (не скрыт настройками приватности
 * отправителя), передаём отдельно от `user.id` — по нему CRM-трекер
 * Bitrix ищет и привязывает существующий контакт/лид вместо создания
 * нового «неопознанного» на каждое сообщение (см. «Каждый чат открытых
 * линий связан с объектом CRM» в документации imopenlines).
 */
async function relayInboundMessage(
	account: TelegramPersonalAccount,
	senderId: number,
	senderPhone: string | null,
	chatId: number,
	text: string,
): Promise<void> {
	const api = resolveBitrixApi(account.memberId);
	if (!api) return;

	try {
		await api.call("imconnector.send.messages", {
			CONNECTOR: account.connectorId,
			LINE: Number(account.openLineId),
			MESSAGES: [
				{
					user: {
						id: String(senderId),
						...(senderPhone ? { phone: senderPhone } : {}),
						skip_phone_validate: "Y",
					},
					message: {
						id: `tg-personal-${senderId}-${Date.now()}`,
						date: Math.floor(Date.now() / 1000),
						text,
					},
					chat: { id: String(chatId), name: `Telegram #${senderId}` },
				},
			],
		});
	} catch (err) {
		console.error(
			`[tg-userbot-worker] не удалось переслать сообщение в Открытую линию (${accountLabel(account)}): ${(err as Error).message}`,
		);
	}
}

/**
 * Раз в OUTBOX_POLL_INTERVAL_MS вычитывает очередь для этого номера (см.
 * packages/tg-userbot/src/outbox.ts) и отправляет через уже живой
 * MTProto-клиент. Три варианта адресации задачи (по приоритету):
 * 1. telegramUserId уже известен — либо ответ оператора на существующий
 *    диалог (продюсер apps/bitrix-webhook), либо готовый числовой ID из CRM;
 *    передаётся клиенту как есть, mtcute резолвит сам по своему кэшу пиров.
 * 2. phone — первое сообщение клиенту, у которого в CRM есть номер
 *    телефона; резолвится в Telegram-пира через resolveClientPhoneNumber.
 * 3. telegramUsername — то же самое, но по username, когда телефона в CRM
 *    нет; резолвится через resolveClientUsername.
 * Результат каждой задачи пишется в Redis (setSendResult) — так дашборд
 * может дождаться ответа синхронно.
 */
function startOutboxPolling(
	account: TelegramPersonalAccount,
	client: Awaited<ReturnType<typeof createUserbotClient>>,
): void {
	setInterval(async () => {
		const messages = await drainOutboundMessages(
			account.memberId,
			account.openLineId,
			account.connectorId,
		);
		for (const msg of messages) {
			try {
				let target:
					| number
					| Awaited<ReturnType<typeof resolveClientPhoneNumber>>;
				if (msg.telegramUserId) {
					target = msg.telegramUserId;
				} else if (msg.phone) {
					target = await resolveClientPhoneNumber(client, msg.phone);
				} else if (msg.telegramUsername) {
					target = await resolveClientUsername(client, msg.telegramUsername);
				} else {
					throw new Error(
						"В задаче нет ни telegramUserId, ни phone, ни telegramUsername",
					);
				}
				if (msg.action === "delete") {
					if (!msg.externalId) {
						throw new Error("В задаче удаления нет externalId сообщения");
					}
					await deleteUserbotMessage(client, target, msg.externalId);
					await setSendResult(msg.jobId, { ok: true });
					continue;
				}
				if (!msg.text && !msg.attachment) {
					throw new Error("В задаче отправки нет ни текста, ни вложения");
				}
				const externalId = msg.attachment
					? await sendUserbotMedia(
							client,
							target,
							{
								bytes: await downloadOutboundAttachment(msg.attachment.s3Key),
								fileName: msg.attachment.fileName,
								mimeType: msg.attachment.mimeType,
								kind: msg.attachment.kind,
							},
							msg.text || undefined,
						)
					: await sendUserbotMessage(client, target, msg.text ?? "");
				if (msg.journalMessageId) {
					await updateBotMessageExternalResult(
						msg.journalMessageId,
						externalId,
						"sent",
					);
				}
				const telegramUserId =
					typeof target === "number"
						? target
						: "userId" in target && typeof target.userId === "number"
							? target.userId
							: undefined;
				if (telegramUserId !== undefined) {
					const presence = await getUserPresence(client, target).catch(
						() => null,
					);
					if (presence) {
						await saveTelegramPresence(presence).catch((err) =>
							console.error(
								`[tg-userbot-worker] не удалось сохранить presence ${telegramUserId}: ${(err as Error).message}`,
							),
						);
						// Первые исходящие диалоги могут пока быть ключованы телефоном
						// или username. Сохраняем тот же снимок и под исходным ключом,
						// чтобы presence сразу появился в уже открытой карточке.
						const originalUserId = msg.phone ?? msg.telegramUsername;
						if (originalUserId) {
							await upsertBotUserPresence({
								messenger: "telegram-personal",
								userId: originalUserId,
								status: presence.status,
								lastSeenAt: presence.lastOnline,
							}).catch(() => {});
						}
					}
				}
				await setSendResult(msg.jobId, {
					ok: true,
					...(telegramUserId !== undefined
						? { telegramUserId: String(telegramUserId) }
						: {}),
					externalId,
				});
			} catch (err) {
				const message = (err as Error).message;
				console.error(
					`[tg-userbot-worker] не удалось отправить сообщение (${accountLabel(account)}): ${message}`,
				);
				if (msg.journalMessageId) {
					await updateBotMessageExternalResult(
						msg.journalMessageId,
						undefined,
						"failed",
					).catch(() => {});
				}
				await setSendResult(msg.jobId, { ok: false, error: message });
			}
		}
	}, OUTBOX_POLL_INTERVAL_MS);
}

async function startAccountWorker(
	account: TelegramPersonalAccount,
): Promise<void> {
	const label = accountLabel(account);

	if (!account.sessionEncrypted) {
		console.error(`[tg-userbot-worker] нет сохранённой сессии: ${label}`);
		return;
	}

	try {
		const session = decryptSecret(account.sessionEncrypted);
		const apiHash = decryptSecret(account.apiHashEncrypted);
		const client = await createUserbotClient(session, {
			apiId: Number(account.apiId),
			apiHash,
		});

		listenForUserPresence(client, (presence) =>
			saveTelegramPresence(presence, true).catch((err) =>
				console.error(
					`[tg-userbot-worker] не удалось обновить presence ${presence.userId}: ${(err as Error).message}`,
				),
			),
		);

		listenForMessages(client, async (message) => {
			const caption = message.text;
			// Фото/документ/видео — перезаливаем в наше S3, чтобы инбокс «Клиенты»
			// показывал превью/ссылку на скачивание, а не молчал (голосовые для
			// этого канала пока не перезаливаются — не было запроса на них).
			const media = message.media;
			const mediaKind =
				media?.type === "photo"
					? "image"
					: media?.type === "document" || media?.type === "video"
						? "file"
						: undefined;
			let mediaUpload:
				| {
						kind: "image" | "file";
						mediaS3Key: string;
						mediaMimeType?: string;
						mediaFileName?: string;
				  }
				| undefined;
			if (
				media?.type === "photo" ||
				media?.type === "document" ||
				media?.type === "video"
			) {
				const kind = media.type === "photo" ? "image" : "file";
				try {
					if (
						media.fileSize !== undefined &&
						media.fileSize > MAX_INBOUND_MEDIA_SIZE
					) {
						throw new Error("Вложение больше 20 МБ");
					}
					const chunks: Uint8Array[] = [];
					let downloadedSize = 0;
					const downloadController = new AbortController();
					for await (const chunk of client.downloadAsIterable(media, {
						limit: MAX_INBOUND_MEDIA_SIZE + 1,
						abortSignal: downloadController.signal,
					})) {
						downloadedSize += chunk.byteLength;
						if (downloadedSize > MAX_INBOUND_MEDIA_SIZE) {
							downloadController.abort();
							throw new Error("Вложение больше 20 МБ");
						}
						chunks.push(chunk);
					}
					const bytes = Buffer.concat(chunks, downloadedSize);
					const mimeType =
						"mimeType" in media
							? media.mimeType
							: kind === "image"
								? "image/jpeg"
								: undefined;
					const fileName =
						"fileName" in media && media.fileName
							? media.fileName
							: `${media.type}.${kind === "image" ? "jpg" : "bin"}`;
					const uploaded = await uploadInboundMedia({
						bytes,
						contentType: mimeType || "application/octet-stream",
						fileName,
						messageId: String(message.id),
					});
					mediaUpload = {
						kind,
						mediaS3Key: uploaded.mediaS3Key,
						mediaMimeType: mimeType,
						mediaFileName: kind === "file" ? fileName : undefined,
					};
				} catch (err) {
					console.error(
						`[tg-userbot-worker] не удалось перезалить вложение user=${message.sender.id}: ${(err as Error).message}`,
					);
				}
			}
			const text =
				caption || (mediaKind ? (mediaKind === "image" ? "Фото" : "Файл") : "");
			if (!text) return;
			const rawPhone =
				"phoneNumber" in message.sender ? message.sender.phoneNumber : null;
			const senderPhone = rawPhone
				? rawPhone.startsWith("+")
					? rawPhone
					: `+${rawPhone}`
				: null;
			void logInboundMessage(
				message.sender.id,
				text,
				account.connectorId,
				{
					firstName:
						"firstName" in message.sender
							? message.sender.firstName
							: undefined,
					lastName:
						"lastName" in message.sender
							? (message.sender.lastName ?? undefined)
							: undefined,
					username: message.sender.username,
					isPremium:
						"isPremium" in message.sender
							? message.sender.isPremium
							: undefined,
				},
				mediaUpload,
			);
			if (
				"status" in message.sender &&
				typeof message.sender.status === "string"
			) {
				void saveTelegramPresence({
					userId: message.sender.id,
					status: message.sender.status,
					lastOnline:
						"lastOnline" in message.sender &&
						message.sender.lastOnline instanceof Date
							? message.sender.lastOnline
							: null,
				});
			}
			void relayInboundMessage(
				account,
				message.sender.id,
				senderPhone,
				message.chat.id,
				text,
			);
		});

		startOutboxPolling(account, client);
		console.log(`[tg-userbot-worker] запущен: ${label}`);
	} catch (err) {
		const message = (err as Error).message;
		console.error(
			`[tg-userbot-worker] не удалось запустить ${label}: ${message}`,
		);
		await markTelegramPersonalAccountError(
			account.memberId,
			account.openLineId,
			account.connectorId,
			message,
		);
	}
}

/**
 * Периодически перечитывает список подключённых номеров и поднимает
 * клиента для тех, кого ещё не запускали — так новый номер, подключённый
 * уже после старта воркера, подхватывается без перезапуска процесса.
 * Процесс держится живым за счёт этого таймера, даже если номеров пока нет.
 */
async function main(): Promise<void> {
	const started = new Set<string>();

	const scan = async () => {
		const accounts = await listConnectedTelegramPersonalAccounts();
		for (const account of accounts) {
			const key = `${account.memberId}:${account.openLineId}:${account.connectorId}`;
			if (started.has(key)) continue;
			started.add(key);
			void startAccountWorker(account);
		}
	};

	await scan();
	setInterval(scan, ACCOUNTS_RESCAN_INTERVAL_MS);
}

await main();
