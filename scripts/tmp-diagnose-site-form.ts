const urls: Record<string, string | undefined> = {
	DASHBOARD_BITRIX_WEBHOOK_URL: process.env.DASHBOARD_BITRIX_WEBHOOK_URL,
	TG_BITRIX_WEBHOOK_URL: process.env.TG_BITRIX_WEBHOOK_URL,
	MAX_BITRIX_WEBHOOK_URL: process.env.MAX_BITRIX_WEBHOOK_URL,
	BITRIX_CALENDAR_WEBHOOK_URL: process.env.BITRIX_CALENDAR_WEBHOOK_URL,
};

async function call(base: string, method: string, body: unknown = {}) {
	const res = await fetch(`${base.replace(/\/$/, "")}/${method}.json`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	return res.json();
}

const base = urls.TG_BITRIX_WEBHOOK_URL as string;
const form = await call(base, "crm.form.get", { id: 12 });
await Bun.write(
	new URL("./tmp-form-12.json", import.meta.url),
	JSON.stringify(form, null, 2),
);
console.log("written");
