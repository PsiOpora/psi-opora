"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { orpc } from "@/lib/orpc/client";
import {
	BotUsernamesEditor,
	LinkRow,
	stripAt,
	useBotUsernames,
} from "../settings/bot/bot-links";
import { CampaignDialog, type MarketingCampaignView } from "./campaign-dialog";
import { buildCampaignLinks } from "./campaign-links";

function DeleteCampaignButton({ id, title }: { id: string; title: string }) {
	const queryClient = useQueryClient();
	const mutation = useMutation(
		orpc.marketingCampaigns.remove.mutationOptions({
			onSuccess: () => {
				toast.success(`Кампания «${title}» удалена`);
				queryClient.invalidateQueries({
					queryKey: orpc.marketingCampaigns.list.key(),
				});
			},
			onError: (error) =>
				toast.error(error.message || "Не удалось удалить кампанию"),
		}),
	);

	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={mutation.isPending}
				>
					Удалить
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Удалить кампанию?</AlertDialogTitle>
					<AlertDialogDescription>
						Выпущенные ссылки продолжат открывать бота, но переходы по ним
						перестанут размечаться кампанией. Сделки в Bitrix24 не изменятся.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Отмена</AlertDialogCancel>
					<AlertDialogAction
						onClick={() => mutation.mutate({ id })}
						className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
					>
						Удалить
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function CampaignCard({ campaign }: { campaign: MarketingCampaignView }) {
	const { data: usernames } = useBotUsernames();
	const telegram = stripAt(usernames?.telegram ?? "");
	const max = stripAt(usernames?.max ?? "");
	const groups = buildCampaignLinks(campaign.code, campaign.sources, {
		telegram,
		max,
	});

	return (
		<Card>
			<CardHeader>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="min-w-0">
						<div className="flex items-center gap-2">
							<CardTitle>{campaign.title}</CardTitle>
							<Badge variant={campaign.active ? "default" : "outline"}>
								{campaign.active ? "активна" : "выключена"}
							</Badge>
						</div>
						<CardDescription className="mt-1">
							Кодовое слово «{campaign.code}» · площадок:{" "}
							{campaign.sources.length}
						</CardDescription>
					</div>
					<div className="flex items-center gap-2">
						<CampaignDialog
							campaign={campaign}
							trigger={
								<Button type="button" variant="outline" size="sm">
									Изменить
								</Button>
							}
						/>
						<DeleteCampaignButton id={campaign.id} title={campaign.title} />
					</div>
				</div>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				{!telegram && !max ? (
					<p className="text-xs text-muted-foreground">
						Ссылки появятся, когда будут указаны username ботов — блок «Ссылки
						на ботов» выше.
					</p>
				) : (
					groups.map((group) => (
						<div key={group.source ?? "__all"} className="grid gap-1">
							<p className="text-xs font-medium text-muted-foreground">
								{group.source ? `Площадка: ${group.source}` : "Без площадки"}
							</p>
							{group.links.map((link) => (
								<LinkRow
									key={link.url}
									label={`Ссылка ${link.label}`}
									url={link.url}
								/>
							))}
						</div>
					))
				)}
			</CardContent>
		</Card>
	);
}

export default function CampaignsPage() {
	const { data: campaigns = [], isLoading } = useQuery(
		orpc.marketingCampaigns.list.queryOptions(),
	);

	return (
		<div className="flex max-w-3xl flex-col gap-6">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h1 className="text-2xl font-semibold">Кампании и ссылки</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Создайте кампанию, добавьте площадки — получите отдельную ссылку на
						Telegram- и MAX-бота для каждой. Человек переходит по ссылке и видит
						обычный сценарий бота, а в Bitrix24 сделка помечается кампанией и
						площадкой.
					</p>
				</div>
				<CampaignDialog
					trigger={
						<Button type="button">
							<Plus data-icon="inline-start" />
							Новая кампания
						</Button>
					}
				/>
			</div>

			<BotUsernamesEditor />

			{isLoading ? (
				<p className="text-sm text-muted-foreground">Загрузка…</p>
			) : campaigns.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					Пока нет ни одной кампании.
				</p>
			) : (
				campaigns.map((campaign) => (
					<CampaignCard key={campaign.id} campaign={campaign} />
				))
			)}
		</div>
	);
}
