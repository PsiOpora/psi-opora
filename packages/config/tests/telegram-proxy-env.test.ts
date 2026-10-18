import { expect, test } from "bun:test";

const envModule = new URL("../src/env.ts", import.meta.url).href;

function loadEnv(variables: Record<string, string>) {
	return Bun.spawnSync({
		cmd: [
			process.execPath,
			"--eval",
			`import { env } from ${JSON.stringify(envModule)};
			console.log(JSON.stringify({
				enabled: env.TG_3PROXY_ENABLED, url: env.TG_3PROXY_URL
			}));`,
		],
		env: { NODE_ENV: "test", ...variables },
	});
}

test("disabled proxy does not require a URL", () => {
	for (const variables of [{}, { TG_3PROXY_ENABLED: "false" }]) {
		const result = loadEnv(variables);
		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout.toString())).toEqual({ enabled: false });
	}
});

test("enabled proxy accepts an HTTP URL with credentials", () => {
	const url = "http://user:pass@proxy.example.com:3128";
	const result = loadEnv({ TG_3PROXY_ENABLED: "true", TG_3PROXY_URL: url });
	expect(result.exitCode).toBe(0);
	expect(JSON.parse(result.stdout.toString())).toEqual({ enabled: true, url });
});

test("enabled proxy rejects a missing, malformed, or non-HTTP URL at import", () => {
	for (const url of [
		undefined,
		"",
		"not-a-url",
		"http://",
		"https://proxy.example.com:3128",
		"socks5://proxy.example.com:1080",
	]) {
		const variables: Record<string, string> = { TG_3PROXY_ENABLED: "true" };
		if (url !== undefined) variables.TG_3PROXY_URL = url;
		const result = loadEnv(variables);
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr.toString()).toContain("TG_3PROXY_URL");
	}
});
