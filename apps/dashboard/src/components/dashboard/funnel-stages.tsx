import type { FunnelStage } from "@/lib/analytics/types";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";

export function FunnelStages({ stages }: { stages: FunnelStage[] }) {
  const activeStages = stages.filter((s) => s.status === "in_progress");
  const wonStages = stages.filter((s) => s.status === "won");
  const lostStages = stages.filter((s) => s.status === "lost");

  const activeTotal = activeStages.reduce((sum, s) => sum + s.deals, 0);
  const activeMax = Math.max(...activeStages.map((s) => s.deals), 1);

  const wonDeals = wonStages.reduce((sum, s) => sum + s.deals, 0);
  const wonSum = wonStages.reduce((sum, s) => sum + s.opportunitySum, 0);
  const lostDeals = lostStages.reduce((sum, s) => sum + s.deals, 0);
  const lostSum = lostStages.reduce((sum, s) => sum + s.opportunitySum, 0);
  const closedDeals = wonDeals + lostDeals;
  const conversionRate = closedDeals > 0 ? wonDeals / closedDeals : 0;

  return (
    <div className="flex flex-col gap-4">
      {activeStages.length > 0 && (
        <div className="flex flex-col gap-3">
          {activeStages.map((stage, i) => {
            const prev = activeStages[i - 1];
            const stepChange =
              prev && prev.deals > 0 ? stage.deals / prev.deals : null;

            return (
              <div key={stage.stageId} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">{stage.label}</span>
                  <span className="whitespace-nowrap text-muted-foreground">
                    {formatNumber(stage.deals)} ·{" "}
                    {formatMoney(stage.opportunitySum)} ·{" "}
                    {formatPercent(
                      activeTotal > 0 ? stage.deals / activeTotal : 0,
                    )}{" "}
                    от активных
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted">
                  <div
                    className="h-2 rounded-full bg-primary"
                    style={{
                      width: `${Math.max((stage.deals / activeMax) * 100, 2)}%`,
                    }}
                  />
                </div>
                {stepChange !== null && (
                  <span className="text-xs text-muted-foreground">
                    {stepChange >= 1 ? "↑" : "↓"} {formatPercent(stepChange)}{" "}
                    к предыдущему этапу
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {closedDeals > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">Закрытые сделки</span>
            <span className="whitespace-nowrap text-muted-foreground">
              {formatNumber(closedDeals)} · конверсия{" "}
              {formatPercent(conversionRate)}
            </span>
          </div>
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
            {wonDeals > 0 && (
              <div
                className="h-2 bg-emerald-500"
                style={{ width: `${(wonDeals / closedDeals) * 100}%` }}
              />
            )}
            {lostDeals > 0 && (
              <div
                className="h-2 bg-red-400"
                style={{ width: `${(lostDeals / closedDeals) * 100}%` }}
              />
            )}
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-emerald-500" />
              Выиграно: {formatNumber(wonDeals)} · {formatMoney(wonSum)}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-red-400" />
              Проиграно: {formatNumber(lostDeals)} · {formatMoney(lostSum)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
