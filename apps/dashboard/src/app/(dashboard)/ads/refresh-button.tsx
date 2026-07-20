"use client";

import { RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { orpcClient } from "@/lib/orpc/client";

export function AdRefreshButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleRefresh = async () => {
    setLoading(true);
    const toastId = toast.loading("Обновляем данные рекламы…");
    try {
      const result = await orpcClient.ads.refreshStats();
      if (result.ok) {
        toast.success("Данные обновлены", { id: toastId });
        router.refresh();
      } else {
        toast.error(result.error ?? "Не удалось обновить данные", {
          id: toastId,
        });
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Не удалось обновить данные",
        { id: toastId },
      );
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
