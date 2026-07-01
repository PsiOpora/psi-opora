import type { DateRange } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

export function parseDateRange(searchParams: Record<string, string | string[] | undefined>): DateRange {
  const fromParam = typeof searchParams.from === "string" ? searchParams.from : undefined;
  const toParam = typeof searchParams.to === "string" ? searchParams.to : undefined;

  const to = toParam ? new Date(toParam) : new Date();
  const from = fromParam ? new Date(fromParam) : new Date(to.getTime() - 30 * DAY_MS);

  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

export function formatDateParam(date: Date): string {
  return date.toISOString().slice(0, 10);
}
