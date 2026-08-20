import { NextResponse } from "next/server";
import { previousRange } from "@/lib/analytics/date-range";
import type { DateRange } from "@/lib/analytics/types";
import {
  fetchCategoryNames,
  fetchDeals,
  fetchOpenDeals,
  fetchSourceNames,
  fetchStageNames,
} from "@/lib/analytics/deals";
import { getBitrixPortalDomain } from "@/lib/bitrix/deal-link";
import { getBitrixApi } from "@/lib/bitrix/session";

export const dynamic = "force-dynamic";

function rangeFromParams(url: URL): DateRange {
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const to = toParam ? new Date(toParam) : new Date();
  const from = fromParam
    ? new Date(fromParam)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from, to };
}

/**
 * Общий эндпоинт для дашборд-страниц, читающих сделки/справочники Bitrix24 —
 * заменяет прямой вызов getBitrixApi()/fetchDeals() из серверных компонентов
 * страниц (см. CONTEXT в задаче про клиентские страницы). `need` — список
 * через запятую: deals, previousDeals, sourceNames, categoryNames,
 * stageNames, dealDomain, openDeals.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const need = new Set(
    (url.searchParams.get("need") ?? "").split(",").filter(Boolean),
  );

  const api = await getBitrixApi();
  if (!api) {
    return NextResponse.json({ connected: false });
  }

  const range = rangeFromParams(url);

  try {
    const [
      deals,
      previousDeals,
      sourceNames,
      categoryNames,
      stageNames,
      dealDomain,
      openDeals,
    ] = await Promise.all([
      need.has("deals") ? fetchDeals(api, range) : Promise.resolve(undefined),
      need.has("previousDeals")
        ? fetchDeals(api, previousRange(range))
        : Promise.resolve(undefined),
      need.has("sourceNames")
        ? fetchSourceNames(api)
        : Promise.resolve(undefined),
      need.has("categoryNames")
        ? fetchCategoryNames(api)
        : Promise.resolve(undefined),
      need.has("stageNames") ? fetchStageNames(api) : Promise.resolve(undefined),
      need.has("dealDomain")
        ? getBitrixPortalDomain()
        : Promise.resolve(undefined),
      need.has("openDeals") ? fetchOpenDeals(api) : Promise.resolve(undefined),
    ]);

    return NextResponse.json({
      connected: true,
      deals,
      previousDeals,
      sourceNames: sourceNames ? [...sourceNames.entries()] : undefined,
      categoryNames: categoryNames ? [...categoryNames.entries()] : undefined,
      stageNames: stageNames ? [...stageNames.entries()] : undefined,
      dealDomain,
      openDeals,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("INVALID_CREDENTIALS")
    ) {
      return NextResponse.json({ connected: false });
    }
    console.error("[api/dashboard/bitrix] error:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    );
  }
}
