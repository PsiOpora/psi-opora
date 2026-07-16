import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/messenger.ts",
    "src/backup.ts",
    "src/trigger/broadcast.ts",
    "src/trigger/crm-backup.ts",
  ],
  format: ["esm"],
  dts: true,
  clean: true,
  outDir: "dist",
  bundle: false,
});
