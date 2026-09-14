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

import { z } from "zod";

const CATEGORY_NAME = "Предзаказ книги";
const STAGE_LABELS = {
	reserved: "Бронь",
	awaitingPayment: "Ждёт оплаты",
	paid: "Оплачен",
	declined: "Отказ",
} as const;

function bitrixResponseSchema<T extends z.ZodType>(result: T) {
	return z.object({
		result: result.optional(),
		error: z.string().optional(),
		error_description: z.string().optional(),
	});
}

const dealCategorySchema = z.object({
	ID: z.string(),
	NAME: z.string(),
});

const dealStatusSchema = z.object({
	ID: z.string(),
	STATUS_ID: z.string(),
	NAME: z.string(),
	SORT: z.string(),
	SEMANTICS: z.enum(["P", "S", "F", ""]).optional(),
	CATEGORY_ID: z.string().optional(),
});
type DealStatus = z.infer<typeof dealStatusSchema>;

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

async function callBitrix<T extends z.ZodType>(
	method: string,
	body: unknown,
	resultSchema: T,
): Promise<z.infer<T>> {
	const response = await fetch(`${webhookBase()}/${method}.json`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const raw: unknown = await response.json();
	const envelope = bitrixResponseSchema(resultSchema).parse(raw);
	// Bitrix иногда шлёт error: "" с непустым error_description (напр. когда
	// действие недоступно на тарифе) — `if (envelope.error)` не заметил бы
	// это, т.к. пустая строка ложна, поэтому дополнительно проверяем HTTP-статус
	// и error_description.
	if (!response.ok || envelope.error || envelope.error_description) {
		throw new Error(
			`Bitrix24 [${method}] (HTTP ${response.status}): ${envelope.error || "—"} — ${envelope.error_description ?? ""}`,
		);
	}
	if (envelope.result === undefined) {
		throw new Error(`Bitrix24 [${method}]: ответ без result`);
	}
	return envelope.result;
}

async function findOrCreateCategory(): Promise<number> {
	const existing = await callBitrix(
		"crm.dealcategory.list",
		{ filter: { NAME: CATEGORY_NAME } },
		z.array(dealCategorySchema),
	);
	if (existing.length > 0) {
		const id = Number(existing[0]?.ID);
		console.log(`Воронка «${CATEGORY_NAME}» уже существует (ID=${id})`);
		return id;
	}
	const id = await callBitrix(
		"crm.dealcategory.add",
		{ fields: { NAME: CATEGORY_NAME } },
		z.number(),
	);
	console.log(`Создана воронка «${CATEGORY_NAME}» (ID=${id})`);
	return id;
}

async function renameStage(
	stage: DealStatus,
	label: string,
): Promise<{ stageId: string; label: string }> {
	if (stage.NAME !== label) {
		await callBitrix(
			"crm.status.update",
			{ id: stage.ID, fields: { NAME: label } },
			z.unknown(),
		);
	}
	console.log(`  ${label.padEnd(14)} → STAGE_ID=${stage.STATUS_ID}`);
	return { stageId: stage.STATUS_ID, label };
}

async function main() {
	const categoryId = await findOrCreateCategory();
	const stages = await callBitrix(
		"crm.status.list",
		{
			filter: { ENTITY_ID: `DEAL_STAGE_${categoryId}` },
			order: { SORT: "ASC" },
		},
		z.array(dealStatusSchema),
	);
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
