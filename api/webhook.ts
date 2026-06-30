import { webhookCallback } from "grammy";
import { createBot } from "../src/bot.js";
import { createUpstashRedis, createRedisStorage } from "../src/storage/upstash.js";
import type { ConsultationSession } from "../src/types/context.js";

export const runtime = "edge";

const redis = createUpstashRedis();
const storage = createRedisStorage<ConsultationSession>(redis);
const bot = createBot(storage);
const handleUpdate = webhookCallback(bot, "std/http");

export async function POST(request: Request): Promise<Response> {
  return handleUpdate(request);
}

export async function GET(): Promise<Response> {
  return new Response("ok");
}
