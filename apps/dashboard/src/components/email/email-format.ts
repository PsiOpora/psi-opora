export function formatDateTime(date: Date | string | null | undefined): string {
	if (!date) return "—";
	return new Intl.DateTimeFormat("ru-RU", {
		dateStyle: "short",
		timeStyle: "short",
	}).format(new Date(date));
}

/** Доля в процентах с одним знаком; «—», если знаменатель нулевой. */
export function formatRate(part: number, total: number): string {
	if (total <= 0) return "—";
	const value = (part / total) * 100;
	return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;
}

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

/** Статусы получателя рассылки (email_campaign_recipients.status). */
export const RECIPIENT_STATUS: Record<
	string,
	{ label: string; variant: BadgeVariant; className?: string }
> = {
	pending: { label: "В очереди", variant: "secondary" },
	skipped: { label: "Пропущен", variant: "outline" },
	imported: { label: "Передан провайдеру", variant: "secondary" },
	sent: { label: "Отправлено", variant: "secondary" },
	delivered: {
		label: "Доставлено",
		variant: "outline",
		className: "border-sky-500/50 text-sky-700 dark:text-sky-400",
	},
	opened: {
		label: "Открыто",
		variant: "outline",
		className: "border-emerald-500/50 text-emerald-700 dark:text-emerald-400",
	},
	clicked: {
		label: "Переход по ссылке",
		variant: "default",
		className: "bg-emerald-600 text-white hover:bg-emerald-600",
	},
	bounced: { label: "Не доставлено", variant: "destructive" },
	complained: { label: "Жалоба на спам", variant: "destructive" },
	unsubscribed: {
		label: "Отписался",
		variant: "outline",
		className: "border-amber-500/50 text-amber-700 dark:text-amber-400",
	},
	error: { label: "Ошибка", variant: "destructive" },
};

/** Типы событий журнала email_events. */
export const EMAIL_EVENT_LABELS: Record<string, string> = {
	sent: "Отправлено провайдером",
	delivered: "Доставлено в ящик",
	opened: "Открыто",
	clicked: "Переход по ссылке",
	soft_bounced: "Временный отказ доставки (провайдер повторит)",
	bounced: "Не доставлено: адрес недоступен",
	complained: "Жалоба на спам",
	unsubscribed: "Отписался",
	failed: "Ошибка отправки",
};

export const SUPPRESSION_REASON_LABELS: Record<string, string> = {
	unsubscribed: "Отписался",
	bounced: "Адрес не существует",
	complained: "Жалоба на спам",
	manual: "Добавлен вручную",
};

export const PROVIDER_LABELS: Record<string, string> = {
	rusender: "Rusender",
	unisender: "Unisender",
	internal: "Страница отписки",
};
