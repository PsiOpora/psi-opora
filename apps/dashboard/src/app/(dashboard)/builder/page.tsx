import { parseDateRange } from "@/lib/analytics/date-range";
import { fetchCategoryNames, fetchDeals, fetchSourceNames, fetchStageNames } from "@/lib/analytics/deals";
import { getBitrixApi } from "@/lib/bitrix/session";
import { NotConnected } from "@/components/dashboard/not-connected";
import { ReportBuilder } from "@/components/dashboard/report-builder";

export default async function BuilderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const api = await getBitrixApi();
  if (!api) return <NotConnected />;

  const range = parseDateRange(await searchParams);
  const [deals, sourceNames, categoryNames, stageNames] = await Promise.all([
    fetchDeals(api, range),
    fetchSourceNames(api),
    fetchCategoryNames(api),
    fetchStageNames(api),
  ]);

  return (
    <ReportBuilder
      deals={deals}
      dictionaries={{
        sources: Object.fromEntries(sourceNames),
        categories: Object.fromEntries(categoryNames),
        stages: Object.fromEntries([...stageNames].map(([id, stage]) => [id, stage.name])),
      }}
    />
  );
}
