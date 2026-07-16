import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/messenger.ts", "src/trigger/broadcast.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  outDir: "dist",
  bundle: false,
});
