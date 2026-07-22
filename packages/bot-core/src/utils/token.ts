import { decryptSecret } from "@psi-opora/config";
import { getBotConnector } from "@psi-opora/db/queries.edge";

/**
 * Токен бота вводится в UI при подключении канала (хранится зашифрованным в
 * bot_connectors.bot_token_encrypted) — без env-фолбэка: администратор
 * обязан ввести токен через виджет активации канала.
 */
export async function resolveTelegramBotToken(): Promise<string> {
  const row = await getBotConnector("telegram");
  return row?.botTokenEncrypted ? decryptSecret(row.botTokenEncrypted) : "";
}

export async function resolveMaxBotToken(): Promise<string> {
  const row = await getBotConnector("max");
  return row?.botTokenEncrypted ? decryptSecret(row.botTokenEncrypted) : "";
}
