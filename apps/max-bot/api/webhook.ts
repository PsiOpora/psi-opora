import { webhookCallback } from "grammy";
import { createBot, createUpstashRedis, createRedisStorage, type ConsultationSession } from "../../../packages/bot-core/src/index.ts";

export const config = { runtime: "edge" };

const MAX_API_ROOT = "https://botapi.max.ru";

const redis = createUpstashRedis();
const storage = createRedisStorage<ConsultationSession>(redis);
const bot = createBot({ storage, apiRoot: MAX_API_ROOT, messenger: "max" });
const handleUpdate = webhookCallback(bot, "std/http");

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "GET") return new Response("ok");
  return handleUpdate(req);
}
