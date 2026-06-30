import { webhookCallback } from "grammy";
import { createBot, createUpstashRedis, createRedisStorage, type ConsultationSession } from "@psi-opora/bot-core";

export const runtime = "edge";

const redis = createUpstashRedis();
const storage = createRedisStorage<ConsultationSession>(redis);
const bot = createBot({ storage, messenger: "telegram" });
const handleUpdate = webhookCallback(bot, "std/http");

export async function POST(request: Request): Promise<Response> {
  return handleUpdate(request);
}

export async function GET(): Promise<Response> {
  return new Response("ok");
}
