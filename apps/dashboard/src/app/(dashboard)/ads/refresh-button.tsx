"use client";

import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useState } from "react";
import { refreshAdStatsAction } from "./actions";

export function AdRefreshButton() {
  const [loading, setLoading] = useState(false);

  const handleRefresh = async () => {
    setLoading(true);
    try {
      await refreshAdStatsAction();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={loading}
          className="gap-2"
        >
          <RefreshCwIcon
            className={`size-4 ${loading ? "animate-spin" : ""}`}
          />
          <span>{loading ? "Обновление..." : "Обновить"}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>Обновить данные из Яндекс.Директ и VK Ads</p>
      </TooltipContent>
    </Tooltip>
  );
}
