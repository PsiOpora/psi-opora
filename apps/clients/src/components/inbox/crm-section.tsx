"use client";

import { useQuery } from "@tanstack/react-query";
import {
	BriefcaseIcon,
	ExternalLinkIcon,
	Loader2Icon,
	RefreshCwIcon,
} from "lucide-react";
import type { SelectedClient } from "@/components/inbox/thread-pane";
import { Badge } from "@/components/ui/badge";
import { orpc } from "@/lib/orpc/client";
import { cn } from "@/lib/utils";

function formatOpportunity(
	opportunity: string | null,
	currencyId: string | null,
): string | null {
	if (!opportunity) return null;
	const value = Number.parseFloat(opportunity);
	if (!Number.isFinite(value) || value === 0) return null;
	const formatted = value.toLocaleString("ru-RU", { maximumFractionDigits: 0 });
	const currency = currencyId === "RUB" ? "₽" : (currencyId ?? "");
	return `${formatted} ${currency}`.trim();
}

function CrmLink({
	url,
	children,
	className,
}: {
	url: string | null;
	children: React.ReactNode;
	className?: string;
}) {
	if (!url) return <span className={className}>{children}</span>;
	return (
		<a
			href={url}
			target="_blank"
			rel="noreferrer"
			className={cn("text-primary hover:underline", className)}
		>
			{children}
			<ExternalLinkIcon className="ml-0.5 inline size-3 align-baseline" />
		</a>
	);
}

/** Связь диалога с CRM Битрикс24: контакт, лид и сделки с прямыми ссылками. */
export function CrmSection({ selected }: { selected: SelectedClient }) {
	const { data, isLoading, isFetching, refetch } = useQuery(
		orpc.messages.crmLinks.queryOptions({
			input: { messenger: selected.messenger, userId: selected.userId },
			staleTime: 60_000,
		}),
	);

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase">
					<BriefcaseIcon className="size-3.5" />
					CRM Битрикс24
				</div>
				<button
					type="button"
					onClick={() => refetch()}
					title="Обновить данные из CRM"
					className="text-muted-foreground hover:text-foreground"
				>
					<RefreshCwIcon
						className={cn("size-3", isFetching && "animate-spin")}
					/>
				</button>
			</div>

			{isLoading ? (
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<Loader2Icon className="size-4 animate-spin" />
					Ищем в CRM…
				</div>
			) : data?.error ? (
				<p className="text-xs text-destructive">{data.error}</p>
			) : !data || (!data.contact && !data.lead && data.deals.length === 0) ? (
				<p className="text-xs text-muted-foreground">
					Контакт в CRM не найден — он появится после того, как трекер Открытой
					линии обработает первое сообщение клиента.
				</p>
			) : (
				<div className="flex flex-col gap-2 text-sm">
					{data.contact && (
						<div className="flex items-start justify-between gap-3">
							<span className="shrink-0 text-muted-foreground">Контакт</span>
							<CrmLink url={data.contact.url} className="min-w-0 text-right">
								{data.contact.name}
							</CrmLink>
						</div>
					)}
					{data.lead && (
						<div className="flex items-start justify-between gap-3">
							<span className="shrink-0 text-muted-foreground">Лид</span>
							<CrmLink url={data.lead.url} className="min-w-0 text-right">
								{data.lead.title}
							</CrmLink>
						</div>
					)}
					{data.deals.length > 0 && (
						<div className="flex flex-col gap-1.5">
							<span className="text-muted-foreground">
								Сделки ({data.deals.length})
							</span>
							{data.deals.map((deal) => {
								const money = formatOpportunity(
									deal.opportunity,
									deal.currencyId,
								);
								return (
									<div key={deal.id} className="rounded-lg border p-2 text-sm">
										<CrmLink url={deal.url} className="font-medium">
											{deal.title}
										</CrmLink>
										<div className="mt-1 flex flex-wrap items-center gap-1.5">
											{deal.stageName && (
												<Badge
													variant={deal.closed ? "outline" : "secondary"}
													className="text-[10px]"
												>
													{deal.stageName}
												</Badge>
											)}
											{money && (
												<span className="text-xs text-muted-foreground">
													{money}
												</span>
											)}
										</div>
									</div>
								);
							})}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
