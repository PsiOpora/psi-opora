export interface LeadData {
  name: string;
  phone: string;
  campaign?: string;
  telegramUserId?: number;
  messenger?: string;
}

export async function createBitrixLead(data: LeadData): Promise<void> {
  const webhookUrl = process.env.BITRIX_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("[bitrix] BITRIX_WEBHOOK_URL не задан, пропускаем");
    return;
  }

  const url = `${webhookUrl.replace(/\/$/, "")}/crm.lead.add.json`;
  const messenger = data.messenger ?? "telegram";

  const body = {
    fields: {
      TITLE: `Заявка с ${messenger}: ${data.name}`,
      NAME: data.name,
      PHONE: [{ VALUE: data.phone, VALUE_TYPE: "WORK" }],
      SOURCE_ID: "WEB",
      SOURCE_DESCRIPTION: data.campaign ?? `${messenger} бот`,
      UTM_SOURCE: messenger,
      UTM_MEDIUM: "bot",
      UTM_CAMPAIGN: data.campaign ?? "",
      COMMENTS: data.telegramUserId
        ? `${messenger} user_id: ${data.telegramUserId}`
        : "",
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = await res.json() as any;
  if (json.error) {
    throw new Error(`Bitrix24 error: ${json.error} — ${json.error_description}`);
  }
  console.log(
    `[bitrix] лид создан id=${json.result} name=${data.name} phone=${data.phone}${data.campaign ? ` campaign=${data.campaign}` : ""}`
  );
}
