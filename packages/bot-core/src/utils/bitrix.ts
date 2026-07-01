export interface DealData {
  name: string;
  phone: string;
  campaign?: string;
  telegramUserId?: number;
  messenger?: string;
}

function getEnv(messenger: string, key: string): string | undefined {
  const prefix = messenger === "telegram" ? "TG" : "MAX";
  return process.env[`${prefix}_${key}`] ?? process.env[key];
}

function getWebhookBase(messenger: string): string {
  const url = getEnv(messenger, "BITRIX_WEBHOOK_URL");
  if (!url) throw new Error(`BITRIX_WEBHOOK_URL не задан для ${messenger}`);
  return url.replace(/\/$/, "");
}

async function bitrixPost<T = unknown>(method: string, body: unknown, messenger: string): Promise<T> {
  const res = await fetch(`${getWebhookBase(messenger)}/${method}.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json() as any;
  if (json.error) {
    throw new Error(`Bitrix24 [${method}]: ${json.error} — ${json.error_description ?? ""}`);
  }
  return json.result as T;
}

function buildContactFields(data: DealData) {
  return {
    NAME: data.name,
    PHONE: [{ VALUE: data.phone, VALUE_TYPE: "WORK" }],
  };
}

function buildDealFields(data: DealData, contactId: number) {
  const messenger = data.messenger ?? "telegram";
  return {
    TITLE: `Заявка с ${messenger}: ${data.name}`,
    CONTACT_IDS: [contactId],
    SOURCE_ID: "WEB",
    SOURCE_DESCRIPTION: data.campaign ?? `${messenger} бот`,
    UTM_SOURCE: messenger,
    UTM_MEDIUM: "bot",
    UTM_CAMPAIGN: data.campaign ?? "",
    COMMENTS: data.telegramUserId
      ? `${messenger} user_id: ${data.telegramUserId}`
      : "",
  };
}

export async function createBitrixDeal(data: DealData): Promise<void> {
  const messenger = data.messenger ?? "telegram";
  const webhookUrl = getEnv(messenger, "BITRIX_WEBHOOK_URL");
  if (!webhookUrl) {
    console.warn(`[bitrix] BITRIX_WEBHOOK_URL не задан для ${messenger}, пропускаем`);
    return;
  }

  // Создаём контакт (имя+телефон) и сделку в CRM
  const contactId = await bitrixPost<number>("crm.contact.add", {
    fields: buildContactFields(data),
  }, messenger);

  const dealId = await bitrixPost<number>("crm.deal.add", {
    fields: buildDealFields(data, contactId),
  }, messenger);
  console.log(
    `[bitrix] сделка создана id=${dealId} contact=${contactId} name=${data.name} phone=${data.phone}${data.campaign ? ` campaign=${data.campaign}` : ""} messenger=${messenger}`
  );
}

export async function registerBitrixConnector(messenger: string): Promise<void> {
  const webhookUrl = getEnv(messenger, "BITRIX_WEBHOOK_URL");
  if (!webhookUrl) throw new Error(`BITRIX_WEBHOOK_URL не задан для ${messenger}`);

  const connectorId = getEnv(messenger, "BITRIX_CONNECTOR_ID") ?? `psiopora_${messenger}_bot`;
  const openLineId = getEnv(messenger, "BITRIX_OPEN_LINE_ID");

  await bitrixPost("imconnector.register", {
    ID: connectorId,
    NAME: `Пси-Опора ${messenger === "telegram" ? "Telegram" : "MAX"} Бот`,
    ICON: { DATA_IMAGE: "" },
  }, messenger);
  console.log(`[bitrix] коннектор зарегистрирован: ${connectorId}`);

  if (openLineId) {
    await bitrixPost("imconnector.activate", {
      CONNECTOR: connectorId,
      LINE: openLineId,
      ACTIVE: "Y",
    }, messenger);
    console.log(`[bitrix] коннектор активирован для линии: ${openLineId} (${messenger})`);
  }
}
