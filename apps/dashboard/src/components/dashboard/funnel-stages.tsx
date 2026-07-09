import type { FunnelStage } from "@/lib/analytics/types";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

function barColor(stageId: string): string {
  if (stageId.includes("WON")) return "bg-emerald-500";
  if (stageId.includes("LOSE")) return "bg-red-400";
  return "bg-primary";
}

export function FunnelStages({ stages }: { stages: FunnelStage[] }) {
  const max = Math.max(...stages.map((s) => s.deals), 1);

  return (
    <div className="flex flex-col gap-3">
      {stages.map((stage) => (
        <div key={stage.stageId} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">{stage.label}</span>
            <span className="whitespace-nowrap text-muted-foreground">
              {formatNumber(stage.deals)} · {formatMoney(stage.opportunitySum)}{" "}
              · {formatPercent(stage.share)}
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted">
            <div
              className={cn("h-2 rounded-full", barColor(stage.stageId))}
              style={{ width: `${Math.max((stage.deals / max) * 100, 2)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
