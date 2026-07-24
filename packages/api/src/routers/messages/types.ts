import type { MessageDeliveryStatus } from "@psi-opora/db/queries";
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
}
