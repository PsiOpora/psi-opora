import { resolveBitrixApi } from "@psi-opora/bitrix-client";
import { env } from "@psi-opora/config";
import { createMaxBot } from "./bot";

const bitrixApi = env.BITRIX_MEMBER_ID
  ? resolveBitrixApi(env.BITRIX_MEMBER_ID)
  : undefined;
const bot = createMaxBot({ bitrixApi: bitrixApi ?? undefined });

bot.botInfo = await bot.api.getMyInfo();
console.log(`[BOT] max-bot запущен: @${bot.botInfo.username}. Polling...`);
await bot.start();
