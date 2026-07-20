import { resolve } from "node:path";
import { defineConfig } from "@trigger.dev/sdk";
import { config } from "dotenv";
import type { BuildExtension } from "@trigger.dev/build/extensions";

// Конфиг исполняется CLI как ESM-бандл: __dirname там не определён, а
// import.meta указывает на временный файл сборки. CLI запускают из
// packages/jobs, поэтому корневой .env ищем от рабочей директории процесса.
config({ path: resolve(process.cwd(), "../../.env") });

/**
 * Подменяет резолвинг workspace-пакетов `@psi-opora/*` на директории внутри
 * монорепозитория. Bun не хостит workspace-линки в root `node_modules`, поэтому
 * esbuild внутри Trigger.dev не может найти их самостоятельно. После того как
 * пакет найден, используется condition `trigger.dev`, добавленный в каждый
 * workspace package.json, чтобы брать исходники из `src/`, а не из `dist/`.
 */
const monorepoExtension: BuildExtension = {
  name: "psi-opora-workspace-resolve",
  onBuildStart(context) {
    context.registerPlugin({
      name: "psi-opora-workspace-resolve-plugin",
      setup(build) {
        build.onResolve({ filter: /^@psi-opora\// }, (args) => {
          const match = args.path.match(/^@psi-opora\/([^/]+)(?:\/(.*))?$/);
          if (!match) return;
          const [, pkgName] = match;
          const pkgDir = resolve(context.workspaceDir, "packages", pkgName);
          return { path: pkgDir };
        });
      },
    });
  },
};

export default defineConfig({
  // Референс проекта из https://cloud.trigger.dev → Project settings
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_psi_opora",
  dirs: ["./src/trigger"],
  build: {
    // Условие, при котором внутренние пакеты монорепозитория резолвятся из
    // исходников, а не из dist — иначе Trigger.dev не находит workspace-зависимости.
    conditions: ["trigger.dev", "module", "node"],
    extensions: [monorepoExtension],
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
