/**
 * Частые ошибки Telegram Bot API и MAX API приходят на английском (или как
 * технический код) и без перевода непонятны оператору в интерфейсе. Здесь
 * сопоставляем известные подстроки читаемому русскому тексту; всё остальное
 * (включая уже русские ошибки из messenger.ts — токен не задан, лимит
 * запросов) возвращаем как есть.
 */
const MESSENGER_ERROR_MESSAGES: Record<string, string> = {
  "chat not found":
    "Диалог с клиентом в Telegram не найден — возможно, он не писал боту или удалил чат",
  "bot was blocked by the user":
    "Пользователь заблокировал бота в Telegram",
  "user is deactivated":
    "Аккаунт пользователя в Telegram удалён или деактивирован",
  "message is too long":
    "Слишком длинное сообщение — Telegram/MAX его не принимает",
  "error.dialog.notfound":
    "Диалог с клиентом в MAX не найден — возможно, он не писал боту или удалил чат",
};

export function formatMessengerError(message: string): string {
  for (const [code, text] of Object.entries(MESSENGER_ERROR_MESSAGES)) {
    if (message.toLowerCase().includes(code.toLowerCase())) return text;
  }
  return message;
}
