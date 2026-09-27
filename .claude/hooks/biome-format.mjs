import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";

const FORMATTABLE = new Set([
	".ts",
	".tsx",
	".mts",
	".cts",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".json",
	".jsonc",
]);

const input = JSON.parse(await Bun.stdin.text());
const filePath = input.tool_input?.file_path;
if (!filePath || !FORMATTABLE.has(extname(filePath))) process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? input.cwd;
const biome = join(
	projectDir,
	"node_modules",
	"@biomejs",
	"biome",
	"bin",
	"biome",
);
// Without `bun install` there is no local Biome; don't let bunx fetch one.
if (!existsSync(biome)) process.exit(0);

const result = spawnSync(
	"bun",
	[biome, "format", "--write", "--no-errors-on-unmatched", filePath],
	{ cwd: projectDir, encoding: "utf8" },
);
if (result.status !== 0) {
	console.error(`biome format failed for ${filePath}:\n${result.stderr}`);
	process.exit(1);
}
