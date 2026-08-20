import type { DealRecord } from "./types";

/** Сырые сделки из JSON (дата в виде ISO-строки) — как их отдаёт /api/dashboard/bitrix. */
export type WireDeal = Omit<DealRecord, "dateCreate" | "closeDate"> & {
	dateCreate: string;
	closeDate: string | null;
};

export function reviveDeal(deal: WireDeal): DealRecord {
	return {
		...deal,
		dateCreate: new Date(deal.dateCreate),
		closeDate: deal.closeDate ? new Date(deal.closeDate) : null,
	};
}

export function reviveDeals(deals: WireDeal[]): DealRecord[] {
	return deals.map(reviveDeal);
}
