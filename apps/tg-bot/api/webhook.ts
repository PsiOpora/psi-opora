import type { IncomingMessage, ServerResponse } from "node:http";
import {
  type ConsultationSession,
  createBot,
  createRedisStorage,
  createUpstashRedis,
} from "@psi-opora/bot-core";
import { webhookCallback } from "grammy";

const redis = createUpstashRedis();
const storage = createRedisStorage<ConsultationSession>(redis);
const bot = createBot({ storage, redis });
const handleUpdate = webhookCallback(bot, "http");

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method === "GET") {
    res.end("ok");
    return;
  }
  await handleUpdate(req, res);
}
