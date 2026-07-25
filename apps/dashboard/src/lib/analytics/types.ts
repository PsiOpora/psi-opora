export interface DateRange {
  from: Date;
  to: Date;
}

export type DealStatus = "won" | "lost" | "in_progress";

export interface DealRecord {
  id: string;
  title: string;
  stageId: string;
  categoryId: string;
  status: DealStatus;
  opportunity: number;
  currency: string;
  dateCreate: Date;
  closeDate: Date | null;
  sourceId: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  utmTerm: string;
}

export interface DealSummary {
  id: string;
  title: string;
  status: DealStatus;
  opportunity: number;
  dateCreate: Date;
}

export interface GroupStats {
  key: string;
  label: string;
  deals: number;
  won: number;
  opportunitySum: number;
  wonSum: number;
  conversionRate: number;
  /** Сделки, попавшие в группу — для перехода из отчёта в карточки CRM. */
  items: DealSummary[];
}

export interface Summary {
  totalDeals: number;
  wonDeals: number;
  lostDeals: number;
  inProgressDeals: number;
  opportunitySum: number;
  wonSum: number;
  conversionRate: number;
  avgDealSize: number;
  avgCycleDays: number;
}

export interface FunnelStage {
  stageId: string;
  label: string;
  deals: number;
  opportunitySum: number;
  /** Доля от всех сделок воронки за период. */
  share: number;
  /** Итоговый статус сделок стадии (по преобладающему статусу). */
  status: DealStatus;
}

export interface TrendPoint {
  date: string;
  deals: number;
  won: number;
  opportunitySum: number;
}
