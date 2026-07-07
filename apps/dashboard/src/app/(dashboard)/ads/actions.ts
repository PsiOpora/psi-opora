"use server";

import { revalidatePath } from "next/cache";
import { getRedisOrNull } from "@/lib/redis";
import { fetchAdStats } from "@/lib/marketing/ads-api";

export async function refreshAdStatsAction() {
  const redis = getRedisOrNull();
  await fetchAdStats(redis);
  revalidatePath("/ads");
}
