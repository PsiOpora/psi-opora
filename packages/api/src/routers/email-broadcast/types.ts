import type { EmailRecipientsReport } from "../../email-campaign-collect";

export interface RecentEmailCampaignInfo {
  startedAt: Date | null;
  recipientsCount: number | null;
}

export interface EmailCampaignActionResult {
  report?: EmailRecipientsReport;
  /** Последняя кампания по этой же стадии — предупреждение о возможном дубле. */
  recentCampaign?: RecentEmailCampaignInfo | null;
  /** ID кампании, поставленной в очередь Hatchet. */
  queuedCampaignId?: string;
  /** Сколько получателей будет отправлено фоновой задачей. */
  queuedCount?: number;
  error?: string;
}
