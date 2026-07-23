import { NextResponse } from "next/server";
import { fetchBotFunnelEvents } from "@/lib/analytics/bot-funnel";
import { isRedisConfigured } from "@/lib/redis";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const toParam = url.searchParams.get("to");
  const fromParam = url.searchParams.get("from");
  const to = toParam ? new Date(toParam) : new Date();
  const from = fromParam
    ? new Date(fromParam)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);

  if (!isRedisConfigured()) {
    return NextResponse.json({ events: [], redisConfigured: false });
  }

  const events = await fetchBotFunnelEvents({ from, to });
  return NextResponse.json({ events, redisConfigured: true });
}
