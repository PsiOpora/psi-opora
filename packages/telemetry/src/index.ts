/**
 * Отправка ошибок всех приложений в SigNoz (OTLP/HTTP).
 *
 * Каждый вызов `console.error` (включая `logger.error` из @psi-opora/config
 * и ошибки, которые логирует сам Next.js) превращается в отдельный спан со
 * статусом ERROR и событием `exception` — SigNoz группирует их на вкладке
 * Exceptions по сервису, типу и сообщению, со стектрейсом.
 *
 * Трейсинг запросов намеренно не включаем: провайдер не регистрируется
 * глобально, поэтому Next.js, oRPC, Drizzle и Hatchet SDK, которые умеют
 * писать спаны в @opentelemetry/api, остаются no-op — в SigNoz уходят только
 * ошибки. Логи подов целиком собирает отдельно k8s-infra (см. infra/signoz).
 *
 * Без OTEL_EXPORTER_OTLP_ENDPOINT (локальная разработка) — ничего не делает.
 */
import { hostname } from "node:os";
import { SpanStatusCode, type Tracer } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import {
	detectResources,
	envDetector,
	resourceFromAttributes,
} from "@opentelemetry/resources";
import { BatchSpanProcessor, TracerProvider } from "@opentelemetry/sdk-trace";
import { buildConsoleErrorReport, type ErrorReport } from "./console-error";

export { buildConsoleErrorReport, type ErrorReport } from "./console-error";

// Защита ClickHouse от ошибки в горячем цикле (например, poll каждые 3 с при
// упавшей БД): сверх лимита в минуту спаны не создаются, в логах подов всё
// равно остаётся полная история.
const MAX_REPORTS_PER_MINUTE = 300;

let provider: TracerProvider | undefined;
let tracer: Tracer | undefined;
let windowStartedAt = 0;
let reportsInWindow = 0;

function withinRateLimit(): boolean {
	const now = Date.now();
	if (now - windowStartedAt >= 60_000) {
		windowStartedAt = now;
		reportsInWindow = 0;
	}
	reportsInWindow += 1;
	return reportsInWindow <= MAX_REPORTS_PER_MINUTE;
}

function record(report: ErrorReport): void {
	if (!tracer || !withinRateLimit()) return;
	const span = tracer.startSpan(report.name, { attributes: report.attributes });
	span.recordException(report.exception);
	span.setStatus({
		code: SpanStatusCode.ERROR,
		message: report.exception.message,
	});
	span.end();
}

/** Стек места вызова console.error — без строки "Error" и кадра обёртки. */
function callSiteStack(): string | undefined {
	return new Error().stack?.split("\n").slice(3).join("\n") || undefined;
}

function patchConsoleError(): void {
	const original = console.error;
	let reporting = false;

	console.error = function patchedConsoleError(...args: unknown[]) {
		original.apply(this, args);
		// Если экспорт сам что-то пишет в console.error — не уходим в рекурсию.
		if (reporting) return;
		reporting = true;
		try {
			record(buildConsoleErrorReport(args, callSiteStack()));
		} catch {
			// Телеметрия не должна ломать приложение.
		} finally {
			reporting = false;
		}
	};
}

/**
 * Вызывается один раз при старте процесса, до основной логики.
 * `serviceName` — имя сервиса в SigNoz (переопределяется OTEL_SERVICE_NAME).
 */
export function initTelemetry(serviceName: string): void {
	if (provider || !process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()) return;

	const resource = resourceFromAttributes({
		"service.name": serviceName,
		"deployment.environment.name":
			process.env.OTEL_DEPLOYMENT_ENVIRONMENT ??
			process.env.NODE_ENV ??
			"development",
		// В k8s hostname — имя пода: видно, какая именно реплика упала.
		"host.name": hostname(),
	}).merge(detectResources({ detectors: [envDetector] }));

	provider = new TracerProvider({
		resource,
		spanProcessors: [
			// Эндпоинт берётся из OTEL_EXPORTER_OTLP_ENDPOINT (+ /v1/traces).
			new BatchSpanProcessor({
				exporter: new OTLPTraceExporter(),
				scheduledDelayMillis: 1000,
			}),
		],
	});
	tracer = provider.getTracer("@psi-opora/telemetry");
	patchConsoleError();
}

/** Ручной отчёт об ошибке, которую не нужно писать в console.error. */
export function reportError(error: unknown, context?: string): void {
	try {
		record(
			buildConsoleErrorReport(
				context === undefined ? [error] : [context, error],
				callSiteStack(),
			),
		);
	} catch {
		// Телеметрия не должна ломать приложение.
	}
}

/** Дожидается отправки накопленных ошибок — вызывать перед process.exit. */
export async function flushTelemetry(timeoutMs = 3000): Promise<void> {
	if (!provider) return;
	await Promise.race([
		provider.forceFlush().catch(() => {}),
		new Promise((resolve) => setTimeout(resolve, timeoutMs).unref()),
	]);
}
