import "dotenv/config";
import { registerBitrixConnector } from "../src/utils/bitrix.js";

console.log("=== Регистрация коннектора Bitrix24 Open Lines ===");
console.log(`BITRIX_CONNECTOR_ID: ${process.env.BITRIX_CONNECTOR_ID ?? "psiopora_bot (по умолчанию)"}`);
console.log(`BITRIX_OPEN_LINE_ID: ${process.env.BITRIX_OPEN_LINE_ID ?? "(не задан — коннектор будет зарегистрирован без линии)"}`);
console.log("");

await registerBitrixConnector();
console.log("Готово!");
