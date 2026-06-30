import { Hono } from "hono";
import { handle } from "hono/vercel";
import { webhookCallback } from "grammy";
import { createBot } from "./src/bot.js";
import { createUpstashRedis, createRedisStorage } from "./src/storage/upstash.js";
import type { ConsultationSession } from "./src/types/context.js";

export const runtime = "edge";

const redis = createUpstashRedis();
const storage = createRedisStorage<ConsultationSession>(redis);
const bot = createBot(storage);

const app = new Hono();
app.post("/api/webhook", webhookCallback(bot, "hono"));
app.get("/", (c) => c.text("ok"));

export default handle(app);
