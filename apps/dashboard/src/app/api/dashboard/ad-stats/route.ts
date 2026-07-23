import { NextResponse } from "next/server";
import { type AdStatsResult, fetchAdStats, getCachedAdStats } from "@psi-opora/api";
import { orpc } from "@/lib/orpc/server";
import { getRedisOrNull } from "@/lib/redis";

export const dynamic = "force-dynamic";

/** Живые данные рекламных кабинетов (Redis-кэш → живой API) для страницы /ads. */
export async function GET() {
  const redis = getRedisOrNull();

  let data: AdStatsResult | null = null;
  let loadError = false;

  if (redis) {
    data = await getCachedAdStats(redis);
  }

  if (!data) {
    try {
      const creds = await orpc.ads.getCredentials().catch(() => null);
      data = await fetchAdStats(redis, creds);
    } catch {
      loadError = true;
    }
  }

  return NextResponse.json({
    data: loadError ? null : data,
    redisConfigured: Boolean(redis),
  });
}
