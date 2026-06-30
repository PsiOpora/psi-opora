export interface LeadData {
  name: string;
  phone: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  telegramUserId?: number;
}

export async function createBitrixLead(data: LeadData): Promise<void> {
  const webhookUrl = process.env.BITRIX_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("[bitrix] BITRIX_WEBHOOK_URL не задан, пропускаем");
    return;
  }

  const url = `${webhookUrl.replace(/\/$/, "")}/crm.lead.add.json`;

  const body = {
    fields: {
      TITLE: `Заявка с Telegram: ${data.name}`,
      NAME: data.name,
      PHONE: [{ VALUE: data.phone, VALUE_TYPE: "WORK" }],
      SOURCE_ID: "WEB",
      SOURCE_DESCRIPTION: "Telegram бот",
      UTM_SOURCE: data.utmSource ?? "",
      UTM_MEDIUM: data.utmMedium ?? "",
      UTM_CAMPAIGN: data.utmCampaign ?? "",
      UTM_CONTENT: data.utmContent ?? "",
      UTM_TERM: data.utmTerm ?? "",
      COMMENTS: data.telegramUserId
        ? `Telegram user_id: ${data.telegramUserId}`
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
}
