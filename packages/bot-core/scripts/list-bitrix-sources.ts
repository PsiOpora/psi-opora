import { listBitrixSources } from "../src/utils/bitrix.js";

const messenger = process.argv[2] ?? "telegram";
if (messenger !== "telegram" && messenger !== "max") {
  console.error("Использование: bun run list:bitrix-sources -- telegram | max");
  process.exit(1);
}

const sources = await listBitrixSources(messenger);
console.log(`=== Источники CRM (${messenger}) ===`);
for (const s of sources) {
  console.log(`${s.STATUS_ID}\t${s.NAME}`);
}
