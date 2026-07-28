import type { BroadcastReport } from "../../broadcast-send";

export interface RecentBroadcastInfo {
  startedAt: Date | null;
  sentCount: number;
}

export interface BroadcastActionResult {
  report?: BroadcastReport;
  /** Последняя рассылка по этой же стадии — предупреждение о возможном дубле. */
  recentBroadcast?: RecentBroadcastInfo | null;
  /** ID рассылки, поставленной в очередь Hatchet. */
  queuedBroadcastId?: string;
  /** Сколько получателей будет отправлено фоновой задачей. */
  queuedCount?: number;
  error?: string;
}
