"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { RouterOutputs } from "@psi-opora/api";
import {
	type AdCampaignIdOverrideInput,
	adCampaignIdOverrideSchema,
} from "@psi-opora/api/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { orpc } from "@/lib/orpc/client";

type Override = RouterOutputs["ads"]["campaignIdOverrides"][number];

/** Последние 30 дней — сколько разумно показывать в подсказке по актуальным ID. */
function last30DaysRange(): { dateFrom: string; dateTo: string } {
	const today = new Date();
	const from = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
	return {
		dateFrom: from.toISOString().split("T")[0] ?? "",
		dateTo: today.toISOString().split("T")[0] ?? "",
	};
}

function AddOverrideForm() {
	const queryClient = useQueryClient();
	const form = useForm<AdCampaignIdOverrideInput>({
		resolver: zodResolver(adCampaignIdOverrideSchema),
		defaultValues: { utmCampaign: "", adCampaignId: "" },
	});

	const mutation = useMutation(
		orpc.ads.upsertCampaignIdOverride.mutationOptions({
			onSuccess: () => {
				toast.success("Привязка сохранена");
				form.reset({ utmCampaign: "", adCampaignId: "" });
				queryClient.invalidateQueries({
					queryKey: orpc.ads.campaignIdOverrides.key(),
				});
			},
			onError: (error) => {
				toast.error(error.message || "Не удалось сохранить привязку");
			},
		}),
	);

	return (
		<Form {...form}>
			<form
				onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
				className="flex flex-wrap items-end gap-3"
			>
				<FormField
					control={form.control}
					name="utmCampaign"
					render={({ field }) => (
						<FormItem className="min-w-48 flex-1">
							<FormLabel className="text-xs text-muted-foreground">
								UTM-кампания (как в CRM)
							</FormLabel>
							<FormControl>
								<Input
									placeholder="search_anorexia_708811857"
									className="font-mono text-sm"
									{...field}
								/>
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>
				<FormField
					control={form.control}
					name="adCampaignId"
					render={({ field }) => (
						<FormItem className="min-w-40 flex-1">
							<FormLabel className="text-xs text-muted-foreground">
								Актуальный ID кампании в кабинете
							</FormLabel>
							<FormControl>
								<Input
									placeholder="714370364"
									className="font-mono text-sm"
									{...field}
								/>
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>
				<Button type="submit" disabled={mutation.isPending}>
					{mutation.isPending ? "Сохраняем…" : "Привязать"}
				</Button>
			</form>
		</Form>
	);
}

function DeleteOverrideButton({ utmCampaign }: { utmCampaign: string }) {
	const queryClient = useQueryClient();
	const mutation = useMutation(
		orpc.ads.deleteCampaignIdOverride.mutationOptions({
			onSuccess: () => {
				toast.success("Привязка удалена");
				queryClient.invalidateQueries({
					queryKey: orpc.ads.campaignIdOverrides.key(),
				});
			},
			onError: (error) =>
				toast.error(error.message || "Не удалось удалить привязку"),
		}),
	);

	return (
		<Button
			type="button"
			variant="outline"
			size="sm"
			disabled={mutation.isPending}
			onClick={() => mutation.mutate({ utmCampaign })}
		>
			Удалить
		</Button>
	);
}

/**
 * Справочная таблица кампаний из ad_daily_stats за последние 30 дней — чтобы
 * не искать актуальный ID кампании отдельно в кабинете Яндекс.Директа.
 */
function RecentCampaignsHint() {
	const { data } = useQuery(
		orpc.ads.stats.queryOptions({ input: last30DaysRange() }),
	);
	const rows = data?.rows ?? [];
	const byId = new Map<string, string | null>();
	for (const row of rows) {
		if (!byId.has(row.campaignId)) byId.set(row.campaignId, row.campaignName);
	}

	if (byId.size === 0) return null;

	return (
		<div className="rounded-md border bg-muted/40 p-3 text-sm">
			<p className="font-medium">Кампании с расходом за последние 30 дней</p>
			<ul className="mt-1.5 flex flex-col gap-0.5 text-xs text-muted-foreground">
				{[...byId.entries()].map(([id, name]) => (
					<li key={id}>
						<code className="rounded bg-muted px-1 py-0.5 font-mono">{id}</code>{" "}
						{name}
					</li>
				))}
			</ul>
		</div>
	);
}

export function AdCampaignIdOverridesCard() {
	const { data: overrides = [] } = useQuery(
		orpc.ads.campaignIdOverrides.queryOptions(),
	);

	return (
		<Card>
			<CardHeader>
				<CardTitle>Привязка кампаний к расходу</CardTitle>
				<CardDescription>
					Расход из Яндекс.Директа матчится с UTM-кампанией по числовому ID в её
					названии. Если кампанию пересоздали в кабинете (новый ID), а
					трекинговую ссылку не обновили — расход перестаёт находиться сам.
					Пропишите здесь, какой актуальный ID кампании в кабинете соответствует
					старой UTM-метке, и матчинг в отчётах («Окупаемость рекламы», «Воронка
					бота») заработает снова, без правки кода.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<RecentCampaignsHint />
				<AddOverrideForm />
				{overrides.length > 0 && (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>UTM-кампания</TableHead>
								<TableHead>ID кампании в кабинете</TableHead>
								<TableHead>Обновлено</TableHead>
								<TableHead />
							</TableRow>
						</TableHeader>
						<TableBody>
							{overrides.map((row: Override) => (
								<TableRow key={row.utmCampaign}>
									<TableCell className="font-mono text-xs">
										{row.utmCampaign}
									</TableCell>
									<TableCell className="font-mono text-xs">
										{row.adCampaignId}
									</TableCell>
									<TableCell className="text-xs text-muted-foreground">
										{row.updatedAt
											? new Date(row.updatedAt).toLocaleString("ru-RU")
											: "—"}
									</TableCell>
									<TableCell className="text-right">
										<DeleteOverrideButton utmCampaign={row.utmCampaign} />
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	);
}
