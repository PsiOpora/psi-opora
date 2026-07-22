import type { Messenger } from "@psi-opora/jobs";

/** "telegram-personal" — личный номер (packages/tg-userbot), а не бот:
 * доступен по номеру телефона контакта даже без предыдущей переписки. */
export type WidgetMessenger = Messenger | "telegram-personal";

export interface WidgetChannel {
  messenger: WidgetMessenger;
  /** Для ботов — числовой ID пользователя в мессенджере. Для
   * telegram-personal — идентификатор контакта, по которому воркер
   * резолвит Telegram-пира перед первой отправкой (вид см. personalTargetKind):
   * телефон (цифры), username или готовый числовой Telegram ID. */
  userId: string;
  /** Только для telegram-personal — как трактовать userId при резолве:
   * "phone" (по умолчанию, если поле не задано) — client.resolvePhoneNumber,
   * "username" — client.resolvePeer/resolveUsername, "id" — готовый
   * числовой Telegram ID передаётся клиенту без резолва. */
  personalTargetKind?: "phone" | "username" | "id";
  /** Только для telegram-personal — линия конкретного личного номера
   * (packages/db telegram_personal_accounts.openLineId). */
  lineId?: string;
  /** Подпись кнопки канала — для telegram-personal включает номер
   * (может быть несколько личных номеров на портал). */
  label: string;
}

export interface WidgetHistoryItem {
  id: string;
  messenger: WidgetMessenger;
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
