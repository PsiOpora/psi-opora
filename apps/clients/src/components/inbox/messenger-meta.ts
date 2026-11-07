import type { InboxMessenger } from "@psi-opora/api";

/** Цветовой акцент канала. Классы записаны целиком, чтобы Tailwind их
 * не вырезал; бот и личный номер одного мессенджера делят цвет — различает
 * их подпись («бот» / «личный номер»), а не оттенок. */
interface ChannelAccent {
	/** Заливка, рамка и текст бейджа. */
	chip: string;
	/** Рамка выбранной карточки канала. */
	selected: string;
	/** Верхняя кромка поля ввода — цвет канала, куда уйдёт ответ. */
	edge: string;
	/** Текст акцента без заливки. */
	text: string;
}

const SKY: ChannelAccent = {
	chip: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
	selected: "border-sky-500 bg-sky-500/10 ring-1 ring-sky-500/40",
	edge: "border-t-sky-500",
	text: "text-sky-700 dark:text-sky-300",
};
const VIOLET: ChannelAccent = {
	chip: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
	selected: "border-violet-500 bg-violet-500/10 ring-1 ring-violet-500/40",
	edge: "border-t-violet-500",
	text: "text-violet-700 dark:text-violet-300",
};
const GREEN: ChannelAccent = {
	chip: "border-green-600/30 bg-green-600/10 text-green-700 dark:text-green-300",
	selected: "border-green-600 bg-green-600/10 ring-1 ring-green-600/40",
	edge: "border-t-green-600",
	text: "text-green-700 dark:text-green-300",
};

/** Подписи и цвета каналов — единые для списка, треда и карточки клиента. */
export const MESSENGER_META: Record<
	InboxMessenger,
	{
		label: string;
		short: string;
		dotClassName: string;
		/** Только название мессенджера, без «(личный)». */
		name: string;
		/** Чем именно пишем: официальный бот или личный номер. */
		kind: "bot" | "personal";
		accent: ChannelAccent;
	}
> = {
	telegram: {
		label: "Telegram",
		short: "TG",
		dotClassName: "bg-sky-500",
		name: "Telegram",
		kind: "bot",
		accent: SKY,
	},
	max: {
		label: "MAX",
		short: "MAX",
		dotClassName: "bg-violet-500",
		name: "MAX",
		kind: "bot",
		accent: VIOLET,
	},
	"telegram-personal": {
		label: "Telegram (личный)",
		short: "TG личный",
		dotClassName: "bg-sky-600",
		name: "Telegram",
		kind: "personal",
		accent: SKY,
	},
	"whatsapp-personal": {
		label: "WhatsApp",
		short: "WhatsApp",
		dotClassName: "bg-green-600",
		name: "WhatsApp",
		kind: "personal",
		accent: GREEN,
	},
	"max-personal": {
		label: "MAX (личный)",
		short: "MAX личный",
		dotClassName: "bg-violet-600",
		name: "MAX",
		kind: "personal",
		accent: VIOLET,
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

export function messengerMeta(messenger: string) {
	return MESSENGER_META[messenger as InboxMessenger];
}

export function clientKey(messenger: string, userId: string): string {
	return `${messenger}:${userId}`;
}

/** Ключ «канала переписки»: мессенджер + номер. Два личных номера одного
 * мессенджера — разные каналы, даже если клиент у них один и тот же. */
export function conversationKey(
	messenger: string,
	connectorId: string | undefined | null,
): string {
	// У ботов connectorId в журнале может быть заполнен, но канал у бота один —
	// номер учитываем только у личных аккаунтов.
	const isPersonal = messenger.endsWith("-personal");
	return `${messenger}:${isPersonal ? (connectorId ?? "") : ""}`;
}

/** Сводка по каналу, посчитанная по истории: писал ли клиент сюда и когда. */
export interface ChannelActivity {
	lastInboundAt: string | null;
	lastAt: string | null;
}

export function summarizeChannelActivity(
	channels: { messenger: string; connectorId?: string }[],
	history: {
		messenger?: string;
		connectorId?: string | null;
		direction: string;
		createdAt: string;
	}[],
): Map<string, ChannelActivity> {
	const result = new Map<string, ChannelActivity>();
	for (const channel of channels) {
		result.set(conversationKey(channel.messenger, channel.connectorId), {
			lastInboundAt: null,
			lastAt: null,
		});
	}
	for (const item of history) {
		if (!item.messenger) continue;
		const entry = result.get(conversationKey(item.messenger, item.connectorId));
		if (!entry) continue;
		if (!entry.lastAt || item.createdAt > entry.lastAt) {
			entry.lastAt = item.createdAt;
		}
		if (
			item.direction === "in" &&
			(!entry.lastInboundAt || item.createdAt > entry.lastInboundAt)
		) {
			entry.lastInboundAt = item.createdAt;
		}
	}
	return result;
}
