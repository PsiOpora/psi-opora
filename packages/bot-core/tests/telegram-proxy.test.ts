import { expect, test } from "bun:test";

const proxyModule = new URL("../src/utils/telegram-proxy.ts", import.meta.url)
	.href;

// Separate processes keep the imported environment and fetch isolated from
// the module mocks used by other bot-core tests.
function run(script: string, variables: Record<string, string>) {
	return Bun.spawnSync({
		cmd: [process.execPath, "--eval", script],
		env: { NODE_ENV: "test", ...variables },
	});
}

test("disabled proxy returns the original fetch", () => {
	const result = run(
		`import { strict as assert } from "node:assert";
		const { createTelegramFetch } = await import(${JSON.stringify(proxyModule)});
		assert.equal(createTelegramFetch(), fetch);`,
		{ TG_3PROXY_ENABLED: "false" },
	);
	expect(result.stderr.toString()).toBe("");
	expect(result.exitCode).toBe(0);
});

test("enabled proxy ignores NO_PROXY and preserves request options", () => {
	const result = run(
		`import { strict as assert } from "node:assert";
		let directRequests = 0;
		const target = Bun.serve({
			hostname: "127.0.0.1", port: 0,
			fetch() { directRequests++; return new Response("direct"); }
		});
		const proxy = Bun.serve({
			hostname: "127.0.0.1", port: 0,
			async fetch(request) {
				return Response.json({
					method: request.method,
					header: request.headers.get("X-Test"),
					body: await request.text()
				});
			}
		});
		try {
			process.env.TG_3PROXY_URL = proxy.url.href;
			const { createTelegramFetch } = await import(${JSON.stringify(proxyModule)});
			const init = Object.freeze({
				method: "POST", body: "payload",
				headers: Object.freeze({ "X-Test": "preserved" }),
				redirect: "manual", signal: AbortSignal.timeout(2000)
			});
			const response = await createTelegramFetch()(target.url, init);
			assert.deepEqual(await response.json(), {
				method: "POST", header: "preserved", body: "payload"
			});
			assert.equal(directRequests, 0);
		} finally {
			target.stop(true);
			proxy.stop(true);
		}`,
		{ TG_3PROXY_ENABLED: "true", NO_PROXY: "*", no_proxy: "*" },
	);
	expect(result.stderr.toString()).toBe("");
	expect(result.exitCode).toBe(0);
});
