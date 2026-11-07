import type { BitrixApi } from "@psi-opora/bitrix-client";
import { resolveBitrixPortalKey } from "@psi-opora/bitrix-client";
import {
	type BotMessage,
	getWhatsappPersonalAccountByConnector,
	listBitrixCrmLinksByContactIds,
	listBotMessages,
	listBotMessagesBefore,
	listMaxPersonalAccounts,
	listTelegramPersonalAccounts,
	listWhatsappPersonalAccounts,
	searchBotMessages,
	setWhatsappPersonalAccountStateBySession,
	upsertBotUserPresence,
} from "@psi-opora/db/queries";
import {
	cancelMaxOutboundMessage,
	getMaxSendResult,
	pushMaxOutboundMessage,
} from "@psi-opora/max-userbot";
import { sendOutboundMessageAndWait } from "@psi-opora/tg-userbot";
import {
	jidFromPhone,
	wahaGetChatPresence,
	wahaGetSession,
	wahaSendFile,
	wahaSendText,
	wahaSessionHealth,
} from "@psi-opora/waha";
import {
	discoverMessengerFields,
	findMaxId,
	findTelegram,
	getContactPhone,
	type MessengerFieldCodes,
	type RawContact,
} from "../../broadcast-send";
import { downloadOutboundAttachment } from "../../message-attachment-storage";
import { signedMediaUrl } from "../messages/types";
import type {
	WidgetChannel,
	WidgetEntity,
	WidgetHistoryItem,
	WidgetMessenger,
} from "./types";

export async function captureWhatsappPresence(
	session: string,
	chatId: string,
): Promise<void> {
	const snapshot = await wahaGetChatPresence(session, chatId);
	const presence =
		snapshot.presences.find((item) => item.participant === chatId) ??
		snapshot.presences[0];
	if (!presence) return;
	await upsertBotUserPresence({
		messenger: "whatsapp-personal",
		userId: chatId,
		status: presence.lastKnownPresence,
		lastSeenAt:
			presence.lastSeen == null ? null : new Date(presence.lastSeen * 1000),
	});
}

/**
 * Личный номер (в отличие от бота) не держит соединение в этом процессе —
 * задача уходит в очередь always-on воркера (apps/tg-userbot-worker), а
 * результат (резолв Telegram-пира + сама отправка) ждём здесь коротким
 * поллингом, чтобы вернуть внятный ответ вызывающему, а не «повесить» кнопку.
 * Используется и вкладкой CRM (send.ts), и единым инбоксом
 * (packages/api/src/routers/messages/send.ts).
 */
export async function sendViaPersonalNumber(params: {
	memberId: string;
	openLineId: string;
	connectorId: string;
	target: { kind: "phone" | "username" | "id"; value: string };
	text: string;
	attachment?: {
		s3Key: string;
		fileName: string;
		mimeType: string;
		kind: "image" | "file" | "voice";
	};
}): Promise<{
	ok?: true;
	error?: string;
	telegramUserId?: string;
	externalId?: string;
}> {
	const result = await sendOutboundMessageAndWait({
		memberId: params.memberId,
		openLineId: params.openLineId,
		connectorId: params.connectorId,
		jobId: crypto.randomUUID(),
		...(params.target.kind === "phone" ? { phone: params.target.value } : {}),
		...(params.target.kind === "username"
			? { telegramUsername: params.target.value }
			: {}),
		...(params.target.kind === "id"
			? { telegramUserId: Number(params.target.value) }
			: {}),
		text: params.text,
		...(params.attachment ? { attachment: params.attachment } : {}),
	});

	if (!result) {
		return {
			error:
				"Не удалось дождаться ответа от воркера личного номера — проверьте, что apps/tg-userbot-worker запущен",
		};
	}
	return result.ok
		? {
				ok: true,
				telegramUserId: result.telegramUserId,
				externalId: result.externalId,
			}
		: { error: `Не отправлено: ${result.error ?? "неизвестная ошибка"}` };
}

/**
 * Отправка через личный номер WhatsApp — в отличие от Telegram (личный номер
 * держит соединение в отдельном always-on процессе, apps/tg-userbot-worker),
 * WhatsApp обслуживает контейнер WAHA по REST, поэтому шлём синхронно, без
 * очереди и поллинга результата.
 */
export async function sendViaWhatsappPersonal(params: {
	memberId: string;
	openLineId: string;
	connectorId: string;
	jid: string;
	text: string;
	attachment?: {
		s3Key: string;
		fileName: string;
		mimeType: string;
		kind: "image" | "file" | "voice";
	};
}): Promise<{ ok?: true; error?: string; externalId?: string }> {
	const account = await getWhatsappPersonalAccountByConnector(
		params.connectorId,
		params.openLineId,
	);
	if (!account) return { error: "Личный номер WhatsApp не подключён" };

	try {
		const { id } = params.attachment
			? await wahaSendFile(
					account.sessionName,
					params.jid,
					{
						bytes: await downloadOutboundAttachment(params.attachment.s3Key),
						fileName: params.attachment.fileName,
						mimeType: params.attachment.mimeType,
						kind: params.attachment.kind,
					},
					params.text || undefined,
				)
			: await wahaSendText(account.sessionName, params.jid, params.text);
		await captureWhatsappPresence(account.sessionName, params.jid).catch(
			(err) =>
				console.error(
					`[whatsapp-personal] не удалось получить presence ${params.jid}: ${(err as Error).message}`,
				),
		);
		return { ok: true, externalId: id };
	} catch (err) {
		const health = wahaSessionHealth(
			await wahaGetSession(account.sessionName).catch(() => null),
		);
		if (health.status !== "connected") {
			await setWhatsappPersonalAccountStateBySession(
				account.sessionName,
				health.status,
				health.error,
			).catch(() => {});
		}
		return { error: `Не отправлено: ${(err as Error).message}` };
	}
}

/** Резолв номера в воркере бывает медленным, поэтому ждём дольше, чем при отправке по chatId. */
const MAX_PERSONAL_REPLY_TIMEOUT_MS = 30_000;

/**
 * Личный номер MAX — задача уходит в очередь always-on воркера
 * (apps/max-userbot-worker). Адресуем по телефону: воркер находит контакт и
 * вычисляет ID личного чата, поэтому можно «написать первым». Возвращает
 * chatId — под ним в журнале лягут ответы клиента.
 */
export async function sendViaMaxPersonal(params: {
	memberId: string;
	openLineId: string;
	connectorId: string;
	phone: string;
	text: string;
}): Promise<{
	ok?: true;
	error?: string;
	externalId?: string;
	chatId?: string;
}> {
	const jobId = crypto.randomUUID();
	const message = {
		memberId: params.memberId,
		openLineId: params.openLineId,
		connectorId: params.connectorId,
		jobId,
		phone: params.phone,
		text: params.text,
	};
	await pushMaxOutboundMessage(message);

	// Резолв номера в воркере бывает медленным — ждём дольше, чем при отправке
	// по готовому chatId, а не дождавшись снимаем задачу, чтобы не получить дубль.
	const deadline = Date.now() + MAX_PERSONAL_REPLY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const result = await getMaxSendResult(jobId);
		if (result) {
			return result.ok
				? { ok: true, externalId: result.externalId, chatId: result.chatId }
				: { error: `Не отправлено: ${result.error ?? "неизвестная ошибка"}` };
		}
		await new Promise((resolve) => setTimeout(resolve, 300));
	}
	if (await cancelMaxOutboundMessage(message)) {
		return {
			error:
				"Не удалось дождаться ответа от воркера личного номера MAX — проверьте, что apps/max-userbot-worker запущен",
		};
	}
	return {
		error:
			"Воркер MAX взял сообщение, но не подтвердил отправку — проверьте диалог, прежде чем отправлять повторно",
	};
}

export const HISTORY_LIMIT = 30;

/** Строка журнала → элемент истории вкладки. Медиа раздаются по подписанной
 * ссылке на лету (сырой S3-ключ наружу не уходит), удалённое сообщение
 * показывается заглушкой, как в едином инбоксе. */
export function toWidgetHistoryItem(
	row: BotMessage,
	messenger: WidgetMessenger,
): WidgetHistoryItem {
	const hasMedia = !row.deletedAt && Boolean(row.mediaS3Key);
	return {
		id: row.id,
		messenger,
		connectorId: row.connectorId ?? undefined,
		direction: row.direction === "in" ? "in" : "out",
		source: row.source,
		text: row.deletedAt ? "Сообщение удалено" : row.text,
		kind: row.kind as WidgetHistoryItem["kind"],
		mediaUrl: hasMedia ? signedMediaUrl(row.id) : undefined,
		mediaMimeType: row.mediaMimeType,
		mediaDurationSec: row.mediaDurationSec,
		mediaFileName: row.mediaFileName,
		operatorName: row.operatorName,
		status: row.status,
		createdAt: row.createdAt.toISOString(),
	};
}

/** Все пары (канал, userId диалога) контакта: у личного MAX переписка лежит
 * не под телефоном, а под ID чата (historyUserIds). */
function channelDialogs(
	channels: WidgetChannel[],
): { channel: WidgetChannel; userId: string }[] {
	return channels.flatMap((channel) =>
		[channel.userId, ...(channel.historyUserIds ?? [])].map((userId) => ({
			channel,
			userId,
		})),
	);
}

/**
 * Страница истории по всем каналам контакта (старые выше). Без `before` —
 * последние сообщения, с ним — более старые, чем `before`. hasMore — есть ли
 * ещё что подгружать: либо канал вернул полную страницу, либо после слияния
 * каналов часть строк не поместилась.
 */
export async function loadHistory(
	channels: WidgetChannel[],
	before?: Date,
): Promise<{ items: WidgetHistoryItem[]; hasMore: boolean }> {
	let anyFull = false;
	const perDialog = await Promise.all(
		channelDialogs(channels).map(async ({ channel, userId }) => {
			const rows = await (before
				? listBotMessagesBefore(
						channel.messenger,
						userId,
						before,
						HISTORY_LIMIT,
						channel.connectorId,
					)
				: listBotMessages(
						channel.messenger,
						userId,
						HISTORY_LIMIT,
						channel.connectorId,
					)
			).catch(() => []);
			if (rows.length >= HISTORY_LIMIT) anyFull = true;
			return rows.map((row) => toWidgetHistoryItem(row, channel.messenger));
		}),
	);
	const merged = perDialog
		.flat()
		.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	return {
		items: merged.slice(-HISTORY_LIMIT),
		hasMore: anyFull || merged.length > HISTORY_LIMIT,
	};
}

const SEARCH_LIMIT = 50;

/** Поиск по тексту переписки со всеми каналами контакта — новые первыми. */
export async function searchHistory(
	channels: WidgetChannel[],
	query: string,
): Promise<WidgetHistoryItem[]> {
	const perDialog = await Promise.all(
		channelDialogs(channels).map(async ({ channel, userId }) => {
			const rows = await searchBotMessages(
				channel.messenger,
				userId,
				query,
				SEARCH_LIMIT,
				channel.connectorId,
			).catch(() => []);
			return rows.map((row) => toWidgetHistoryItem(row, channel.messenger));
		}),
	);
	return perDialog
		.flat()
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
		.slice(0, SEARCH_LIMIT);
}

/** Запрос от вкладки к одному элементу CRM: проверка ID, подключение к
 * Битрикс24 и пересчёт каналов контакта. Каналы никогда не принимаются от
 * клиента — иначе можно было бы подставить чужие messenger/userId и прочитать
 * или изменить чужую переписку. */
export async function resolveWidgetContact(
	input: { entity: WidgetEntity; id: string },
	context: {
		memberId: string | null;
		getBitrixApi: () => Promise<BitrixApi | null>;
	},
): Promise<{ contact: ResolvedContact } | { error: string }> {
	if (!/^d+$/.test(input.id)) return { error: "Некорректный ID элемента CRM" };
	const api = await context.getBitrixApi();
	if (!api) {
		return { error: "Нет подключения к Битрикс24 — обновите страницу" };
	}
	try {
		const { contact, error } = await resolveContact(
			api,
			input.entity,
			input.id,
			context.memberId,
		);
		if (error || !contact) {
			return { error: error ?? "Не удалось определить контакт" };
		}
		return { contact };
	} catch (err) {
		return { error: (err as Error).message };
	}
}

export interface ResolvedContact {
	contactId: string;
	contactName: string;
	channels: WidgetChannel[];
	telegramUsername?: string;
}

function maskPhone(phone: string): string {
	if (phone.length <= 6) return phone;
	return `${phone.slice(0, 4)}···${phone.slice(-2)}`;
}

/** ID личных чатов MAX, уже привязанных к контакту (см. persistWidgetCrmLinks). */
async function listMaxPersonalChatIds(
	memberId: string,
	contactId: string,
): Promise<string[]> {
	try {
		const portalKey = await resolveBitrixPortalKey(memberId);
		const links = await listBitrixCrmLinksByContactIds(portalKey, [contactId]);
		return links
			.filter((link) => link.messenger === "max-personal")
			.map((link) => link.userId);
	} catch {
		return [];
	}
}

interface PersonalTarget {
	kind: "phone" | "username" | "id";
	value: string;
}

/**
 * Чем адресовать личный аккаунт при отправке этому контакту: телефон в
 * приоритете (самый надёжный способ «написать первым»), иначе username или
 * готовый числовой ID из полей контакта.
 */
function resolvePersonalTarget(
	contact: RawContact,
	phone: string | undefined,
	messengerFields: MessengerFieldCodes,
): PersonalTarget | undefined {
	if (phone) return { kind: "phone", value: phone };

	const telegram = findTelegram(contact, messengerFields.telegram, {
		includeUf: true,
	});
	if (telegram?.username) return { kind: "username", value: telegram.username };
	if (telegram?.userId) return { kind: "id", value: telegram.userId };
	return undefined;
}

/**
 * Резолвит ID контакта и его каналы из CRM: для сделки сначала берём
 * привязанный контакт. Каналы двух видов:
 * 1. Боты (Telegram/MAX) — только если контакт уже писал (поле IM
 *    «Мессенджер», UF-поля интеграций игнорируются — менеджер видит и
 *    редактирует именно поле Мессенджер).
 * 2. Личные номера Telegram (packages/tg-userbot) — доступны для «написать
 *    первым», независимо от того, писал ли клиент раньше. Адресуем по
 *    первому, что нашлось у контакта: телефон (client.resolvePhoneNumber) →
 *    username (client.resolvePeer/resolveUsername, includeUf — берём и
 *    UF-поля интеграций типа TelegramUsername_WZ, в отличие от бот-канала
 *    выше — MTProto-клиенту, в отличие от Bot API, это доступно) → готовый
 *    числовой Telegram ID (может не резолвиться, если аккаунт никогда не
 *    «видел» этого пользователя — ограничение самого Telegram, не наше).
 *    Один портал может подключить несколько номеров — показываем канал на
 *    каждый подключённый (status="connected"), с номером в подписи.
 * 3. Личные номера WhatsApp (packages/waha) — тоже «написать первым», но
 *    только по телефону: у WhatsApp нет публичных username или устойчивых
 *    числовых ID, которые можно было бы резолвить без предыдущей переписки,
 *    поэтому без телефона в карточке контакта канал не показываем.
 * 4. Личные номера MAX (packages/max-userbot) — тоже по телефону: воркер
 *    находит контакт в MAX и вычисляет ID личного чата (resolveDialogChatId).
 *
 * Используется и для отображения виджета, и для отправки — так отправка
 * никогда не доверяет messenger/userId, присланным из браузера напрямую,
 * а всегда пересчитывает их из актуальных данных CRM.
 */
export async function resolveContact(
	api: BitrixApi,
	entity: WidgetEntity,
	id: string,
	memberId: string | null,
): Promise<{ contact?: ResolvedContact; error?: string }> {
	let contactId = id;
	if (entity === "deal") {
		const deal = await api.call<{ CONTACT_ID?: string | null }>(
			"crm.deal.get",
			{ id },
		);
		contactId = deal?.CONTACT_ID ?? "";
		if (!contactId) {
			return { error: "У сделки нет привязанного контакта" };
		}
	}

	const contact = await api.call<RawContact>("crm.contact.get", {
		id: contactId,
	});
	if (!contact) return { error: "Контакт не найден" };

	// UF-поля интеграций (Wazzup и др.: TelegramId_WZ, TelegramUsername_WZ…)
	// находятся динамически по всем полям контакта — они нужны и для канала
	// бота (числовой ID ниже), и для личного номера (username/ID, см.
	// resolvePersonalTarget). Раньше канал бота их игнорировал, так что
	// исторические контакты, пришедшие через сторонние интеграции (например,
	// старый Wazzup), не получали канал «Telegram»/«MAX» даже при наличии
	// числового ID, с которым бот технически уже может переписываться.
	const messengerFields = await discoverMessengerFields(api).catch(() => ({
		telegram: [],
		max: [],
	}));

	const channels: WidgetChannel[] = [];
	const telegram = findTelegram(contact, messengerFields.telegram);
	if (telegram?.userId) {
		channels.push({
			messenger: "telegram",
			userId: telegram.userId,
			label: "Telegram",
		});
	}
	const maxId = findMaxId(contact, messengerFields.max);
	if (maxId) channels.push({ messenger: "max", userId: maxId, label: "MAX" });

	const phone = getContactPhone(contact);
	if (memberId) {
		const personalAccounts = await listTelegramPersonalAccounts(memberId).catch(
			() => [],
		);
		const connectedAccounts = personalAccounts.filter(
			(account) => account.status === "connected",
		);
		if (connectedAccounts.length) {
			const personalTarget = resolvePersonalTarget(
				contact,
				phone,
				messengerFields,
			);
			if (personalTarget) {
				for (const account of connectedAccounts) {
					channels.push({
						messenger: "telegram-personal",
						userId: personalTarget.value,
						personalTargetKind: personalTarget.kind,
						lineId: account.openLineId,
						connectorId: account.connectorId,
						label: `Telegram (личный, ${maskPhone(account.phone)})`,
					});
				}
			}
		}

		if (phone) {
			const whatsappAccounts = await listWhatsappPersonalAccounts(
				memberId,
			).catch(() => []);
			const jid = jidFromPhone(phone);
			for (const account of whatsappAccounts.filter(
				(a) => a.status === "connected",
			)) {
				channels.push({
					messenger: "whatsapp-personal",
					userId: jid,
					lineId: account.openLineId,
					connectorId: account.connectorId,
					label: `WhatsApp (личный, ${maskPhone(account.phone)})`,
				});
			}

			// MAX личный — как WhatsApp, только по телефону: воркер сам находит
			// контакт в MAX. Известные ID личных чатов (из CRM-связей, которые
			// пишет send) нужны лишь для истории переписки.
			const maxAccounts = (
				await listMaxPersonalAccounts(memberId).catch(() => [])
			).filter((a) => a.status === "connected");
			if (maxAccounts.length) {
				const chatIds = await listMaxPersonalChatIds(memberId, contactId);
				for (const account of maxAccounts) {
					channels.push({
						messenger: "max-personal",
						userId: phone,
						historyUserIds: chatIds.filter((chatId) => chatId !== phone),
						lineId: account.openLineId,
						connectorId: account.connectorId,
						label: `MAX (личный, ${maskPhone(account.phone)})`,
					});
				}
			}
		}
	}

	return {
		contact: {
			contactId,
			contactName:
				[contact.NAME, contact.LAST_NAME].filter(Boolean).join(" ") ||
				`Контакт #${contactId}`,
			channels,
			telegramUsername: telegram?.username,
		},
	};
}
