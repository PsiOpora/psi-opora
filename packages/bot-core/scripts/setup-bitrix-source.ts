import { registerBitrixSource } from "../src/utils/bitrix";

const messenger = process.argv[2] ?? "telegram";
if (messenger !== "telegram" && messenger !== "max") {
	console.error("Использование: bun run setup:bitrix-source -- telegram | max");
	process.exit(1);
}

console.log(`=== Регистрация источника CRM (${messenger}) ===`);
await registerBitrixSource(messenger);
console.log("Готово!");
