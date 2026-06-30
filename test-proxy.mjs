import { HttpsProxyAgent } from "https-proxy-agent";
import { readFileSync } from "fs";

// Читаем .env вручную
const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => l.split("=").map((s) => s.trim()))
);

const BOT_TOKEN = env.BOT_TOKEN;
const PROXY = "http://127.0.0.1:2080";

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN не найден в .env");
  process.exit(1);
}

console.log(`Используем прокси: ${PROXY}`);
console.log(`BOT_TOKEN: ${BOT_TOKEN.slice(0, 10)}...`);
console.log("Отправляем getMe...\n");

const agent = new HttpsProxyAgent(PROXY);

const url = `https://api.telegram.org/bot${BOT_TOKEN}/getMe`;

try {
  const res = await fetch(url, { agent });
  const json = await res.json();
  if (json.ok) {
    console.log("✓ Прокси работает! Бот:", json.result.username);
  } else {
    console.error("Telegram вернул ошибку:", json);
  }
} catch (err) {
  console.error("✗ Ошибка соединения:", err.message);
  if (err.cause) console.error("Причина:", err.cause);
}
