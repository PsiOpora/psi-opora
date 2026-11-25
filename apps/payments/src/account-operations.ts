import { isAcquiringSettlement } from "./matching";

/**
 * Разбор тела вебхука «Операция по счету» (см. account-webhook.ts) — чистая
 * функция без БД, чтобы её можно было тестировать отдельно.
 */

type Json = Record<string, unknown>;

const asRecord = (v: unknown): Json | null =>
	typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Json) : null;

function pick(obj: Json, ...paths: string[]): unknown {
	for (const path of paths) {
		let node: unknown = obj;
		for (const key of path.split(".")) node = asRecord(node)?.[key];
		if (node !== undefined && node !== null && node !== "") return node;
	}
	return undefined;
}

const str = (v: unknown): string | null =>
	typeof v === "string" || typeof v === "number" ? String(v) : null;

export interface AccountOperation {
	externalId: string;
	amountKopecks: number;
	paidAt: Date;
	payerName: string | null;
	payerInn: string | null;
	purpose: string | null;
	raw: Json;
}

/** Направление: true — зачисление, false — списание, null — не удалось понять. */
function isIncoming(op: Json): boolean | null {
	const direction = String(
		pick(op, "typeOfOperation", "operationType", "direction", "category") ?? "",
	).toLowerCase();
	if (/credit|income|incom|поступ|зачисл/.test(direction)) return true;
	if (/debit|outcome|expense|списан|расход/.test(direction)) return false;
	return null;
}

/** Достаёт операции из тела: одна операция, массив или обёртка с массивом. */
export function normalizeAccountOperations(body: unknown): {
	operations: AccountOperation[];
	skipped: string[];
} {
	const root = asRecord(body);
	const list: unknown[] = Array.isArray(body)
		? body
		: Array.isArray(root?.operations)
			? root.operations
			: root
				? [root]
				: [];

	const operations: AccountOperation[] = [];
	const skipped: string[] = [];
	for (const item of list) {
		const op = asRecord(item);
		if (!op) continue;
		const id = str(pick(op, "operationId", "id"));
		const amount = Number(
			pick(op, "amount", "operationAmount", "accountAmount"),
		);
		if (!id || !Number.isFinite(amount) || amount <= 0) {
			skipped.push(`нет id/суммы: ${JSON.stringify(op).slice(0, 200)}`);
			continue;
		}
		const incoming = isIncoming(op);
		if (incoming === false) continue; // списание — не оплата клиента
		if (incoming === null) {
			skipped.push(`направление неизвестно, id=${id}`);
			continue;
		}
		const purpose = str(pick(op, "paymentPurpose", "purpose"));
		if (isAcquiringSettlement(purpose)) continue; // уже учтено эквайрингом
		const date = new Date(
			String(
				pick(op, "operationDate", "authorizationDate", "date", "trxDate") ??
					Date.now(),
			),
		);
		operations.push({
			externalId: id,
			amountKopecks: Math.round(amount * 100),
			paidAt: Number.isNaN(date.getTime()) ? new Date() : date,
			payerName: str(pick(op, "payerName", "payer.name", "counterParty.name")),
			payerInn: str(pick(op, "payerInn", "payer.inn", "counterParty.inn")),
			purpose,
			raw: op,
		});
	}
	return { operations, skipped };
}
