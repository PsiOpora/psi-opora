import { env } from "@psi-opora/config";
import type { Config } from "drizzle-kit";

if (!env.POSTGRES_URL) {
	throw new Error("Missing POSTGRES_URL");
}

const nonPoolingUrl = env.POSTGRES_URL.replace(":6543", ":5432");

export default {
	schema: "./src/schema/index.ts",
	out: "./migrations",
	dialect: "postgresql",
	dbCredentials: { url: nonPoolingUrl },
	casing: "snake_case",
} satisfies Config;
