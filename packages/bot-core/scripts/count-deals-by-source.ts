const messenger = process.argv[2] ?? "telegram";
const prefix = messenger === "telegram" ? "TG" : "MAX";
const webhookUrl =
  process.env[`${prefix}_BITRIX_WEBHOOK_URL`] ?? process.env.BITRIX_WEBHOOK_URL;
if (!webhookUrl) throw new Error("no webhook url");
const base = webhookUrl.replace(/\/$/, "");

async function call(method: string, body: unknown) {
  const res = await fetch(`${base}/${method}.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

// Все SOURCE_ID из справочника SOURCE (актуальный портал)
const sourceIds = [
  "REPEAT_SALE",
  "5", // Директ
  "WEB", // Сайт непонятно
  "ADVERTISING",
  "UC_15QWZN", // Реклама из ВК
  "WZ28a82ede-c48c-41ea-ac60-fb2556778e3c", // Vk Психологический центр «Опора»
  "7", // Инвайт ТГ
  "UC_B0HBHP", // Инвайт МАКС
  "UC_DTTXYF", // Скидком
  "6", // B17
  "CALL",
  "EMAIL",
  "PARTNER", // Существующий клиент
  "UC_4GXIMV", // Повторная продажа
  "RECOMMENDATION",
  "TRADE_SHOW",
  "WEBFORM",
  "CALLBACK",
  "RC_GENERATOR",
  "STORE",
  "4|MAX", // MAX - МАКС
  "OTHER",
  "BOOKING",
  "2|WZ_TELEGRAM_CC8963AE17459EFE946E64E793744C26C", // WAZZUP: Telegram - Открытая линия
  "4|WZ_MAX_CONNEC C8963AE17459EFE946E64E793744C26C".replace(" ", ""), // WAZZUP: Max - Открытая линия 2
  "WZa90cfc65-5c22-4907-bf21-0334c8cfe58e", // Tgapi Клюев Андрей ТГ
  "WZ3fd9b77f-a76e-4c0f-9b17-46cf5f1b9d0d", // Max 79307073332
  "WZ5a2784f0-8164-40c1-b0a6-9c99eab08085", // Tgapi 79310096002
  "WZd0ed59e8-9063-4f73-b5d8-47cb8e079168", // Max МАКС 79307073332
  "WZf7bcc2c7-0a96-4623-bb49-449d7c293f1a", // Maxbot id525603925717_bot
  "UC_FW11KS", // Youtube
  "UC_9JU64T", // VK видео
  "UC_DKZMEY", // Rutube
  "UC_QASW4T", // TG Bot kluevzabotabot
  "WZ5bb6d113-0078-447a-b374-f7e11b942c42", // Tgapi ТГ 3332
  "WZ539cd0ea-9fe2-4edf-9c02-7e8c8bc404ab", // Whatsapp 79307073332
  "WZ29956776-21fa-4c1d-82e5-3c98e52d636c", // Telegram kluvand_bot
  "TELEGRAM_OL", // орфанный fallback из кода бота
  "1|MAX", // орфанный fallback из кода бота
  "", // пустой SOURCE_ID
];

const results: { sourceId: string; total: number }[] = [];
for (const sourceId of sourceIds) {
  const resp = await call("crm.deal.list", {
    filter: { SOURCE_ID: sourceId },
    select: ["ID"],
  });
  results.push({ sourceId, total: resp.total ?? 0 });
}

// Общее число сделок (для сверки суммы)
const allResp = await call("crm.deal.list", { select: ["ID"] });

const out = { bySource: results, totalDeals: allResp.total ?? 0 };
await Bun.write(
  new URL(`./deal-count-by-source-${messenger}.json`, import.meta.url),
  JSON.stringify(out, null, 2),
);
console.log("done");
