import { and, eq } from "drizzle-orm";
import { db } from "../client";
import { maxPersonalAccounts } from "../schema/max-personal";

export type MaxPersonalAccount = typeof maxPersonalAccounts.$inferSelect;
export type MaxPersonalAccountStatus = "connected" | "error";

export async function listMaxPersonalAccounts(
	memberId: string,
): Promise<MaxPersonalAccount[]> {
	if (!db) return [];
	return db
		.select()
		.from(maxPersonalAccounts)
		.where(eq(maxPersonalAccounts.memberId, memberId));
}

export async function listConnectedMaxPersonalAccounts(): Promise<
	MaxPersonalAccount[]
> {
	if (!db) return [];
	return db
		.select()
		.from(maxPersonalAccounts)
		.where(
			eq(
				maxPersonalAccounts.status,
				"connected" satisfies MaxPersonalAccountStatus,
			),
		);
}

export async function getMaxPersonalAccountByConnector(
	connectorId: string,
	openLineId: string,
): Promise<MaxPersonalAccount | null> {
	if (!db) return null;
	const [row] = await db
		.select()
		.from(maxPersonalAccounts)
		.where(
			and(
				eq(maxPersonalAccounts.connectorId, connectorId),
				eq(maxPersonalAccounts.openLineId, openLineId),
			),
		)
		.limit(1);
	return row ?? null;
}

export async function upsertMaxPersonalAccountConnected(data: {
	memberId: string;
	openLineId: string;
	connectorId: string;
	phone: string;
	sessionEncrypted: string;
}): Promise<void> {
	if (!db) return;
	await db
		.insert(maxPersonalAccounts)
		.values({
			id: crypto.randomUUID(),
			...data,
			status: "connected" satisfies MaxPersonalAccountStatus,
			lastError: null,
		})
		.onConflictDoUpdate({
			target: [
				maxPersonalAccounts.memberId,
				maxPersonalAccounts.openLineId,
				maxPersonalAccounts.connectorId,
			],
			set: {
				phone: data.phone,
				sessionEncrypted: data.sessionEncrypted,
				status: "connected" satisfies MaxPersonalAccountStatus,
				lastError: null,
				updatedAt: new Date(),
			},
		});
}

export async function markMaxPersonalAccountError(
	memberId: string,
	openLineId: string,
	connectorId: string,
	error: string,
): Promise<void> {
	if (!db) return;
	await db
		.update(maxPersonalAccounts)
		.set({
			status: "error" satisfies MaxPersonalAccountStatus,
			lastError: error,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(maxPersonalAccounts.memberId, memberId),
				eq(maxPersonalAccounts.openLineId, openLineId),
				eq(maxPersonalAccounts.connectorId, connectorId),
			),
		);
}

export async function removeMaxPersonalAccount(
	memberId: string,
	openLineId: string,
	connectorId: string,
): Promise<void> {
	if (!db) return;
	await db
		.delete(maxPersonalAccounts)
		.where(
			and(
				eq(maxPersonalAccounts.memberId, memberId),
				eq(maxPersonalAccounts.openLineId, openLineId),
				eq(maxPersonalAccounts.connectorId, connectorId),
			),
		);
}
