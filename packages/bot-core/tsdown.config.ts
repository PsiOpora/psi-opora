import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/index.ts", "src/utils/funnel-steps.ts"],
	format: ["esm"],
	dts: true,
	clean: true,
	outDir: "dist",
});
