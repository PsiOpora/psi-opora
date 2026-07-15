import { NotConnected } from "@/components/dashboard/not-connected";
import {
  fetchCategoryNames,
  fetchStageNames,
} from "@/lib/analytics/deals";
import { getBitrixApi } from "@/lib/bitrix/session";
import { BroadcastForm, type StageOption } from "./broadcast-form";
import { BroadcastHistory } from "./history";

/** CATEGORY_ID из STAGE_ID: "C5:NEW" → "5", "NEW" (основная воронка) → "0". */
function categoryOfStage(stageId: string): string {
  return stageId.match(/^C(\d+):/)?.[1] ?? "0";
}

export default async function BroadcastPage() {
  const api = await getBitrixApi();
  if (!api) return <NotConnected />;

  const [stages, categories] = await Promise.all([
    fetchStageNames(api),
    fetchCategoryNames(api).catch(() => new Map<string, string>()),
  ]);

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
    <div className="flex flex-col gap-6 max-w-3xl">
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
