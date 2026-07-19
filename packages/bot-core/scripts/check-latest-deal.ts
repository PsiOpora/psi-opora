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

const resp = await call("crm.deal.list", {
  select: [
    "ID",
    "TITLE",
    "SOURCE_ID",
    "SOURCE_DESCRIPTION",
    "UTM_SOURCE",
    "UTM_MEDIUM",
    "UTM_CAMPAIGN",
    "UTM_CONTENT",
    "UF_CRM_1779643796551",
    "COMMENTS",
    "DATE_CREATE",
  ],
  order: { ID: "DESC" },
  start: 0,
});

console.log(JSON.stringify(resp.result?.slice(0, 5), null, 2));
