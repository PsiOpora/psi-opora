export function getEnv(messenger: string, key: string): string | undefined {
	const prefix = messenger === "telegram" ? "TG" : "MAX";
	return process.env[`${prefix}_${key}`] ?? process.env[key];
}

export function getBotId(messenger: string): string {
	return getEnv(messenger, "BOT_ID") ?? messenger;
}

export function getSourceId(messenger: string): string {
	const sourceId = getEnv(messenger, "BITRIX_SOURCE_ID");
	if (!sourceId) {
		throw new Error(
			`BITRIX_SOURCE_ID не задан для ${messenger} — источник в Bitrix не определён`,
		);
	}
	return sourceId;
}

export function getSourceName(messenger: string): string {
	const label = messenger === "telegram" ? "Telegram" : "MAX";
	return getEnv(messenger, "BITRIX_SOURCE_NAME") ?? `${label}-бот`;
}

export function getWebhookBase(messenger: string): string {
	const url = getEnv(messenger, "BITRIX_WEBHOOK_URL");
	if (!url) throw new Error(`BITRIX_WEBHOOK_URL не задан для ${messenger}`);
	return url.replace(/\/$/, "");
}

export async function bitrixPost<T = unknown>(
	method: string,
	body: unknown,
	messenger: string,
): Promise<T> {
	const res = await fetch(`${getWebhookBase(messenger)}/${method}.json`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(30000),
	});
	const json = (await res.json()) as Record<string, unknown>;
	if (json.error) {
		throw new Error(
			`Bitrix24 [${method}]: ${json.error} — ${json.error_description ?? ""}`,
		);
	}
	return json.result as T;
}
