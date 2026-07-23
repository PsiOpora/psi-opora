"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { parseDateRange } from "@/lib/analytics/date-range";
import type { StageInfo } from "@/lib/analytics/deals";
import { reviveDeals, type WireDeal } from "@/lib/analytics/revive";
import type { DealRecord } from "@/lib/analytics/types";

export type BitrixNeed =
  | "deals"
  | "previousDeals"
  | "sourceNames"
  | "categoryNames"
  | "stageNames"
  | "dealDomain";

interface BitrixDataResult {
  connected: boolean;
  deals?: DealRecord[];
  previousDeals?: DealRecord[];
  sourceNames?: Map<string, string>;
  categoryNames?: Map<string, string>;
  stageNames?: Map<string, StageInfo>;
  dealDomain?: string | null;
}

/** Диапазон дат из ?from=&to= — как раньше в серверных страницах, но на клиенте. */
export function useDashboardRange() {
  const searchParams = useSearchParams();
  return parseDateRange(Object.fromEntries(searchParams.entries()));
}

/**
 * Данные Bitrix24 (сделки + справочники) через /api/dashboard/bitrix — замена
 * прямому getBitrixApi()/fetchDeals() в серверных компонентах страниц.
 */
export function useBitrixData(need: BitrixNeed[]) {
  const range = useDashboardRange();
  const from = range.from.toISOString();
  const to = range.to.toISOString();
  const needKey = [...need].sort().join(",");

  return useQuery({
    queryKey: ["dashboard-bitrix", from, to, needKey],
    queryFn: async (): Promise<BitrixDataResult> => {
      const params = new URLSearchParams({ from, to, need: needKey });
      const res = await fetch(`/api/dashboard/bitrix?${params}`);
      if (!res.ok) throw new Error("Не удалось загрузить данные Bitrix24");
      const json = await res.json();
      if (!json.connected) return { connected: false };
      return {
        connected: true,
        deals: json.deals ? reviveDeals(json.deals as WireDeal[]) : undefined,
        previousDeals: json.previousDeals
          ? reviveDeals(json.previousDeals as WireDeal[])
          : undefined,
        sourceNames: json.sourceNames
          ? new Map<string, string>(json.sourceNames)
          : undefined,
        categoryNames: json.categoryNames
          ? new Map<string, string>(json.categoryNames)
          : undefined,
        stageNames: json.stageNames
          ? new Map<string, StageInfo>(json.stageNames)
          : undefined,
        dealDomain: json.dealDomain ?? null,
      };
    },
  });
}
