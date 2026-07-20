import type { Messenger } from "@psi-opora/jobs";

export interface WidgetChannel {
  messenger: Messenger;
  userId: string;
}

export interface WidgetHistoryItem {
  id: string;
  messenger: Messenger;
  direction: "in" | "out";
  source: string;
  text: string;
  /** ISO-строка — Date не сериализуется через границу server action. */
  createdAt: string;
}

export interface WidgetRecipient {
  contactId: string;
  contactName: string;
  channels: WidgetChannel[];
  /** Последние сообщения диалога (старые выше). */
  history: WidgetHistoryItem[];
  /** Пояснение, почему отправка недоступна (например, только username). */
  note?: string;
}

export type WidgetEntity = "deal" | "contact";
