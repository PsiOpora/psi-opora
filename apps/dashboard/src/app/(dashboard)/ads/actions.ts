"use server";

import { revalidatePath } from "next/cache";
import { getRedisOrNull } from "@/lib/redis";
import { fetchAdStats } from "@/lib/marketing/ads-api";
import { orpc } from "@/lib/orpc-client";

export async function refreshAdStatsAction() {
  const [redis, creds] = await Promise.all([
    Promise.resolve(getRedisOrNull()),
    orpc.ads.getCredentials().catch(() => null),
  ]);
  await fetchAdStats(redis, creds);
  revalidatePath("/ads");
}
