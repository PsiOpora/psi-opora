import { getRedisOrNull } from "@/lib/redis";

export interface CostEntry {
  id: string;
  /** Месяц расходов в формате YYYY-MM. */
  month: string;
  utmSource: string;
  /** Пустая строка — расход на источник целиком, без разбивки по кампаниям. */
  utmCampaign: string;
  amount: number;
  note: string;
  createdAt: string;
}

const COSTS_KEY = "marketing:costs";

export async function listCosts(): Promise<CostEntry[]> {
  const redis = getRedisOrNull();
  if (!redis) return [];
  const hash = await redis.hgetall<Record<string, CostEntry>>(COSTS_KEY);
  if (!hash) return [];
  return Object.values(hash).sort(
    (a, b) =>
      b.month.localeCompare(a.month) || a.utmSource.localeCompare(b.utmSource),
  );
}

export async function addCost(
  entry: Omit<CostEntry, "id" | "createdAt">,
): Promise<void> {
  const redis = getRedisOrNull();
  if (!redis) return;
  const id = crypto.randomUUID();
  await redis.hset(COSTS_KEY, {
    [id]: { ...entry, id, createdAt: new Date().toISOString() },
  });
}

export async function deleteCost(id: string): Promise<void> {
  const redis = getRedisOrNull();
  if (!redis) return;
  await redis.hdel(COSTS_KEY, id);
}

/** Месяц YYYY-MM пересекается с периодом? */
export function monthIntersectsRange(
  month: string,
  from: Date,
  to: Date,
): boolean {
  const [year, monthIndex] = month.split("-").map(Number);
  if (!year || !monthIndex) return false;
  const monthStart = new Date(year, monthIndex - 1, 1);
  const monthEnd = new Date(year, monthIndex, 0, 23, 59, 59, 999);
  return monthStart <= to && monthEnd >= from;
}
