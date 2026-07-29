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
  | "whatsapp-personal";

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

export interface ClientProfile {
  messenger: InboxMessenger;
  userId: string;
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
  /** Можно ли текущему оператору изменить это сообщение во внешнем боте. */
  canEdit: boolean;
  /** "voice" — mediaUrl ведёт на раздающий роут apps/dashboard/api/message-media. */
  kind: "text" | "voice";
  mediaUrl?: string;
  mediaMimeType?: string | null;
  mediaDurationSec?: number | null;
  /** Только для telegram-personal/whatsapp-personal — каким из нескольких
   * личных номеров портала отправлено/получено сообщение (см.
   * bot_messages.connector_id). */
  connectorId: string | null;
}

/** Общий маппинг строки bot_messages → ClientMessageItem для thread.ts/poll.ts.
 * mediaUrl строится на лету по id сообщения — сырой S3-ключ наружу не отдаётся. */
export function toClientMessageItem(
  row: BotMessage,
  currentOperatorId?: string,
): ClientMessageItem {
  const mediaUrl = row.mediaS3Key ? signedMediaUrl(row.id) : undefined;
  return {
    id: row.id,
    direction: row.direction as "in" | "out",
    source: row.source,
    text: row.text,
    operatorId: row.operatorId,
    operatorName: row.operatorName,
    status: row.status as MessageDeliveryStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    canEdit:
      row.direction === "out" &&
      row.kind === "text" &&
      row.operatorId === currentOperatorId &&
      Boolean(row.externalId) &&
      (row.messenger === "telegram" ||
        (row.messenger === "max" &&
          Date.now() - row.createdAt.getTime() < 7 * 24 * 60 * 60 * 1000)),
    kind: row.kind as "text" | "voice",
    mediaUrl,
    mediaMimeType: row.mediaMimeType,
    mediaDurationSec: row.mediaDurationSec,
    connectorId: row.connectorId,
  };
}

function signedMediaUrl(messageId: string): string {
  const { expires, signature } = createMessageMediaSignature(messageId);
  const url = new URL(`/api/message-media/${messageId}`, env.APP_URL);
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("signature", signature);
  return url.toString();
}
