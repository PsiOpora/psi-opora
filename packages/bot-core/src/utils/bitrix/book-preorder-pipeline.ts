import { bitrixPost } from "./client";

/**
 * Воронка «Предзаказ книги «Тело берёт своё»» (лендинг
 * psi-opora.ru/telo-beret-svoe/) — переиспользует существующую в Bitrix24
 * категорию сделок id=8 (раньше называлась «Психологи»), переименованную и
 * с переименованными стадиями вручную через MCP-коннектор bitrix24:
 * заводить новую категорию нельзя — crm.dealcategory.add заблокирован
 * тарифом (см. историю коммитов и scripts/create-book-preorder-pipeline.ts,
 * которые пришлось убрать по этой же причине).
 */
export const BOOK_PREORDER_CATEGORY_ID = 8;

export const BOOK_PREORDER_STAGE_IDS = {
	/** Оставил имя и телефон, но ещё не выбрал бронь или оплату. */
	newRequest: "C8:NEW",
	reserved: "C8:UC_0HJ3ZP",
	awaitingPayment: "C8:AMO_65CAC4EC",
	paid: "C8:EXECUTING",
	declined: "C8:LOSE",
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
		throw err;
	}
}

/**
 * То же, но без проброса ошибки — для мест, где сбой Bitrix не должен
 * помешать ответить клиенту (выдать ссылку на оплату, подтвердить отмену).
 * Ошибка уже залогирована в moveBookPreorderDealStage.
 */
export async function tryMoveBookPreorderDealStage(
	messenger: string,
	dealId: number,
	stage: BookPreorderStage,
): Promise<void> {
	try {
		await moveBookPreorderDealStage(messenger, dealId, stage);
	} catch {
		// см. комментарий выше
	}
}
