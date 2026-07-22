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
}

export interface ClientMessageItem {
  id: string;
  direction: "in" | "out";
  source: string;
  text: string;
  operatorId: string | null;
  createdAt: string;
}
