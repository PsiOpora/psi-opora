const messenger = process.argv[2] ?? "telegram";
const prefix = messenger === "telegram" ? "TG" : "MAX";
const webhookUrl =
	process.env[`${prefix}_BITRIX_WEBHOOK_URL`] ?? process.env.BITRIX_WEBHOOK_URL;
if (!webhookUrl) throw new Error("no webhook url");
const base = webhookUrl.replace(/\/$/, "");

async function call(method: string, body: unknown) {
	const res = await fetch(`${base}/${method}.json`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	return res.json();
}

// 1. Все поля контакта (в т.ч. кастомные UF_CRM_*)
const fieldsResp = await call("crm.contact.fields", {});
const fields = fieldsResp.result as Record<
	string,
	{ type: string; statusType?: string; title: string; items?: unknown[] }
>;

// 2. Пример реальных контактов — какие значения полей реально встречаются (последние 20)
const contactsResp = await call("crm.contact.list", {
	select: ["*", "UF_*"],
	order: { ID: "DESC" },
	start: 0,
});
const recentContacts = (contactsResp.result ?? []).slice(0, 20);

const out = {
	fields,
	recentContactsSample: recentContacts,
};

await Bun.write(
	new URL(`./contact-fields-audit-${messenger}.json`, import.meta.url),
	JSON.stringify(out, null, 2),
);
console.log("done");
