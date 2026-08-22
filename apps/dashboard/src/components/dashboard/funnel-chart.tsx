import Link from "next/link";
import { HelpHint } from "@/components/dashboard/funnel-stages";
import { formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface FunnelStepStats {
	step: string;
	label: string;
	count: number;
	shareOfStart: number;
	stepConversion: number;
}

interface FunnelChartProps {
	steps: FunnelStepStats[];
	/** "Все мессенджеры" или название мессенджера */
	title?: string;
	className?: string;
	/**
	 * Есть ли смысл в "% от старта"/конверсии между шагами/потерях. Эти
	 * метрики корректны только для последовательной воронки, где одна и та же
	 * совокупность сделок идёт по шагам друг за другом (например, воронка
	 * бота). Для независимых по шагам подсчётов (например, "сколько уникальных
	 * сделок дошло до каждого этапа хотя бы раз за период") шаги не вложены
	 * друг в друга — конверсия между ними не определена и может дать
	 * бессмысленные значения вроде 0% или >100%. По умолчанию включена, чтобы
	 * не менять поведение уже существующих воронок.
	 */
	showConversion?: boolean;
	/** Пояснение "как считается" рядом с заголовком графика. */
	hint?: string;
	/** Ссылка для клика по числу на шаге — например, на таблицу сделок с
	 * предзаполненным фильтром. Если не задана, число не кликабельно. */
	stepHref?: (step: FunnelStepStats) => string;
}

const STEP_COLORS = [
	"bg-blue-500",
	"bg-blue-400",
	"bg-cyan-500",
	"bg-cyan-400",
	"bg-teal-400",
	"bg-emerald-500",
];

export function FunnelChart({
	steps,
	title,
	className,
	showConversion = true,
	hint,
	stepHref,
}: FunnelChartProps) {
	const startCount = steps[0]?.count ?? 1;

	return (
		<div className={cn("flex flex-col", className)}>
			{(title || hint) && (
				<h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
					{title}
					{hint && <HelpHint text={hint} />}
				</h3>
			)}
			<div className="flex flex-col gap-0">
				{steps.map((step, i) => {
					const widthPct = (step.count / startCount) * 100;
					const color = STEP_COLORS[i % STEP_COLORS.length];
					const isLast = i === steps.length - 1;

					return (
						<div key={step.step} className="relative">
							{/* Step row */}
							<div className="flex items-center gap-3 py-1">
								{/* Left: trapezoid bar */}
								<div className="relative flex-1 min-w-0">
									{/* Trapezoid shape using CSS clip-path */}
									<div
										className={cn(
											"h-10 rounded-r-md flex items-center px-3 transition-all duration-500",
											color,
										)}
										style={{
											width: `${Math.max(widthPct, 4)}%`,
											minWidth: "40px",
											clipPath:
												i === 0
													? "polygon(0 0, 100% 15%, 100% 85%, 0 100%)"
													: isLast
														? "polygon(0 15%, 100% 0%, 100% 100%, 0 100%)"
														: "polygon(0 15%, 100% 0%, 100% 100%, 0 100%)",
										}}
									>
										{stepHref ? (
											<Link
												href={stepHref(step)}
												className="text-white text-xs font-medium truncate underline-offset-2 drop-shadow-sm hover:underline"
											>
												{formatNumber(step.count)}
											</Link>
										) : (
											<span className="text-white text-xs font-medium truncate drop-shadow-sm">
												{formatNumber(step.count)}
											</span>
										)}
									</div>
								</div>

								{/* Right: labels */}
								<div className="flex flex-col items-end gap-0.5 min-w-0 pl-2">
									<span className="text-sm font-medium leading-tight text-right">
										{step.label}
									</span>
									{showConversion ? (
										<div className="flex items-center gap-2 text-xs text-muted-foreground whitespace-nowrap">
											<span>{formatPercent(step.shareOfStart)} от старта</span>
											{i > 0 && (
												<>
													<span className="text-muted-foreground/50">·</span>
													<span className="font-medium text-foreground">
														{formatPercent(step.stepConversion)} с шага
													</span>
												</>
											)}
										</div>
									) : (
										<span className="text-xs text-muted-foreground whitespace-nowrap">
											уникальных сделок за период
										</span>
									)}
								</div>
							</div>

							{/* Conversion arrow between steps */}
							{showConversion && !isLast && (
								<div className="flex items-center justify-start pl-4 pb-1">
									<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
										<svg
											width="12"
											height="16"
											viewBox="0 0 12 16"
											fill="none"
											className="shrink-0"
											aria-label="Конверсия"
											role="img"
										>
											<path
												d="M6 0v12M1 7l5 5 5-5"
												stroke="currentColor"
												strokeWidth="1.5"
												strokeLinecap="round"
												strokeLinejoin="round"
											/>
										</svg>
										<span className="font-medium text-foreground">
											{formatPercent(steps[i + 1]?.stepConversion ?? 0)}{" "}
											конверсия
										</span>
										<span className="text-muted-foreground">
											({formatNumber(step.count - (steps[i + 1]?.count ?? 0))}{" "}
											потерь)
										</span>
									</div>
								</div>
							)}
						</div>
					);
				})}
			</div>

			{/* Summary footer */}
			{showConversion && (
				<div className="mt-4 pt-3 border-t border-border/50 flex items-center justify-between text-sm">
					<span className="flex items-center gap-1.5 text-muted-foreground">
						Общая конверсия
						<HelpHint text="Как считается: «% от старта» — доля сделок этого шага от количества на первом шаге воронки. «Конверсия с шага» — сколько сделок с предыдущего шага дошло до этого (сделки на шаге ÷ сделки на предыдущем шаге). «Потери» — сколько сделок не дошло с одного шага до следующего (разница в количестве). «Общая конверсия» — доля от первого шага, дошедшая до последнего." />
					</span>
					<div className="flex items-center gap-2">
						<span className="font-semibold text-foreground">
							{formatPercent(steps[steps.length - 1]?.shareOfStart ?? 0)}
						</span>
						<span className="text-muted-foreground text-xs">
							({formatNumber(steps[0]?.count ?? 0)} →{" "}
							{formatNumber(steps[steps.length - 1]?.count ?? 0)})
						</span>
					</div>
				</div>
			)}
		</div>
	);
}
