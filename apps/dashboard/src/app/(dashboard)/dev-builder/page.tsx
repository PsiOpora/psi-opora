// Временная страница для локальной проверки конструктора без Bitrix24 — удалить.
import type { DealRecord, DealStatus } from "@/lib/analytics/types";
import { ReportBuilder } from "@/components/dashboard/report-builder";

const SOURCES = ["yandex", "vk", "telegram", "(не указано)"];
const MEDIUMS = ["cpc", "social", "(не указано)"];
const CAMPAIGNS = ["brand", "promo-june", "retarget"];
const STATUSES: DealStatus[] = ["won", "lost", "in_progress"];

function makeDeals(count: number): DealRecord[] {
  const deals: DealRecord[] = [];
  for (let i = 0; i < count; i++) {
    const status = STATUSES[i % 3];
    const created = new Date(2026, 5, 1 + (i % 30));
    deals.push({
      id: String(i + 1),
      title: `Сделка №${i + 1}`,
      stageId: status === "won" ? "WON" : status === "lost" ? "LOSE" : "NEW",
      categoryId: i % 5 === 0 ? "1" : "0",
      status,
      opportunity: 3000 + (i % 7) * 1500,
      currency: "RUB",
      dateCreate: created,
      closeDate: status === "in_progress" ? null : new Date(created.getTime() + 5 * 86400000),
      sourceId: `SRC_${i % 3}`,
      utmSource: SOURCES[i % SOURCES.length],
      utmMedium: MEDIUMS[i % MEDIUMS.length],
      utmCampaign: CAMPAIGNS[i % CAMPAIGNS.length],
      utmContent: `banner-${i % 4}`,
      utmTerm: `терапия ${i % 2}`,
    });
  }
  return deals;
}

export default function DevBuilderPage() {
  return (
    <ReportBuilder
      deals={makeDeals(90)}
      dictionaries={{
        sources: { SRC_0: "Сайт", SRC_1: "Звонок", SRC_2: "Рекомендация" },
        categories: { "0": "Основная воронка", "1": "Повторные продажи" },
        stages: { NEW: "Новая", WON: "Успешно", LOSE: "Провалена" },
      }}
    />
  );
}
