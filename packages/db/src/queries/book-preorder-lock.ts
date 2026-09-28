import { env } from "@psi-opora/config";
import postgres from "postgres";

let lockClient: ReturnType<typeof postgres> | undefined;

/**
 * Serializes order mutations and their Bitrix calls across bot/webhook workers.
 * Use a separate TCP pool (also supported by Neon): queries inside fn use the
 * regular pool, so waiting locks must not exhaust its connections. A transaction
 * lock has no lease that could expire while a Bitrix request is still running,
 * and PostgreSQL releases it on rollback or connection loss.
 * Callers must not acquire this lock recursively for the same order.
 */
export async function withBookPreorderOrderLock<T>(
	id: string,
	fn: () => Promise<T>,
): Promise<T> {
	if (!env.POSTGRES_URL)
		throw new Error("POSTGRES_URL is required for order locks");
	lockClient ??= postgres(env.POSTGRES_URL, {
		max: 5,
		idle_timeout: 10,
		connect_timeout: 10,
	});
	const result = await lockClient.begin(async (transaction) => {
		await transaction`SELECT pg_advisory_xact_lock(hashtext('book-preorder'), hashtext(${id}))`;
		return { value: await fn() };
	});
	return result.value;
}
