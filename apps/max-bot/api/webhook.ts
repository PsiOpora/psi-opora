import type { IncomingMessage, ServerResponse } from "node:http";

// platform-api2.max.ru использует Russian Trusted Root CA, отсутствующий
// в доверенном хранилище Node.js — отключаем проверку сертификатов.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import {
  createUpstashRedis,
  createRedisStorage,
  type ConsultationSession,
} from "@psi-opora/bot-core";
import { createMaxBot, processUpdate } from "../src/bot.js";

const redis = createUpstashRedis();
const storage = createRedisStorage<ConsultationSession>(redis);
const bot = createMaxBot({ storage });

type VercelRequest = IncomingMessage & { body?: unknown };

export default async function handler(
  req: VercelRequest,
  res: ServerResponse,
): Promise<void> {
  if (req.method === "GET") {
    res.statusCode = 200;
    res.end("ok");
    return;
  }
  await processUpdate(bot, req.body);
  res.statusCode = 200;
  res.end("ok");
}
