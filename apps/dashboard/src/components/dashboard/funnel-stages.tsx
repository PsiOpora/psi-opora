import {
	CheckCircle2Icon,
	CircleDotIcon,
	CircleXIcon,
	HelpCircleIcon,
	Layers3Icon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { FunnelStage } from "@/lib/analytics/types";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";

/** Иконка-вопросик с расшифровкой метрики. */
function HelpHint({ text }: { text: string }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					type="button"
					className="text-muted-foreground"
					aria-label="Пояснение"
				>
					<HelpCircleIcon className="size-3.5" />
				</button>
			</TooltipTrigger>
			<TooltipContent>{text}</TooltipContent>
		</Tooltip>
	);
}

export function FunnelStages({
	stages,
	mode,
}: {
	stages: FunnelStage[];
	/** Режим выборки сделок — влияет только на подписи. */
	mode: "created" | "active";
}) {
	const activeStages = stages.filter((stage) => stage.status === "in_progress");
	const wonStages = stages.filter((stage) => stage.status === "won");
	const lostStages = stages.filter((stage) => stage.status === "lost");

	const totalDeals = stages.reduce((sum, stage) => sum + stage.deals, 0);
	const activeDeals = activeStages.reduce((sum, stage) => sum + stage.deals, 0);
	const activeSum = activeStages.reduce(
		(sum, stage) => sum + stage.opportunitySum,
		0,
	);
	const wonDeals = wonStages.reduce((sum, stage) => sum + stage.deals, 0);
	const wonSum = wonStages.reduce(
		(sum, stage) => sum + stage.opportunitySum,
		0,
	);
	const lostDeals = lostStages.reduce((sum, stage) => sum + stage.deals, 0);
	const lostSum = lostStages.reduce(
		(sum, stage) => sum + stage.opportunitySum,
		0,
	);
	const closedDeals = wonDeals + lostDeals;
	const conversionRate = closedDeals > 0 ? wonDeals / closedDeals : 0;
	const activeMax = Math.max(...activeStages.map((stage) => stage.deals), 1);

	const createdLabel =
		mode === "created" ? "за выбранный период" : "сейчас не закрыто";

	return (
		<div className="flex flex-col gap-4">
			<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
				<MetricCard
					label={mode === "created" ? "Создано сделок" : "Всего в работе"}
					value={formatNumber(totalDeals)}
					description={createdLabel}
					icon={Layers3Icon}
					hint={
						mode === "created"
							? "Все сделки CRM этой воронки, созданные в выбранном периоде, — источник: Bitrix24 crm.deal.list."
							: "Все сделки CRM этой воронки, которые сейчас не закрыты, — источник: Bitrix24 crm.deal.list."
					}
				/>
				<MetricCard
					label="Сейчас в работе"
					value={formatNumber(activeDeals)}
					description={formatMoney(activeSum)}
					icon={CircleDotIcon}
					hint="Сделки на промежуточных стадиях воронки — ещё не выиграны и не проиграны."
				/>
				<MetricCard
					label="Выиграно"
					value={formatNumber(wonDeals)}
					description={formatMoney(wonSum)}
					icon={CheckCircle2Icon}
					hint="Сделки со стадией в статусе «Успешно» (semantic STAGE_SEMANTIC_ID = S)."
				/>
				<MetricCard
					label="Конверсия в победу"
					value={formatPercent(conversionRate)}
					description={
						closedDeals > 0
							? `${formatNumber(wonDeals)} из ${formatNumber(closedDeals)} закрытых`
							: "закрытых сделок пока нет"
					}
					icon={CircleDotIcon}
					hint="Выиграно ÷ (выиграно + проиграно) — доля успешных среди закрытых сделок."
				/>
			</div>

			<div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
				<Card>
					<CardHeader>
						<CardTitle>Активные этапы</CardTitle>
						<CardDescription>
							{mode === "created"
								? "Где сейчас находятся сделки, созданные за выбранный период"
								: "Где сейчас находятся сделки, которые ещё не закрыты"}
						</CardDescription>
						<CardAction>
							<Badge variant="secondary">
								{formatNumber(activeDeals)} в работе
							</Badge>
						</CardAction>
					</CardHeader>
					<CardContent>
						{activeStages.length > 0 ? (
							<div className="flex flex-col gap-5">
								{activeStages.map((stage, index) => (
									<div
										key={stage.stageId}
										className="grid grid-cols-[2rem_1fr] gap-3"
									>
										<div className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
											{index + 1}
										</div>
										<div className="flex min-w-0 flex-col gap-2">
											<div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
												<div className="min-w-0">
													<p className="flex items-center gap-1.5 truncate font-medium">
														{stage.label}
														<HelpHint
															text={`Сделки этой воронки на стадии «${stage.label}» — источник: Bitrix24 crm.deal.list.`}
														/>
													</p>
													<p className="text-xs text-muted-foreground">
														{formatPercent(
															activeDeals > 0 ? stage.deals / activeDeals : 0,
														)}{" "}
														активных сделок
													</p>
												</div>
												<div className="flex shrink-0 items-baseline gap-2 sm:text-right">
													<span className="font-heading text-lg font-medium">
														{formatNumber(stage.deals)}
													</span>
													<span className="text-xs text-muted-foreground">
														{formatMoney(stage.opportunitySum)}
													</span>
												</div>
											</div>
											<Progress
												value={(stage.deals / activeMax) * 100}
												aria-label={`${stage.label}: ${formatNumber(stage.deals)} сделок`}
											/>
										</div>
									</div>
								))}
								<p className="pl-11 text-xs text-muted-foreground">
									Длина полосы показывает количество сделок относительно самого
									заполненного этапа.
								</p>
							</div>
						) : (
							<p className="text-sm text-muted-foreground">
								Активных сделок в этой воронке нет.
							</p>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Результат закрытых</CardTitle>
						<CardDescription>
							Победы и проигрыши среди завершённых сделок
						</CardDescription>
					</CardHeader>
					<CardContent>
						{closedDeals > 0 ? (
							<div className="flex flex-col gap-5">
								<div className="flex flex-col gap-2">
									<div className="flex items-end justify-between gap-3">
										<div>
											<p className="font-heading text-3xl font-medium">
												{formatPercent(conversionRate)}
											</p>
											<p className="text-xs text-muted-foreground">
												конверсия в победу
											</p>
										</div>
										<Badge variant="outline">
											{formatNumber(closedDeals)} закрыто
										</Badge>
									</div>
									<Progress
										value={conversionRate * 100}
										aria-label={`Конверсия в победу: ${formatPercent(conversionRate)}`}
									/>
								</div>

								<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
									<Outcome
										label="Выиграно"
										deals={wonDeals}
										sum={wonSum}
										icon={CheckCircle2Icon}
									/>
									<Outcome
										label="Проиграно"
										deals={lostDeals}
										sum={lostSum}
										icon={CircleXIcon}
										destructive
									/>
								</div>
							</div>
						) : (
							<p className="text-sm text-muted-foreground">
								Закрытых сделок в этой воронке пока нет.
							</p>
						)}
					</CardContent>
				</Card>
			</div>
		</div>
	);
}

function MetricCard({
	label,
	value,
	description,
	icon: Icon,
	hint,
}: {
	label: string;
	value: string;
	description: string;
	icon: typeof Layers3Icon;
	hint?: string;
}) {
	return (
		<Card size="sm">
			<CardHeader>
				<CardTitle className="flex items-center gap-1.5 text-muted-foreground">
					{label}
					{hint && <HelpHint text={hint} />}
				</CardTitle>
				<CardAction>
					<Icon aria-hidden="true" className="text-muted-foreground" />
				</CardAction>
			</CardHeader>
			<CardContent className="flex flex-col gap-1">
				<p className="font-heading text-2xl font-medium">{value}</p>
				<p className="text-xs text-muted-foreground">{description}</p>
			</CardContent>
		</Card>
	);
}

function Outcome({
	label,
	deals,
	sum,
	icon: Icon,
	destructive = false,
}: {
	label: string;
	deals: number;
	sum: number;
	icon: typeof CheckCircle2Icon;
	destructive?: boolean;
}) {
	return (
		<div className="flex items-center justify-between gap-3 rounded-lg border p-3">
			<div className="flex items-center gap-2">
				<Badge variant={destructive ? "destructive" : "default"}>
					<Icon data-icon="inline-start" />
					{label}
				</Badge>
				<span className="font-medium">{formatNumber(deals)}</span>
			</div>
			<span className="text-xs text-muted-foreground">{formatMoney(sum)}</span>
		</div>
	);
}
