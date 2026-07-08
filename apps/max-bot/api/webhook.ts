import type { IncomingMessage, ServerResponse } from "node:http";

export const config = { runtime: "edge" };

import {
  createUpstashRedis,
  createRedisStorage,
  type ConsultationSession,
} from "@psi-opora/bot-core";
import { createMaxBot, processUpdate } from "../src/bot";

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
