import { spawnSync } from "node:child_process";
import { basename, relative } from "node:path";

const input = JSON.parse(await Bun.stdin.text());
const filePath = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
if (!filePath) process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? input.cwd;
const rel = relative(projectDir, filePath).replaceAll("\\", "/");
const name = basename(filePath);

function block(reason) {
	console.error(reason);
	process.exit(2);
}

if (name === ".env" || (name.startsWith(".env.") && name !== ".env.example")) {
	block(
		`Editing ${rel} is blocked: it holds live secrets. Ask the user to change it themselves, or update .env.example instead.`,
	);
}

if (rel.startsWith("packages/db/migrations/")) {
	// New custom migrations (drizzle-kit generate --custom) are untracked and stay editable.
	const tracked = spawnSync("git", ["ls-files", "--error-unmatch", rel], {
		cwd: projectDir,
	});
	if (tracked.status === 0) {
		block(
			`Editing ${rel} is blocked: committed Drizzle migrations may already be applied. Change packages/db/src/schema and run \`bun run generate\` in packages/db instead.`,
		);
	}
}
