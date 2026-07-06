import { build } from "tsdown";

await build({
  entry: ["src/index.ts"],
  tsconfig: "tsconfig.json",
  clean: true,
});
