"use client";

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Table,
	TableBody,
	TableCell,
	TableFooter,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { DateRange } from "@/lib/analytics/types";
import { formatDateRange, formatMoney } from "@/lib/format";

export interface AdSpendCampaign {
	campaignId: string;
	campaignName?: string;
	spend: number;
	/** Подписи строк отчёта, к которым привязан расход; пусто — не привязан. */
	rowLabels: string[];
}

export interface AdSpendSelection {
	label: string;
	campaigns: AdSpendCampaign[];
}

/**
 * Расшифровка цифры «Расход»: он берётся не из сделок, а из статистики
 * Яндекс.Директа (ad_daily_stats), поэтому вместо списка сделок —
 * кампании рекламного кабинета, из которых сложилась сумма.
 */
export function AdSpendDialog({
	selection,
	range,
	onOpenChange,
}: {
	selection: AdSpendSelection | null;
	range: DateRange;
	onOpenChange: (open: boolean) => void;
}) {
	const campaigns = selection?.campaigns ?? [];
	const total = campaigns.reduce((sum, campaign) => sum + campaign.spend, 0);

	return (
		<Dialog open={selection !== null} onOpenChange={onOpenChange}>
			<DialogContent className="flex max-h-[85vh] flex-col gap-4 sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle>Расход: {selection?.label}</DialogTitle>
					<DialogDescription className="flex flex-col gap-1">
						<span>
							Расход подтягивается из Яндекс.Директа по кампаниям рекламного
							кабинета, а не из сделок.
						</span>
						<span>Период: {formatDateRange(range.from, range.to)}</span>
					</DialogDescription>
				</DialogHeader>

				<div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Кампания в Директе</TableHead>
								<TableHead>Строка отчёта (UTM)</TableHead>
								<TableHead className="text-right">Расход</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{campaigns.length === 0 ? (
								<TableRow>
									<TableCell
										colSpan={3}
										className="h-24 text-center text-muted-foreground"
									>
										Нет расхода за период
									</TableCell>
								</TableRow>
							) : (
								campaigns.map((campaign) => (
									<TableRow key={campaign.campaignId}>
										<TableCell>
											<div className="font-medium">
												{campaign.campaignName ?? "Без названия"}
											</div>
											<div className="text-xs text-muted-foreground">
												ID {campaign.campaignId}
											</div>
										</TableCell>
										<TableCell>
											{campaign.rowLabels.length > 0 ? (
												campaign.rowLabels.map((label) => (
													<div key={label}>{label}</div>
												))
											) : (
												<span className="italic text-muted-foreground">
													не привязано к UTM-кампании
												</span>
											)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatMoney(campaign.spend)}
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
						{campaigns.length > 1 && (
							<TableFooter>
								<TableRow>
									<TableCell colSpan={2}>Итого</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatMoney(total)}
									</TableCell>
								</TableRow>
							</TableFooter>
						)}
					</Table>
				</div>
			</DialogContent>
		</Dialog>
	);
}
