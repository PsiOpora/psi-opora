import { neon } from "@neondatabase/serverless";
import { env } from "@psi-opora/config";
import { drizzle as drizzleNeonHttp } from "drizzle-orm/neon-http";
import type { Database } from "./client.types";
import { selectDbDriver } from "./driver";
import * as schema from "./schema";

/**
 * Unified database type used across the codebase.
 *
 * Both the `node-postgres` and `neon-http` drivers extend `PgDatabase` with
 * different query-result HKTs but share the same relational query API for a
 * given schema.  Using `PgDatabase` as the common interface avoids unsafe
 * double-casting while keeping full access to select/insert/update/delete and
 * the relational `query` builder.
 */

async function createDatabase(): Promise<Database> {
  const connectionString = env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error(
      "POSTGRES_URL environment variable is not set. Please configure it in your environment.",
    );
  }

  const driver = selectDbDriver(connectionString);

  if (driver === "neon-http") {
    const sql = neon(connectionString);
    return drizzleNeonHttp(sql, {
      schema,
      casing: "snake_case",
    });
  }

  // Dynamically import postgres.js so it's not loaded or bundled in edge
  // runtimes (e.g. Vercel Edge Functions) when the neon-http driver is used.
  //
  // Use postgres.js instead of node-postgres (`pg`) here: under Bun,
  // long-lived `pg` pools stop recovering after the server (or network)
  // silently drops an idle connection — every later query fails forever
  // with "Connection terminated unexpectedly" until the process restarts
  // (see oven-sh/bun#18013, #21559). postgres.js detects dropped
  // connections and transparently reconnects instead of leaving the pool
  // permanently broken.
  const [postgres, { drizzle: drizzlePostgresJs }] = await Promise.all([
    import("postgres"),
    import("drizzle-orm/postgres-js"),
  ]);
  const sql = postgres.default(connectionString, {
    // Без этого мёртвый (тихо оборванный сетью) сокет остаётся в пуле как
    // будто живой: следующий запрос зависает на TCP-таймаут (замечено ~2 мин)
    // вместо того чтобы сразу открыть новое соединение. Значение ниже, чем
    // сетевой idle-таймаут k3s (наблюдались обрывы уже после ~30с простоя),
    // чтобы клиент закрывал соединение сам, не натыкаясь на уже мёртвый сокет.
    idle_timeout: 10,
    connect_timeout: 10,
    max_lifetime: 60 * 30,
  });
  return drizzlePostgresJs(sql, { schema, casing: "snake_case" });
}

export const db: Database = await createDatabase();
