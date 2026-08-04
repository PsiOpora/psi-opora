import { env } from "@psi-opora/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

if (!env.POSTGRES_URL) {
	throw new Error("POSTGRES_URL не задан");
}

const connectionString = env.POSTGRES_URL.replace(":6543", ":5432");
const client = postgres(connectionString, { max: 1 });

function postgresError(error: unknown): { code?: string; message: string } {
	const outer = error as { message?: string; cause?: unknown };
	const cause = outer.cause as { code?: string; message?: string } | undefined;
	return {
		code: cause?.code,
		message: cause?.message ?? outer.message ?? String(error),
	};
}

try {
	await migrate(drizzle(client), { migrationsFolder: "./migrations" });
	console.log("Миграции БД успешно применены");
} catch (error) {
	const failure = postgresError(error);
	if (failure.code === "28P01") {
		console.error(
			"Миграция БД не выполнена: PostgreSQL отклонил логин или пароль из POSTGRES_URL (код 28P01)",
		);
	} else {
		console.error(
			`Миграция БД не выполнена${failure.code ? ` (PostgreSQL ${failure.code})` : ""}: ${failure.message}`,
		);
	}
	process.exitCode = 1;
} finally {
	await client.end();
}
