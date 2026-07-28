import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/messenger.ts",
    "src/backup.ts",
    "src/hatchet/broadcast.ts",
    "src/hatchet/crm-backup.ts",
    "src/hatchet/worker.ts",
  ],
  format: ["esm"],
  dts: true,
  clean: true,
  outDir: "dist",
  bundle: false,
});
