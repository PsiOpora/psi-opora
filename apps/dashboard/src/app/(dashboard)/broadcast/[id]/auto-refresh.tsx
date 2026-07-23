"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { broadcastDetailKey } from "./query-keys";

/** Пока рассылка выполняется в фоне, перезапрашиваем статус раз в 3 секунды. */
export function AutoRefresh({
  enabled,
  id,
}: {
  enabled: boolean;
  id: string;
}) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: broadcastDetailKey(id) });
    }, 3000);
    return () => clearInterval(timer);
  }, [enabled, id, queryClient]);

  return null;
}
