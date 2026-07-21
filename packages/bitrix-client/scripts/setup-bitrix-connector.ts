import { registerBitrixConnector } from "@psi-opora/bot-core";
import { env } from "@psi-opora/config";
import { resolveBitrixApi } from "../src/client";

const messenger = process.argv[2] ?? "telegram";
if (messenger !== "telegram" && messenger !== "max") {
  console.error("Использование: bun run setup:bitrix -- telegram | max");
  process.exit(1);
}

const memberId = env.BITRIX_MEMBER_ID;
if (!memberId) {
  console.error(
    "BITRIX_MEMBER_ID не задан — imconnector.* требует OAuth-контекст приложения, " +
      "а не входящий вебхук. Установите/откройте приложение дашборда на портале хотя бы " +
      "раз (memberId отобразится в его настройках) и укажите его в .env.",
  );
  process.exit(1);
}

const prefix = messenger === "telegram" ? "TG" : "MAX";
console.log(
  `=== Регистрация коннектора Bitrix24 Open Lines (${messenger}) ===`,
);
console.log(
  `${prefix}_BITRIX_CONNECTOR_ID: ${process.env[`${prefix}_BITRIX_CONNECTOR_ID`] ?? `psiopora_${messenger}_bot (по умолчанию)`}`,
);
console.log(
  `${prefix}_BITRIX_OPEN_LINE_ID: ${process.env[`${prefix}_BITRIX_OPEN_LINE_ID`] ?? "(не задан)"}`,
);
console.log("");

// resolveBitrixApi(memberId) всегда возвращает клиент, когда memberId
// задан (null — только фолбэк для memberId=undefined) — если токены
// портала не сохранены, ошибка «Нет сохранённой авторизации…» всплывёт
// на первом же вызове ниже.
const api = resolveBitrixApi(memberId);
if (!api) throw new Error("unreachable: memberId задан");

await registerBitrixConnector(api, messenger);
console.log("Готово!");
