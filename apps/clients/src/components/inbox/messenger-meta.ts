import type { InboxMessenger } from "@psi-opora/api";

/** Подписи и цвета каналов — единые для списка, треда и карточки клиента. */
export const MESSENGER_META: Record<
	InboxMessenger,
	{ label: string; short: string; dotClassName: string }
> = {
	telegram: { label: "Telegram", short: "TG", dotClassName: "bg-sky-500" },
	max: { label: "MAX", short: "MAX", dotClassName: "bg-violet-500" },
	"telegram-personal": {
		label: "Telegram (личный)",
		short: "TG личный",
		dotClassName: "bg-emerald-500",
	},
	"whatsapp-personal": {
		label: "WhatsApp",
		short: "WhatsApp",
		dotClassName: "bg-green-600",
	},
	"max-personal": {
		label: "MAX (личный)",
		short: "MAX личный",
		dotClassName: "bg-purple-600",
	},
};

export const MESSENGER_ORDER: InboxMessenger[] = [
	"telegram",
	"max",
	"telegram-personal",
	"whatsapp-personal",
	"max-personal",
];

export function messengerLabel(messenger: string): string {
	return MESSENGER_META[messenger as InboxMessenger]?.label ?? messenger;
}

export function clientKey(messenger: string, userId: string): string {
	return `${messenger}:${userId}`;
}
