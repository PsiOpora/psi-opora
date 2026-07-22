import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import {
  type ConsultationSession,
  createRedisStorage,
  createUpstashRedis,
  resolveMaxBotToken,
} from "@psi-opora/bot-core";
import { env } from "@psi-opora/config";
import { createMaxBot, processUpdate } from "../src/bot.js";

const redis = createUpstashRedis();
const storage = createRedisStorage<ConsultationSession>(redis);
// resolveBitrixApi(undefined) откатывается на DASHBOARD_BITRIX_WEBHOOK_URL,
// который для imconnector.* не подходит (нужен OAuth) — поэтому передаём
// bitrixApi только когда BITRIX_MEMBER_ID реально задан.
const bitrixApi = env.BITRIX_MEMBER_ID
  ? resolveBitrixApi(env.BITRIX_MEMBER_ID)
  : undefined;
const token = await resolveMaxBotToken();
const bot = createMaxBot({ storage, redis, bitrixApi: bitrixApi ?? undefined, token });

export async function POST(request: Request): Promise<Response> {
  const body = await request.json();
  await processUpdate(bot, body);
  return new Response("ok");
}

export function GET(): Response {
  return new Response("ok");
}
