import { defineConfig } from "tsdown";

export default defineConfig({
	entry: [
		"src/index.ts",
		"src/client.ts",
		"src/client.edge.ts",
		"src/client.ws.ts",
		"src/driver.ts",
		"src/queries/index.ts",
		"src/queries/index.edge.ts",
		"src/schema/index.ts",
	],
	format: ["esm"],
	dts: true,
	clean: true,
	outDir: "dist",
	unbundle: true,
});
