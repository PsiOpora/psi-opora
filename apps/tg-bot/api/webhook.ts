import { webhookCallback } from "grammy";
import { createBot, createUpstashRedis, createRedisStorage, type ConsultationSession } from "@psi-opora/bot-core";

export const config = { runtime: "edge" };

const redis = createUpstashRedis();
const storage = createRedisStorage<ConsultationSession>(redis);
const bot = createBot({ storage, messenger: "telegram" });
const handleUpdate = webhookCallback(bot, "std/http");

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "GET") return new Response("ok");
  return handleUpdate(req);
}
