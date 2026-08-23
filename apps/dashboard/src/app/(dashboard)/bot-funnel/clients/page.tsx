"use client";

import type { FunnelStep } from "@psi-opora/bot-core";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageSuspense } from "@/components/dashboard/page-suspense";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	type BotFunnelFlow,
	FLOW_LABELS,
	MESSENGER_LABELS,
	REASON_LABELS,
	STEP_LABELS,
} from "@/lib/analytics/bot-funnel";

interface BotFunnelStepClient {
	messenger: string;
	userId: string;
	name: string | null;
	firstName: string | null;
	lastName: string | null;
	username: string | null;
	source: string;
	campaign: string;
	flow: string;
	reason: string;
	firstDay: string;
	lastDay: string;
}

function clientDisplayName(client: BotFunnelStepClient): string {
	return (
		client.name?.trim() ||
		[client.firstName, client.lastName].filter(Boolean).join(" ").trim() ||
		`ID ${client.userId}`
	);
}

export default function BotFunnelClientsPage() {
	return (
		<PageSuspense>
			<BotFunnelClientsPageContent />
		</PageSuspense>
	);
}

function BotFunnelClientsPageContent() {
	const searchParams = useSearchParams();
	const step = searchParams.get("step") ?? "";
	const from = searchParams.get("from") ?? "";
	const to = searchParams.get("to") ?? "";
	const messenger = searchParams.get("messenger") ?? undefined;
	const source = searchParams.get("source") ?? undefined;
	const campaign = searchParams.get("campaign") ?? undefined;
	const flow = searchParams.get("flow") ?? undefined;
	const reason = searchParams.get("reason") ?? undefined;

	const { data, isLoading, isError } = useQuery({
		queryKey: [
			"bot-funnel-clients",
			step,
			from,
			to,
			messenger,
			source,
			campaign,
			flow,
			reason,
		],
		queryFn: async () => {
			const params = new URLSearchParams({ step, from, to });
			if (messenger) params.set("messenger", messenger);
			if (source) params.set("source", source);
			if (campaign) params.set("campaign", campaign);
			if (flow) params.set("flow", flow);
			if (reason) params.set("reason", reason);
			const res = await fetch(`/api/dashboard/bot-funnel/clients?${params}`);
			if (!res.ok) throw new Error("Не удалось загрузить список клиентов");
			return (await res.json()) as { clients: BotFunnelStepClient[] };
		},
		enabled: Boolean(step && from && to),
	});

	const clients = data?.clients ?? [];
	const stepLabel = STEP_LABELS[step as FunnelStep] ?? step;
	const reasonLabel = reason ? (REASON_LABELS[reason] ?? reason) : undefined;

	return (
		<div className="flex flex-col gap-4">
			<Card>
				<CardHeader>
					<CardTitle>
						{reasonLabel ? `Отвал: ${stepLabel}` : `Клиенты: ${stepLabel}`}
					</CardTitle>
					<CardDescription>
						{reasonLabel
							? `Причина: «${reasonLabel}»`
							: "Уникальные пользователи, дошедшие до этого шага"}
						{flow
							? ` в ветке «${FLOW_LABELS[flow as BotFunnelFlow] ?? flow}»`
							: ""}
						{messenger ? ` в ${MESSENGER_LABELS[messenger] ?? messenger}` : ""}
						{source ? ` из источника «${source}»` : ""}
						{campaign ? `, кампания «${campaign}»` : ""} за {from} — {to}.{" "}
						<Link href="/bot-funnel" className="underline underline-offset-2">
							Назад к воронке
						</Link>
					</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<p className="text-sm text-muted-foreground py-4">Загрузка…</p>
					) : isError ? (
						<p className="text-sm text-destructive py-4">
							Не удалось загрузить данные. Попробуйте обновить страницу.
						</p>
					) : clients.length === 0 ? (
						<p className="text-sm text-muted-foreground py-4">
							За выбранный период и фильтры никого не нашлось.
						</p>
					) : (
						<div className="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Клиент</TableHead>
										<TableHead>Мессенджер</TableHead>
										<TableHead>Источник</TableHead>
										<TableHead>Кампания</TableHead>
										<TableHead>Первый раз</TableHead>
										<TableHead>Последний раз</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{clients.map((client) => (
										<TableRow key={`${client.messenger}:${client.userId}`}>
											<TableCell className="font-medium">
												{clientDisplayName(client)}
												{client.username && (
													<span className="ml-1.5 text-xs text-muted-foreground">
														@{client.username}
													</span>
												)}
											</TableCell>
											<TableCell>
												<Badge variant="secondary">
													{MESSENGER_LABELS[client.messenger] ??
														client.messenger}
												</Badge>
											</TableCell>
											<TableCell className="text-muted-foreground">
												{client.source}
											</TableCell>
											<TableCell className="text-muted-foreground">
												{client.campaign}
											</TableCell>
											<TableCell className="tabular-nums">
												{client.firstDay}
											</TableCell>
											<TableCell className="tabular-nums">
												{client.lastDay}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
