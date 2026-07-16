import { resolve } from "node:path";
import { defineConfig } from "@trigger.dev/sdk";
import { config } from "dotenv";

// Конфиг исполняется CLI как ESM-бандл: __dirname там не определён, а
// import.meta указывает на временный файл сборки. CLI запускают из
// packages/jobs, поэтому корневой .env ищем от рабочей директории процесса.
config({ path: resolve(process.cwd(), "../../.env") });

export default defineConfig({
  // Референс проекта из https://cloud.trigger.dev → Project settings
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_psi_opora",
  dirs: ["./src/trigger"],
  build: {
    // pg подтягивается транзитивно через @psi-opora/db и не бандлится esbuild
    // (динамический require("pg-native")); в рантайме он не нужен —
    // POSTGRES_URL указывает на Neon, используется HTTP-драйвер
    external: ["pg", "pg-native"],
  },
  // Рассылка идёт с паузами между сообщениями — большим рассылкам нужен запас
  maxDuration: 3600,
  retries: {
    enabledInDev: false,
    default: {
      // Задача сама идемпотентна (шлёт только pending/error получателей),
      // но авто-повтор целого запуска не нужен: частичный сбой фиксируется в БД
      maxAttempts: 1,
    },
  },
});
