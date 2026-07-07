"use client";

import { useSearchParams } from "next/navigation";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { RefreshButton } from "@/components/dashboard/refresh-button";

export function HeaderActions() {
  useSearchParams(); // Подписка на изменения URL для корректной работы router.refresh()

  return (
    <div className="flex items-center gap-2">
      <RefreshButton />
      <DateRangePicker />
    </div>
  );
}
