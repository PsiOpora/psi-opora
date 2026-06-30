import { createRequire } from "node:module";

if (typeof process.getBuiltinModule !== "function") {
  const require = createRequire(import.meta.url);
  process.getBuiltinModule = (id) => require(id);
}

await import("tsdown/run");
