"use client";

import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDataRefresh } from "@/hooks/use-data-refresh";

interface RefreshButtonProps {
  /** Позиция текста на кнопке */
  showLabel?: boolean;
  /** Показывать countdown до следующего авто-обновления */
  showCountdown?: boolean;
}

export function RefreshButton({ showLabel = true, showCountdown = true }: RefreshButtonProps) {
  const { isRefreshing, nextRefreshIn, refresh } = useDataRefresh();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={isRefreshing}
          className="gap-2"
        >
          <RefreshCwIcon
            data-icon="inline-start"
            className={`size-4 ${isRefreshing ? "animate-spin" : ""}`}
          />
          {showLabel && (
            <span>
              {isRefreshing
                ? "Обновление..."
                : nextRefreshIn !== null && showCountdown
                  ? `Обновить (${nextRefreshIn}с)`
                  : "Обновить"}
            </span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>Обновить данные dashboard</p>
      </TooltipContent>
    </Tooltip>
  );
}
