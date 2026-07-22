import { decryptSecret, env } from "@psi-opora/config";
import { getBotConnector } from "@psi-opora/db/queries.edge";

/**
 * Токен бота теперь можно вводить в UI при подключении канала (хранится в
 * bot_connectors.bot_token_encrypted) — если он не задан, используем legacy
 * TG_BOT_TOKEN/MAX_BOT_TOKEN из .env, чтобы уже настроенные боты не сломались.
 */
export async function resolveTelegramBotToken(): Promise<string> {
  const row = await getBotConnector("telegram");
  if (row?.botTokenEncrypted) return decryptSecret(row.botTokenEncrypted);
  return env.TG_BOT_TOKEN ?? env.BOT_TOKEN ?? "";
}

export async function resolveMaxBotToken(): Promise<string> {
  const row = await getBotConnector("max");
  if (row?.botTokenEncrypted) return decryptSecret(row.botTokenEncrypted);
  return env.MAX_BOT_TOKEN ?? "";
}
