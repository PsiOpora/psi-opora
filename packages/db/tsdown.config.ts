import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/client.ts", "src/client.edge.ts", "src/client.ws.ts", "src/driver.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  outDir: "dist",
  bundle: false,
});
