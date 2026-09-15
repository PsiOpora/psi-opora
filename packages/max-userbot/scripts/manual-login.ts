import { createInterface } from "node:readline/promises";
import { confirmLoginCode, sendLoginCode } from "../src/login";

/**
 * Интерактивная проверка логина MAX с реальным номером — единственный способ
 * убедиться, что байтовый разбор протокола (src/protocol/frame.ts) и
 * структура пейлоадов (src/login.ts) соответствуют текущей версии сервера,
 * т.к. протокол нигде официально не задокументирован. Запуск:
 *
 *   bun run manual-login
 *
 * (или `bun run scripts/manual-login.ts` из пакета packages/max-userbot).
 */
async function main(): Promise<void> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		const phone = await rl.question("Номер телефона (в формате +7...): ");

		console.log("→ AUTH_REQUEST...");
		const { pendingSession, codeLength } = await sendLoginCode(phone.trim());
		console.log(`← Код отправлен, длина кода: ${codeLength}`);

		const code = await rl.question("Код из SMS: ");

		console.log("→ AUTH + LOGIN...");
		const result = await confirmLoginCode({
			pendingSession,
			code: code.trim(),
		});
		console.log(`← status: ${result.status}`);
		console.log(
			`← session (для сохранения в БД в зашифрованном виде): ${result.session}`,
		);
	} finally {
		rl.close();
	}
}

main().catch((err) => {
	console.error("Ошибка логина MAX:", err);
	process.exitCode = 1;
});
