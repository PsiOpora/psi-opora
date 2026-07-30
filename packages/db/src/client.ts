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

  // Dynamically import node-postgres so that the `pg` native module (and the
  // `node:module`/`createRequire` interop it otherwise needs) is not loaded
  // or bundled in edge runtimes (e.g. Vercel Edge Functions) when the
  // neon-http driver is used.
  const [{ Pool }, { drizzle: drizzlePg }] = await Promise.all([
    import("pg"),
    import("drizzle-orm/node-postgres"),
  ]);
  const pool = new Pool({ connectionString });
  // Без обработчика идле-клиенты, оборвавшие соединение, могут оставить пул
  // в битом состоянии до перезапуска процесса — просто логируем и даём pg
  // пересоздать клиента самостоятельно.
  pool.on("error", (err) => {
    console.error("[db] postgres pool error:", err.message);
  });
  return drizzlePg({ client: pool, schema, casing: "snake_case" });
}

export const db: Database = await createDatabase();
