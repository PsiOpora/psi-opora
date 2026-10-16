"use client";

import { useQuery } from "@tanstack/react-query";
import {
	EMAIL_EVENT_LABELS,
	formatDateTime,
	PROVIDER_LABELS,
} from "@/components/email/email-format";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { orpc } from "@/lib/orpc/client";

/** Хронология письма конкретного получателя: отправка → доставка → открытия → клики. */
export function RecipientEventsDialog({
	recipientId,
	onClose,
}: {
	recipientId: string | null;
	onClose: () => void;
}) {
	const { data, isLoading } = useQuery(
		orpc.emailCampaigns.recipientEvents.queryOptions({
			input: { recipientId: recipientId ?? "" },
			enabled: recipientId !== null,
		}),
	);

	const recipient = data?.recipient;
	const timeline = [
		...(recipient?.sentAt
			? [
					{
						id: "sent",
						type: "sent",
						occurredAt: recipient.sentAt,
						provider: null as string | null,
						details: null as string | null,
					},
				]
			: []),
		...(data?.events.filter((e) => e.type !== "sent") ?? []),
	].sort(
		(a, b) =>
			new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
	);

	return (
		<Dialog
			open={recipientId !== null}
			onOpenChange={(open) => !open && onClose()}
		>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{recipient?.email ?? "Получатель"}</DialogTitle>
					<DialogDescription>
						{recipient?.contactName ? `${recipient.contactName} · ` : ""}
						Открытий: {recipient?.openCount ?? 0} · переходов:{" "}
						{recipient?.clickCount ?? 0}
					</DialogDescription>
				</DialogHeader>
				{isLoading ? (
					<p className="text-sm text-muted-foreground">Загрузка…</p>
				) : timeline.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{recipient?.status === "skipped"
							? `Письмо не отправлялось: ${recipient.error ?? "получатель пропущен"}.`
							: recipient?.status === "error"
								? `Ошибка отправки: ${recipient.error ?? "неизвестная ошибка"}.`
								: "Событий пока нет — письмо ещё в очереди или провайдер не прислал статусы."}
					</p>
				) : (
					<ol className="relative ml-2 flex flex-col gap-4 border-l pl-5">
						{timeline.map((event) => (
							<li key={event.id} className="relative">
								<span className="absolute -left-[25px] top-1.5 size-2.5 rounded-full bg-primary" />
								<p className="text-sm font-medium">
									{EMAIL_EVENT_LABELS[event.type] ?? event.type}
								</p>
								<p className="text-xs text-muted-foreground">
									{formatDateTime(event.occurredAt)}
									{event.provider &&
										` · ${PROVIDER_LABELS[event.provider] ?? event.provider}`}
								</p>
								{event.details && (
									<p className="mt-1 break-words rounded bg-muted px-2 py-1 font-mono text-xs">
										{event.details}
									</p>
								)}
							</li>
						))}
					</ol>
				)}
			</DialogContent>
		</Dialog>
	);
}
