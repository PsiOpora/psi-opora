import { defineConfig } from "@trigger.dev/sdk";
import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(__dirname, "../../.env") });

export default defineConfig({
  // Референс проекта из https://cloud.trigger.dev → Project settings
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_psi_opora",
  dirs: ["./src/trigger"],
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
