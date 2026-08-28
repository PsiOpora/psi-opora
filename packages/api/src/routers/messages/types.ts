import { createMessageMediaSignature } from "@psi-opora/bitrix-client";
import { env } from "@psi-opora/config";
import type { BotMessage, MessageDeliveryStatus } from "@psi-opora/db/queries";
import type { Messenger } from "@psi-opora/jobs";

export type { MessageDeliveryStatus };

/** "telegram-personal"/"whatsapp-personal" — личные номера
 * (packages/tg-userbot, packages/waha), а не боты. */
export type InboxMessenger =
	| Messenger
	| "telegram-personal"
	| "whatsapp-personal"
	| "max-personal";

export interface ClientListItem {
	messenger: InboxMessenger;
	userId: string;
	name: string;
	username: string | null;
	avatarUrl: string | null;
	lastMessageText: string;
	lastMessageDirection: "in" | "out";
	lastMessageAt: string;
	unread: boolean;
	/** Число непрочитанных входящих — бейдж-кружок в списке, как в Wazzup. */
	unreadCount: number;
	assignedOperatorId: string | null;
	assignedOperatorName: string | null;
	tags: string[];
	/** Остальные каналы, объединённые с этим клиентом (см. merge.ts) — пусто,
	 * если клиент ни с кем не объединён. */
	linkedChannels: InboxMessenger[];
}

export interface CrmContactLink {
	id: string;
	name: string;
	/** null — домен портала неизвестен (нет ни OAuth-сессии, ни вебхука). */
	url: string | null;
}

export interface CrmLeadLink {
	id: string;
	title: string;
	url: string | null;
}

export interface CrmDealLink {
	id: string;
	title: string;
	stageName: string | null;
	opportunity: string | null;
	currencyId: string | null;
	closed: boolean;
	url: string | null;
}

export interface CrmLinksResult {
	contact: CrmContactLink | null;
	lead: CrmLeadLink | null;
	deals: CrmDealLink[];
	error?: string;
}

export interface ClientNoteItem {
	id: string;
	text: string;
	operatorId: string | null;
	operatorName: string | null;
	createdAt: string;
}

export interface QuickReplyItem {
	id: string;
	title: string;
	text: string;
}

/** Одна выдача материала клиенту со всей его судьбой (bot_guide_deliveries). */
export interface ClientGuideItem {
	campaignId: string;
	/** Тема кампании; «Материал», если кампанию удалили. */
	title: string;
	deliveredAt: string;
	email: string | null;
	/** null — письма не было или отправка упала. */
	emailSentAt: string | null;
	/** null — клиент ещё не открывал файл по ссылке из чата. */
	firstOpenedAt: string | null;
	lastOpenedAt: string | null;
	openCount: number;
	followUpSentAt: string | null;
	diagnosticRequestedAt: string | null;
}

export interface ClientProfile {
	messenger: InboxMessenger;
	userId: string;
	/** Каноническая identity клиента — обычно совпадает с messenger/userId,
	 * но если запрос пришёл по устаревшей ссылке на уже объединённый канал
	 * (см. merge.ts), указывает на актуального primary-клиента: фронт по
	 * этим полям редиректит выбранный диалог. */
	canonicalMessenger: InboxMessenger;
	canonicalUserId: string;
	/** Остальные каналы, объединённые с этим клиентом. */
	linkedIdentities: { messenger: InboxMessenger; userId: string }[];
	firstName: string | null;
	lastName: string | null;
	name: string | null;
	username: string | null;
	languageCode: string | null;
	isPremium: boolean | null;
	bio: string | null;
	avatarUrl: string | null;
	/** UTM первого обращения. */
	source: string | null;
	campaign: string | null;
	firstSeenAt: string | null;
	presenceStatus: string | null;
	messengerLastSeenAt: string | null;
	presenceObservedAt: string | null;
	lastSeenAt: string | null;
	stats: {
		totalCount: number;
		inCount: number;
		outCount: number;
		firstMessageAt: string | null;
		lastMessageAt: string | null;
	};
}

export interface ClientMessageItem {
	id: string;
	direction: "in" | "out";
	source: string;
	text: string;
	operatorId: string | null;
	operatorName: string | null;
	status: MessageDeliveryStatus;
	createdAt: string;
	updatedAt: string;
	editedAt: string | null;
	deletedAt: string | null;
	/** Можно ли текущему оператору изменить это сообщение во внешнем боте. */
	canEdit: boolean;
	/** Можно ли текущему оператору отозвать сообщение у клиента. */
	canDelete: boolean;
	/** "voice"/"image"/"file" — mediaUrl ведёт на раздающий роут
	 * apps/dashboard/api/message-media. */
	kind: "text" | "voice" | "image" | "file";
	mediaUrl?: string;
	mediaMimeType?: string | null;
	mediaDurationSec?: number | null;
	/** Исходное имя файла (kind="file"/"image") — для подписи под вложением. */
	mediaFileName?: string | null;
	/** Только для telegram-personal/whatsapp-personal — каким из нескольких
	 * личных номеров портала отправлено/получено сообщение (см.
	 * bot_messages.connector_id). */
	connectorId: string | null;
	/** Когда гайд-PDF из этого сообщения был продублирован клиенту на email —
	 * null, если письмо сценарием не предусмотрено или не отправилось. */
	guideEmailSentAt: string | null;
}

/** Формирует публичный URL для аватара, который уже загружен в S3. */
export function createAvatarUrl(
	messenger: string,
	userId: string,
	hasAvatar: boolean,
): string | null {
	if (!hasAvatar) return null;
	const path = `/api/avatar-file/${encodeURIComponent(messenger)}/${encodeURIComponent(userId)}`;
	return new URL(path, env.APP_URL).toString();
}

/** Общий маппинг строки bot_messages → ClientMessageItem для thread.ts/poll.ts.
 * mediaUrl строится на лету по id сообщения — сырой S3-ключ наружу не отдаётся. */
export function toClientMessageItem(
	row: BotMessage,
	currentOperatorId?: string,
): ClientMessageItem {
	const mediaUrl =
		!row.deletedAt && row.mediaS3Key ? signedMediaUrl(row.id) : undefined;
	const ownedByCurrentOperator =
		row.operatorId === currentOperatorId ||
		(row.operatorId === null && row.source === "widget");
	const isSupportedMessenger =
		row.messenger === "telegram" ||
		row.messenger === "max" ||
		row.messenger === "telegram-personal" ||
		row.messenger === "whatsapp-personal" ||
		row.messenger === "max-personal";
	const isWithinTelegramDeleteWindow =
		row.messenger !== "telegram" ||
		Date.now() - row.createdAt.getTime() < 48 * 60 * 60 * 1000;
	const hasTelegramPersonalTarget =
		row.messenger !== "telegram-personal" ||
		Boolean(row.externalChatId) ||
		/^\d+$/.test(row.userId);
	return {
		id: row.id,
		direction: row.direction as "in" | "out",
		source: row.source,
		text: row.deletedAt ? "Сообщение удалено" : row.text,
		operatorId: row.operatorId,
		operatorName: row.operatorName,
		status: row.status as MessageDeliveryStatus,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
		editedAt: row.editedAt?.toISOString() ?? null,
		deletedAt: row.deletedAt?.toISOString() ?? null,
		canEdit:
			!row.deletedAt &&
			row.direction === "out" &&
			row.kind === "text" &&
			ownedByCurrentOperator &&
			Boolean(row.externalId) &&
			(row.messenger === "telegram" ||
				(row.messenger === "max" &&
					Date.now() - row.createdAt.getTime() < 7 * 24 * 60 * 60 * 1000)),
		canDelete:
			!row.deletedAt &&
			row.direction === "out" &&
			ownedByCurrentOperator &&
			Boolean(row.externalId) &&
			isSupportedMessenger &&
			isWithinTelegramDeleteWindow &&
			hasTelegramPersonalTarget,
		kind: row.kind as "text" | "voice" | "image" | "file",
		mediaUrl,
		mediaMimeType: row.mediaMimeType,
		mediaDurationSec: row.mediaDurationSec,
		mediaFileName: row.mediaFileName,
		connectorId: row.connectorId,
		guideEmailSentAt: row.guideEmailSentAt?.toISOString() ?? null,
	};
}

function signedMediaUrl(messageId: string): string {
	const { expires, signature } = createMessageMediaSignature(messageId);
	const url = new URL(`/api/message-media/${messageId}`, env.APP_URL);
	url.searchParams.set("expires", String(expires));
	url.searchParams.set("signature", signature);
	return url.toString();
}
