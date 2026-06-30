import { webhookCallback } from "grammy";
import { createBot, createUpstashRedis, createRedisStorage, type ConsultationSession } from "@psi-opora/bot-core";

export const runtime = "edge";

const MAX_API_ROOT = "https://botapi.max.ru";

const redis = createUpstashRedis();
const storage = createRedisStorage<ConsultationSession>(redis);
const bot = createBot({ storage, apiRoot: MAX_API_ROOT, messenger: "max" });
const handleUpdate = webhookCallback(bot, "std/http");

export async function POST(request: Request): Promise<Response> {
  return handleUpdate(request);
}

export async function GET(): Promise<Response> {
  return new Response("ok");
}
