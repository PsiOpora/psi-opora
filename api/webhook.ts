import { Hono } from "hono";
import { handle } from "hono/vercel";
import { webhookCallback } from "grammy";
import { createBot } from "../src/bot.js";
import { createUpstashRedis, createRedisStorage } from "../src/storage/upstash.js";
import type { ConsultationSession } from "../src/types/context.js";

export const config = { runtime: "nodejs" };

const redis = createUpstashRedis();
const storage = createRedisStorage<ConsultationSession>(redis);
const bot = createBot(storage);

const app = new Hono().basePath("/api");
app.post("/webhook", webhookCallback(bot, "hono"));

export default handle(app);
