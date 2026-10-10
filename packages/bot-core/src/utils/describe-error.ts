/**
 * Текст ошибки для логов вместе с первопричиной. grammY на сетевом сбое
 * бросает HttpError с общим "Network request for '<method>' failed!", а
 * настоящую ошибку fetch (DNS, ECONNRESET, TLS, отказ прокси) кладёт в
 * поле `error`; обычные ошибки Node/Bun держат её в `cause`. Без этого
 * по логу не отличить недоступный api.telegram.org от упавшего прокси.
 */
export function describeError(err: unknown, depth = 0): string {
	if (!(err instanceof Error)) return String(err);
	if (depth >= 3) return err.message;
	const code = (err as { code?: unknown }).code;
	const message =
		typeof code === "string" && !err.message.includes(code)
			? `${err.message} [${code}]`
			: err.message;
	const inner =
		(err as { error?: unknown }).error ?? (err as { cause?: unknown }).cause;
	return inner !== undefined
		? `${message} (cause: ${describeError(inner, depth + 1)})`
		: message;
}

/** Сетевой сбой запроса grammY (не ответ Bot API с кодом ошибки). */
export function isGrammyNetworkError(err: unknown): boolean {
	return err instanceof Error && err.name === "HttpError";
}
