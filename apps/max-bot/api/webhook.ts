import {
  type ConsultationSession,
  createRedisStorage,
  createUpstashRedis,
} from "@psi-opora/bot-core";
import { createMaxBot, processUpdate } from "../src/bot.js";

const redis = createUpstashRedis();
const storage = createRedisStorage<ConsultationSession>(redis);
const bot = createMaxBot({ storage });

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "GET") return new Response("ok");

  await processUpdate(bot, req.body);
  return new Response("ok");
}
