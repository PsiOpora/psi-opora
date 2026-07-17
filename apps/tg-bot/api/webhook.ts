import {
  type ConsultationSession,
  createBot,
  createRedisStorage,
  createUpstashRedis,
} from "@psi-opora/bot-core";
import { webhookCallback } from "grammy";

export const config = { runtime: "edge" };

const redis = createUpstashRedis();
const storage = createRedisStorage<ConsultationSession>(redis);
const bot = createBot({ storage, redis });
const handleUpdate = webhookCallback(bot, "std/http");

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "GET") return new Response("ok");
  return handleUpdate(req);
}
