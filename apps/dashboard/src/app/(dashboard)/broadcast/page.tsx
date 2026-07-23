"use client";

import { NotConnected } from "@/components/dashboard/not-connected";
import { useBitrixData } from "@/hooks/use-bitrix-data";
import type { StageOption } from "./broadcast-form";
import { BroadcastForm } from "./broadcast-form";
import { BroadcastHistory } from "./history";

/** CATEGORY_ID из STAGE_ID: "C5:NEW" → "5", "NEW" (основная воронка) → "0". */
function categoryOfStage(stageId: string): string {
  return stageId.match(/^C(\d+):/)?.[1] ?? "0";
}

export default function BroadcastPage() {
  const { data, isLoading, isError } = useBitrixData([
    "stageNames",
    "categoryNames",
  ]);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Загрузка…</p>;
  }
  if (isError) {
    return (
      <p className="text-sm text-destructive">
        Не удалось загрузить данные. Попробуйте обновить страницу.
      </p>
    );
  }
  if (!data?.connected) return <NotConnected />;

  const stages = data.stageNames ?? new Map();
  const categories = data.categoryNames ?? new Map();

  const options: StageOption[] = [...stages.entries()]
    .map(([stageId, info]) => {
      const categoryId = categoryOfStage(stageId);
      return {
        stageId,
        stageName: info.name,
        sort: info.sort,
        categoryId,
        categoryName:
          categories.get(categoryId) ??
          (categoryId === "0" ? "Основная воронка" : `Воронка ${categoryId}`),
      };
    })
    .sort(
      (a, b) =>
        a.categoryId.localeCompare(b.categoryId, undefined, {
          numeric: true,
        }) || a.sort - b.sort,
    );

  return (
    <div className="flex w-full flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Рассылка по сделкам</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Отправка сообщения контактам сделок выбранной стадии через
          Telegram-бота или MAX-бота — в зависимости от того, какой мессенджер
          привязан к контакту.
        </p>
      </div>
      <BroadcastForm stages={options} />
      <BroadcastHistory />
    </div>
  );
}
