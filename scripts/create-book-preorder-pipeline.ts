/**
 * Разовое создание воронки «Предзаказ книги» в Bitrix24 для сценария
 * предзаказа книги «Тело берёт своё» (см. план в
 * packages/bot-core/src/scenario/book-preorder/).
 *
 * Создаёт кастомный пайплайн через crm.dealcategory.add (Bitrix сам клонирует
 * туда стандартный набор стадий) и переименовывает 4 нужные под наши имена:
 * первую "процессную" стадию → «Бронь», вторую "процессную" → «Ждёт оплаты»,
 * стадию с семантикой "успех" → «Оплачен», стадию с семантикой "провал" →
 * «Отказ». Ничего не удаляет и не создаёт лишних STATUS_ID — просто
 * переименовывает то, что Bitrix создал сам, поэтому идемпотентно по
 * названию категории (повторный запуск на существующей категории безопасен,
 * но категорию не пересоздаёт — сначала проверяет по имени).
 *
 * После запуска — впиши напечатанные CATEGORY_ID/STAGE_ID в
 * packages/bot-core/src/utils/bitrix/book-preorder-pipeline.ts.
 *
 * Запуск:
 *   bun --env-file=.env run scripts/create-book-preorder-pipeline.ts
 */

const CATEGORY_NAME = "Предзаказ книги";
const STAGE_LABELS = {
	reserved: "Бронь",
	awaitingPayment: "Ждёт оплаты",
	paid: "Оплачен",
	declined: "Отказ",
} as const;

interface BitrixResponse<T> {
	result?: T;
	error?: string;
	error_description?: string;
}

interface DealCategory {
	ID: string;
	NAME: string;
}

interface DealStatus {
	ID: string;
	STATUS_ID: string;
	NAME: string;
	SORT: string;
	SEMANTICS?: "P" | "S" | "F" | "";
	CATEGORY_ID?: string;
}

function webhookBase(): string {
	const value =
		process.env.TG_BITRIX_WEBHOOK_URL ?? process.env.BITRIX_WEBHOOK_URL;
	if (!value) throw new Error("BITRIX_WEBHOOK_URL не задан");
	const normalized = value.trim().replace(/\/+$/, "");
	const url = new URL(normalized);
	if (url.protocol !== "https:") {
		throw new Error("BITRIX_WEBHOOK_URL должен использовать HTTPS");
	}
	return normalized;
}

async function callBitrix<T>(method: string, body: unknown): Promise<T> {
	const response = await fetch(`${webhookBase()}/${method}.json`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const json = (await response.json()) as BitrixResponse<T>;
	if (json.error) {
		throw new Error(
			`Bitrix24 [${method}]: ${json.error} — ${json.error_description ?? ""}`,
		);
	}
	return json.result as T;
}

async function findOrCreateCategory(): Promise<number> {
	const existing = await callBitrix<DealCategory[]>("crm.dealcategory.list", {
		filter: { NAME: CATEGORY_NAME },
	});
	if (existing.length > 0) {
		const id = Number(existing[0]?.ID);
		console.log(`Воронка «${CATEGORY_NAME}» уже существует (ID=${id})`);
		return id;
	}
	const id = await callBitrix<number>("crm.dealcategory.add", {
		fields: { NAME: CATEGORY_NAME },
	});
	console.log(`Создана воронка «${CATEGORY_NAME}» (ID=${id})`);
	return id;
}

async function renameStage(
	stage: DealStatus,
	label: string,
): Promise<{ stageId: string; label: string }> {
	if (stage.NAME !== label) {
		await callBitrix("crm.status.update", {
			id: stage.ID,
			fields: { NAME: label },
		});
	}
	console.log(`  ${label.padEnd(14)} → STAGE_ID=${stage.STATUS_ID}`);
	return { stageId: stage.STATUS_ID, label };
}

async function main() {
	const categoryId = await findOrCreateCategory();
	const stages = await callBitrix<DealStatus[]>("crm.status.list", {
		filter: { ENTITY_ID: `DEAL_STAGE_${categoryId}` },
		order: { SORT: "ASC" },
	});
	if (stages.length === 0) {
		throw new Error(
			`У воронки ${categoryId} нет стадий — Bitrix не успел их создать? Повтори запуск через пару секунд.`,
		);
	}

	const processStages = stages
		.filter((s) => (s.SEMANTICS ?? "P") === "" || s.SEMANTICS === "P")
		.sort((a, b) => Number(a.SORT) - Number(b.SORT));
	const successStage = stages.find((s) => s.SEMANTICS === "S");
	const failStage = stages.find((s) => s.SEMANTICS === "F");

	if (processStages.length < 2 || !successStage || !failStage) {
		throw new Error(
			`Неожиданный набор стадий у воронки ${categoryId} — правь стадии вручную в Bitrix UI и впиши STAGE_ID сам.`,
		);
	}

	console.log(`Стадии воронки (CATEGORY_ID=${categoryId}):`);
	const reserved = await renameStage(
		processStages[0] as DealStatus,
		STAGE_LABELS.reserved,
	);
	const awaitingPayment = await renameStage(
		processStages[1] as DealStatus,
		STAGE_LABELS.awaitingPayment,
	);
	const paid = await renameStage(successStage, STAGE_LABELS.paid);
	const declined = await renameStage(failStage, STAGE_LABELS.declined);

	console.log(
		"\nВпиши в packages/bot-core/src/utils/bitrix/book-preorder-pipeline.ts:",
	);
	console.log(`export const BOOK_PREORDER_CATEGORY_ID = ${categoryId};`);
	console.log("export const BOOK_PREORDER_STAGE_IDS = {");
	console.log(`\treserved: ${JSON.stringify(reserved.stageId)},`);
	console.log(`\tawaitingPayment: ${JSON.stringify(awaitingPayment.stageId)},`);
	console.log(`\tpaid: ${JSON.stringify(paid.stageId)},`);
	console.log(`\tdeclined: ${JSON.stringify(declined.stageId)},`);
	console.log("} as const;");
}

await main();
