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
  const json = await res.json();
  if (json.error) {
    throw new Error(`${method}: ${json.error} — ${json.error_description ?? ""}`);
  }
  return json;
}

async function updateDealsSource(fromSourceId: string, toSourceId: string) {
  const listResp = await call("crm.deal.list", {
    filter: { SOURCE_ID: fromSourceId },
    select: ["ID"],
  });
  const deals = (listResp.result ?? []) as { ID: string }[];
  console.log(`${fromSourceId} → ${toSourceId}: найдено ${deals.length} сделок`);
  for (const deal of deals) {
    await call("crm.deal.update", {
      id: deal.ID,
      fields: { SOURCE_ID: toSourceId },
    });
    console.log(`  сделка ${deal.ID} обновлена`);
  }
  return deals.length;
}

// 1. Регистрируем чистые источники для наших ботов (идемпотентно)
for (const [id, name] of [
  ["BOT_TELEGRAM", "Telegram-бот"],
  ["BOT_MAX", "MAX-бот"],
] as const) {
  try {
    await call("crm.status.add", {
      fields: { ENTITY_ID: "SOURCE", STATUS_ID: id, NAME: name },
    });
    console.log(`создан источник: ${id} (${name})`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Duplicate") || message.includes("уже существует")) {
      console.log(`источник уже существует: ${id}`);
    } else {
      throw err;
    }
  }
}

// 2. Переносим сделки-сироты нашего бота на новые чистые источники
await updateDealsSource("TELEGRAM_OL", "BOT_TELEGRAM");
await updateDealsSource("1|MAX", "BOT_MAX");

// 3. Мерджим дубль "Повторная продажа" → "Повторные продажи"
await updateDealsSource("UC_4GXIMV", "REPEAT_SALE");

// 4. Находим внутренние числовые ID справочника для UC_4GXIMV/PARTNER/WEB
const statusList = await call("crm.status.list", {});
const sourceRows = (statusList.result ?? []).filter(
  (r: { ENTITY_ID: string }) => r.ENTITY_ID === "SOURCE",
) as { ID: string; STATUS_ID: string; NAME: string }[];

function findRow(statusId: string) {
  const row = sourceRows.find((r) => r.STATUS_ID === statusId);
  if (!row) throw new Error(`не найден статус ${statusId} в справочнике SOURCE`);
  return row;
}

// 5. Удаляем опустевший дубль UC_4GXIMV
const dupRow = findRow("UC_4GXIMV");
await call("crm.status.delete", { id: dupRow.ID });
console.log(`удалён дубль-источник: UC_4GXIMV (${dupRow.NAME})`);

// 6. Переименовываем PARTNER и WEB — убираем рассинхрон кода/названия
const partnerRow = findRow("PARTNER");
await call("crm.status.update", {
  id: partnerRow.ID,
  fields: { NAME: "Партнёр" },
});
console.log(`PARTNER переименован: "${partnerRow.NAME}" → "Партнёр"`);

const webRow = findRow("WEB");
await call("crm.status.update", {
  id: webRow.ID,
  fields: { NAME: "Веб-сайт" },
});
console.log(`WEB переименован: "${webRow.NAME}" → "Веб-сайт"`);

console.log("Готово!");
