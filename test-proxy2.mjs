import { HttpsProxyAgent } from "https-proxy-agent";
import https from "https";
import { readFileSync } from "fs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => l.split("=").map((s) => s.trim()))
);

const BOT_TOKEN = env.BOT_TOKEN;
const PROXY = "http://127.0.0.1:2080";

console.log(`Прокси: ${PROXY}`);
console.log("Тест через https.get (node http.Agent)...\n");

const agent = new HttpsProxyAgent(PROXY);

const options = {
  hostname: "api.telegram.org",
  path: `/bot${BOT_TOKEN}/getMe`,
  method: "GET",
  agent,
};

const req = https.request(options, (res) => {
  let data = "";
  res.on("data", (chunk) => (data += chunk));
  res.on("end", () => {
    const json = JSON.parse(data);
    if (json.ok) {
      console.log("✓ Прокси работает! Бот:", json.result.username);
    } else {
      console.error("Telegram ошибка:", json);
    }
  });
});

req.on("error", (err) => {
  console.error("✗ Ошибка:", err.message);
  if (err.cause) console.error("Причина:", err.cause);
});

req.setTimeout(10000, () => {
  console.error("✗ Таймаут 10с — прокси не отвечает на 127.0.0.1:2080");
  req.destroy();
});

req.end();
