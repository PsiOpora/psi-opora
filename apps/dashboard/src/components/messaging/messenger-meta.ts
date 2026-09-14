import type { WidgetMessenger } from "@psi-opora/api";

/** Подписи каналов во вкладке «Мессенджер» карточки CRM — тот же набор
 * мессенджеров, что и в WidgetChannel/WidgetHistoryItem. */
export const MESSENGER_LABELS: Record<WidgetMessenger, string> = {
	telegram: "Telegram",
	max: "MAX",
	"telegram-personal": "Telegram (личный)",
	"whatsapp-personal": "WhatsApp",
};

export function messengerLabel(messenger: string): string {
	return MESSENGER_LABELS[messenger as WidgetMessenger] ?? messenger;
}
