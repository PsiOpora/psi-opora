import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

export const db =
  connectionString
    ? drizzle(neon(connectionString), { schema, casing: "snake_case" })
    : null;

export { schema };
