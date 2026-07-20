import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BuildExtension } from "@trigger.dev/build/extensions";
import { defineConfig } from "@trigger.dev/sdk";
import { config } from "dotenv";

// Конфиг исполняется CLI как ESM-бандл: __dirname там не определён, а
// import.meta указывает на временный файл сборки. CLI запускают из
// packages/jobs, поэтому корневой .env ищем от рабочей директории процесса.
config({ path: resolve(process.cwd(), "../../.env") });

function findConditionValue(
  value: unknown,
  condition: string,
): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (condition in record) {
      return findConditionValue(record[condition], condition);
    }
    // Fallback: default / import / require
    return findConditionValue(
      record.default ?? record.import ?? record.require,
      condition,
    );
  }
  return undefined;
}

function resolveWorkspacePackage(
  rootDir: string,
  pkgName: string,
  subpath: string,
): string | undefined {
  const pkgDir = resolve(rootDir, "packages", pkgName);
  const pkgJsonPath = resolve(pkgDir, "package.json");
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as {
    exports?: Record<string, unknown>;
  };
  const exports = pkgJson.exports;
  if (!exports) return undefined;

  const exportKey = subpath ? `./${subpath}` : ".";
  const exportValue = exports[exportKey];
  if (!exportValue) return undefined;

  const sourcePath = findConditionValue(exportValue, "trigger.dev");
  if (!sourcePath) return undefined;

  return resolve(pkgDir, sourcePath);
}

export default defineConfig({
  // Референс проекта из https://cloud.trigger.dev → Project settings
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_psi_opora",
  dirs: ["./src/trigger"],
  build: {
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
