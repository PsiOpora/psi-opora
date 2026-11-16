import { expect, test } from "bun:test";
import { normalizeAccountOperations } from "../src/account-operations";

test("зачисление: рубли → копейки, плательщик и назначение", () => {
	const { operations } = normalizeAccountOperations({
		operationId: "op-1",
		typeOfOperation: "Credit",
		amount: 12500.5,
		operationDate: "2026-11-10T12:00:00Z",
		payerName: "Иванов И.И.",
		paymentPurpose: "Оплата по сделке 10",
	});
	expect(operations).toHaveLength(1);
	expect(operations[0]).toMatchObject({
		externalId: "op-1",
		amountKopecks: 1_250_050,
		payerName: "Иванов И.И.",
		purpose: "Оплата по сделке 10",
	});
});

test("списания и расчёты эквайринга не попадают в оплаты", () => {
	const { operations, skipped } = normalizeAccountOperations([
		{ operationId: "d", typeOfOperation: "Debit", amount: 100 },
		{
			operationId: "s",
			typeOfOperation: "Credit",
			amount: 5000,
			paymentPurpose: "Расчёты по операциям интернет-эквайринга",
		},
	]);
	expect(operations).toHaveLength(0);
	expect(skipped).toHaveLength(0);
});

test("неизвестное направление — пропуск с причиной, а не молчаливая оплата", () => {
	const { operations, skipped } = normalizeAccountOperations({
		operationId: "x",
		amount: 100,
	});
	expect(operations).toHaveLength(0);
	expect(skipped).toHaveLength(1);
});

test("массив внутри обёртки operations", () => {
	const { operations } = normalizeAccountOperations({
		operations: [
			{ id: "a", operationType: "income", amount: 1 },
			{ id: "b", operationType: "income", amount: 2 },
		],
	});
	expect(operations.map((o) => o.externalId)).toEqual(["a", "b"]);
});
