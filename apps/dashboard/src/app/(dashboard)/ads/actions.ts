"use server";

import { revalidatePath } from "next/cache";
import { getRedisOrNull } from "@/lib/redis";
import { fetchAdStats } from "@/lib/marketing/ads-api";
import { orpc } from "@/lib/orpc-client";

export async function refreshAdStatsAction(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const [redis, creds] = await Promise.all([
    Promise.resolve(getRedisOrNull()),
    orpc.ads.getCredentials().catch(() => null),
  ]);
  try {
    await fetchAdStats(redis, creds);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  revalidatePath("/ads");
  return { ok: true };
}
