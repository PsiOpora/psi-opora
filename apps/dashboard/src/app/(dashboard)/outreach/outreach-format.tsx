import { Badge } from "@/components/ui/badge";

export const CHANNEL_LABELS: Record<string, string> = {
	max: "MAX",
	telegram: "Telegram",
	whatsapp: "WhatsApp",
	email: "Email",
};

export function OutreachStatusBadge({
	status,
	resumeAt,
}: {
	status: string;
	/** Рассылка ждёт (окно отправки, лимит, перерыв) до этого времени. */
	resumeAt?: Date | null;
}) {
	if (status === "done") return <Badge variant="default">Завершена</Badge>;
	if (status === "error") return <Badge variant="destructive">Ошибка</Badge>;
	if (status === "cancelled") return <Badge variant="outline">Отменена</Badge>;
	if (status === "queued") return <Badge variant="secondary">В очереди</Badge>;
	if (resumeAt && new Date(resumeAt) > new Date()) {
		return (
			<Badge
				variant="outline"
				className="border-amber-500/50 text-amber-700 dark:text-amber-400"
			>
				Пауза до {formatResumeAt(resumeAt)}
			</Badge>
		);
	}
	return <Badge variant="secondary">Отправляется</Badge>;
}

/** «14:30» сегодня, иначе «пт, 24 окт., 10:00» — по Москве. */
export function formatResumeAt(value: Date | string): string {
	const date = new Date(value);
	const sameDay =
		new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow" }).format(
			date,
		) ===
		new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow" }).format(
			new Date(),
		);
	return new Intl.DateTimeFormat("ru-RU", {
		timeZone: "Europe/Moscow",
		...(sameDay ? {} : { weekday: "short", day: "numeric", month: "short" }),
		hour: "2-digit",
		minute: "2-digit",
	}).format(date);
}

/** Итог по получателю: куда ушло или почему не ушло. */
export function RecipientOutcomeBadge({
	status,
	channel,
}: {
	status: string;
	channel: string | null;
}) {
	switch (status) {
		case "sent":
			return (
				<Badge
					variant="outline"
					className="border-emerald-500/50 text-emerald-700 dark:text-emerald-400"
				>
					{CHANNEL_LABELS[channel ?? ""] ?? channel}
				</Badge>
			);
		case "email":
			return (
				<Badge
					variant="outline"
					className="border-sky-500/50 text-sky-700 dark:text-sky-400"
				>
					Email
				</Badge>
			);
		case "email_pending":
			return <Badge variant="secondary">Ждёт отправки email</Badge>;
		case "pending":
			return <Badge variant="secondary">В очереди</Badge>;
		case "sending":
			return <Badge variant="secondary">Отправляется…</Badge>;
		case "failed":
			return <Badge variant="destructive">Не доставлено</Badge>;
		case "unknown":
			return (
				<Badge
					variant="outline"
					className="border-amber-500/50 text-amber-700 dark:text-amber-400"
				>
					Не подтверждено
				</Badge>
			);
		case "skipped":
			return <Badge variant="outline">Пропущен</Badge>;
		default:
			return <Badge variant="outline">{status}</Badge>;
	}
}

/** «MAX ✗ → Telegram ✓» — цепочка попыток по каналам; «⏸» — пропущен из-за лимита. */
export function formatAttempts(
	attempts: Array<{ channel: string; ok: boolean; skipped?: boolean }>,
): string {
	return attempts
		.map(
			(a) =>
				`${CHANNEL_LABELS[a.channel] ?? a.channel} ${a.ok ? "✓" : a.skipped ? "⏸" : "✗"}`,
		)
		.join(" → ");
}

/** Оценка длительности: пауза × число сообщений в мессенджеры. */
export function formatDuration(totalSec: number): string {
	if (totalSec < 60) return `${Math.max(1, Math.round(totalSec))} с`;
	const minutes = Math.round(totalSec / 60);
	if (minutes < 60) return `~${minutes} мин`;
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest ? `~${hours} ч ${rest} мин` : `~${hours} ч`;
}
