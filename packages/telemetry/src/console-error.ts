import { format } from "node:util";

type AttributeValue = string | number | boolean;

export interface ErrorReport {
	/** Имя спана — короткая подпись ошибки в списке трейсов SigNoz. */
	name: string;
	/** Попадает в span event `exception` — по нему строится вкладка Exceptions. */
	exception: { name: string; message: string; stack?: string };
	attributes: Record<string, AttributeValue>;
}

const MAX_NAME_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 4000;

// Поля, которые logger из @psi-opora/config кладёт в каждую строку сам или
// которые уже ушли в exception.* — в атрибуты спана их не дублируем.
const LOGGER_RESERVED_KEYS = new Set([
	"level",
	"time",
	"msg",
	"name",
	"message",
	"stack",
	"cause",
]);

function truncate(value: string, max: number): string {
	return value.length > max ? `${value.slice(0, max)}…` : value;
}

function firstLine(value: string): string {
	const index = value.indexOf("\n");
	return index === -1 ? value : value.slice(0, index);
}

function isAttributeValue(value: unknown): value is AttributeValue {
	return (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	);
}

function describeCause(cause: unknown): string {
	if (cause instanceof Error) {
		const nested =
			cause.cause === undefined
				? ""
				: `\nCaused by: ${describeCause(cause.cause)}`;
		return `${cause.stack ?? `${cause.name}: ${cause.message}`}${nested}`;
	}
	return format(cause);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Строка из logger.error (@psi-opora/config) — один JSON с `level: "error"`. */
function parseLoggerLine(args: unknown[]): Record<string, unknown> | null {
	const [line] = args;
	if (args.length !== 1 || typeof line !== "string" || !line.startsWith("{")) {
		return null;
	}
	try {
		const parsed: unknown = JSON.parse(line);
		return isRecord(parsed) && parsed.level === "error" ? parsed : null;
	} catch {
		return null;
	}
}

function fromLoggerLine(
	entry: Record<string, unknown>,
	callSiteStack: string | undefined,
): ErrorReport {
	const msg = typeof entry.msg === "string" ? entry.msg : "Logged error";
	const attributes: Record<string, AttributeValue> = {};
	for (const [key, value] of Object.entries(entry)) {
		if (LOGGER_RESERVED_KEYS.has(key)) continue;
		attributes[`log.${key}`] = isAttributeValue(value)
			? value
			: truncate(JSON.stringify(value) ?? String(value), MAX_MESSAGE_LENGTH);
	}
	if (entry.cause !== undefined) {
		attributes["exception.cause"] = truncate(
			JSON.stringify(entry.cause) ?? String(entry.cause),
			MAX_MESSAGE_LENGTH,
		);
	}

	const hasError = typeof entry.message === "string";
	return {
		name: truncate(msg, MAX_NAME_LENGTH),
		exception: {
			name: typeof entry.name === "string" ? entry.name : "LoggedError",
			message: truncate(
				hasError ? `${msg}: ${entry.message}` : msg,
				MAX_MESSAGE_LENGTH,
			),
			stack: typeof entry.stack === "string" ? entry.stack : callSiteStack,
		},
		attributes,
	};
}

/**
 * Превращает аргументы одного вызова `console.error` в отчёт об ошибке.
 *
 * Покрывает три формы, которые встречаются в коде:
 * - `logger.error(...)` — одна JSON-строка, стек берём из её полей;
 * - `console.error("[TAG] что случилось:", error)` — стек из самого Error,
 *   текстовая часть становится именем ошибки;
 * - `console.error("что-то пошло не так", data)` без Error — стек берём
 *   из места вызова, чтобы было видно, откуда пришла ошибка.
 */
export function buildConsoleErrorReport(
	args: unknown[],
	callSiteStack?: string,
): ErrorReport {
	const loggerEntry = parseLoggerLine(args);
	if (loggerEntry) return fromLoggerLine(loggerEntry, callSiteStack);

	const errorIndex = args.findIndex((arg) => arg instanceof Error);
	const error = errorIndex === -1 ? undefined : (args[errorIndex] as Error);

	if (!error) {
		const message = format(...args);
		return {
			name: truncate(firstLine(message), MAX_NAME_LENGTH),
			exception: {
				name: "ConsoleError",
				message: truncate(message, MAX_MESSAGE_LENGTH),
				stack: callSiteStack,
			},
			attributes: {},
		};
	}

	const context = format(...args.filter((_, index) => index !== errorIndex));
	const attributes: Record<string, AttributeValue> = {};
	// Доп. поля ошибок клиентов API (code, status, error_code, description…)
	// часто важнее самого сообщения — сохраняем примитивные из них.
	for (const [key, value] of Object.entries(error)) {
		if (key !== "cause" && isAttributeValue(value)) {
			attributes[`error.${key}`] = truncate(String(value), MAX_MESSAGE_LENGTH);
		}
	}
	if (error.cause !== undefined) {
		attributes["exception.cause"] = truncate(
			describeCause(error.cause),
			MAX_MESSAGE_LENGTH,
		);
	}

	const trimmedContext = context.trim().replace(/:$/, "");
	return {
		name: truncate(
			trimmedContext || `${error.name}: ${firstLine(error.message)}`,
			MAX_NAME_LENGTH,
		),
		exception: {
			name: error.name,
			message: truncate(
				trimmedContext ? `${trimmedContext}: ${error.message}` : error.message,
				MAX_MESSAGE_LENGTH,
			),
			stack: error.stack,
		},
		attributes,
	};
}
