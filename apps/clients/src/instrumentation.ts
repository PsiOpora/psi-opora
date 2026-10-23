// Next.js вызывает register() один раз при старте сервера. Ошибки рендера,
// route handlers и server actions Next.js сам пишет в console.error —
// @psi-opora/telemetry перехватывает их и отправляет в SigNoz.
export async function register() {
	if (process.env.NEXT_RUNTIME === "nodejs") {
		const { initTelemetry } = await import("@psi-opora/telemetry");
		initTelemetry("clients");
	}
}
