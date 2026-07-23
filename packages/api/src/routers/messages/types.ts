import type { Messenger } from "@psi-opora/jobs";

/** "telegram-personal" — личный номер (packages/tg-userbot), а не бот. */
export type InboxMessenger = Messenger | "telegram-personal";

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
  assignedOperatorId: string | null;
  assignedOperatorName: string | null;
  tags: string[];
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
  createdAt: string;
}
