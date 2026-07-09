import {
  type ConsultationSession,
  createRedisStorage,
  createUpstashRedis,
} from "@psi-opora/bot-core";
import { createMaxBot, processUpdate } from "../src/bot.js";

const redis = createUpstashRedis();
const storage = createRedisStorage<ConsultationSession>(redis);
const bot = createMaxBot({ storage });

export async function POST(request: Request): Promise<Response> {
  const body = await request.json();
  await processUpdate(bot, body);
  return new Response("ok");
}

export function GET(): Response {
  return new Response("ok");
}
