import { createInterface } from "node:readline/promises";
import { MaxLoginFlow } from "../src/login";

/**
 * Интерактивная проверка логина MAX с реальным номером — единственный способ
 * убедиться, что байтовый разбор протокола (src/protocol/frame.ts) и
 * структура пейлоадов (src/login.ts) соответствуют текущей версии сервера,
 * т.к. протокол нигде официально не задокументирован. Весь вход идёт на
 * одном соединении (MaxLoginFlow), как в воркере. Запуск:
 *
 *   bun run manual-login
 *
 * (или `bun run scripts/manual-login.ts` из пакета packages/max-userbot).
 */
async function main(): Promise<void> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	let flow: MaxLoginFlow | undefined;
	try {
		const phone = await rl.question("Номер телефона (в формате +7...): ");

		console.log("→ SESSION_INIT + AUTH_REQUEST...");
		const started = await MaxLoginFlow.start(phone.trim());
		flow = started.flow;
		console.log(`← Код отправлен, длина кода: ${started.result.codeLength}`);

		const code = await rl.question("Код из SMS: ");
		console.log("→ AUTH...");
		let result = await flow.submitCode(code.trim());
		console.log(`← status: ${result.status}`);

		if (result.status === "password_required") {
			if (result.hint) console.log(`  подсказка к паролю: ${result.hint}`);
			if (result.email) console.log(`  почта восстановления: ${result.email}`);
			const password = await rl.question("Облачный пароль MAX: ");
			console.log("→ AUTH_LOGIN_CHECK_PASSWORD...");
			result = await flow.submitPassword(password);
			console.log(`← status: ${result.status}`);
		}
		console.log(
			`← session (для сохранения в БД в зашифрованном виде): ${result.session}`,
		);
	} finally {
		flow?.close();
		rl.close();
	}
}

main().catch((err) => {
	console.error("Ошибка логина MAX:", err);
	process.exitCode = 1;
});
