import { bitrixPost } from "./client";

/**
 * Воронка «Предзаказ книги» (лендинг psi-opora.ru/telo-beret-svoe/) —
 * заводится один раз скриптом scripts/create-book-preorder-pipeline.ts
 * (crm.dealcategory.add + crm.status.add). Значения ниже — заглушки,
 * замени на реальные ID, которые скрипт напечатает после запуска
 * (по образцу DEAL_CATEGORY_ID/DEAL_STAGE_IDS в
 * packages/jobs/src/reminders/shared.ts).
 */
export const BOOK_PREORDER_CATEGORY_ID = 0;

/**
 * Значения ниже — заглушки. crm.status.list у кастомной воронки (CATEGORY_ID
 * > 0) отдаёт STATUS_ID уже в полном виде "C{categoryId}:{STAGE}" — именно
 * так их и печатает scripts/create-book-preorder-pipeline.ts, копируй без
 * изменений в STAGE_ID при crm.deal.update.
 */
export const BOOK_PREORDER_STAGE_IDS = {
	reserved: "NEW",
	awaitingPayment: "UC_BOOK_AWAITING_PAYMENT",
	paid: "UC_BOOK_PAID",
	declined: "UC_BOOK_DECLINED",
} as const;

export type BookPreorderStage = keyof typeof BOOK_PREORDER_STAGE_IDS;

/** Переводит сделку предзаказа на нужную стадию воронки. */
export async function moveBookPreorderDealStage(
	messenger: string,
	dealId: number,
	stage: BookPreorderStage,
): Promise<void> {
	try {
		await bitrixPost(
			"crm.deal.update",
			{ id: dealId, fields: { STAGE_ID: BOOK_PREORDER_STAGE_IDS[stage] } },
			messenger,
		);
	} catch (err) {
		console.error(
			`[bitrix] не удалось перевести сделку предзаказа ${dealId} на стадию ${stage}: ${(err as Error).message}`,
		);
	}
}
