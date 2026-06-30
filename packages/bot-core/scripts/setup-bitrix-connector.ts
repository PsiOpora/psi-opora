import "dotenv/config";
import { registerBitrixConnector } from "../src/utils/bitrix.js";

const messenger = process.argv[2] ?? "telegram";
if (messenger !== "telegram" && messenger !== "max") {
  console.error("Использование: bun run setup:bitrix -- telegram | max");
  process.exit(1);
}

const prefix = messenger === "telegram" ? "TG" : "MAX";
console.log(`=== Регистрация коннектора Bitrix24 Open Lines (${messenger}) ===`);
console.log(`${prefix}_BITRIX_CONNECTOR_ID: ${process.env[`${prefix}_BITRIX_CONNECTOR_ID`] ?? `psiopora_${messenger}_bot (по умолчанию)`}`);
console.log(`${prefix}_BITRIX_OPEN_LINE_ID: ${process.env[`${prefix}_BITRIX_OPEN_LINE_ID`] ?? "(не задан)"}`);
console.log("");

await registerBitrixConnector(messenger);
console.log("Готово!");
