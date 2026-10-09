/** Credential-independent portal key shared by OAuth and incoming webhooks. */
export function bitrixPortalKey(endpoint: string): string {
	const url = new URL(
		/^https?:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`,
	);
	if (!url.hostname) throw new Error("Missing Bitrix portal host");
	return url.host.toLowerCase();
}
