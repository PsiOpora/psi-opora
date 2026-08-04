import { createInterface } from "node:readline/promises";
import { createUserbotClient, sendUserbotMessage } from "../src/relay";

/**
 * Живая проверка Фазы 2 (relay.ts) с реальным аккаунтом — печатает каждый
 * разобранный пуш и его исходный пейлоад, чтобы по факту (а не по разборам
 * сторонних проектов) уточнить форму NOTIF_MESSAGE/NOTIF_TYPING/
 * NOTIF_PRESENCE (см. предупреждение в src/relay.ts). Сессию берём из
 * вывода `bun run manual-login` (поле `session` в его результате).
 *
 *   bun run manual-relay
 */
async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const sessionJson = await rl.question("Сессия (JSON из manual-login): ");

    console.log("→ SESSION_INIT + LOGIN...");
    const client = await createUserbotClient(sessionJson.trim(), {
      onMessage: (message) => console.log("← NOTIF_MESSAGE (разобрано):", message),
      onTyping: (event) => console.log("← NOTIF_TYPING:", event),
      onPresence: (event) => console.log("← NOTIF_PRESENCE:", event),
    });
    console.log("← Подключено, слушаю пуши. Ctrl+C для выхода.");

    const chatIdInput = await rl.question(
      "chatId для тестового сообщения (Enter — пропустить): ",
    );
    if (chatIdInput.trim()) {
      const text = await rl.question("Текст сообщения: ");
      const messageId = await sendUserbotMessage(
        client,
        chatIdInput.trim(),
        text.trim(),
      );
      console.log(`← Отправлено, messageId: ${messageId}`);
    }

    await new Promise(() => {
      // Держим процесс живым, чтобы успеть увидеть входящие пуши.
    });
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error("Ошибка проверки relay MAX:", err);
  process.exitCode = 1;
});
