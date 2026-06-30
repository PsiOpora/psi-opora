export interface LeadData {
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

function buildLeadFields(data: LeadData) {
  const messenger = data.messenger ?? "telegram";
  return {
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
  };
}

function buildUserUrl(messenger: string, userId: number): string {
  if (messenger === "telegram") return `tg://user?id=${userId}`;
  if (messenger === "max") return `https://max.ru/profile/${userId}`;
  return "";
}

/**
 * Отправляет сообщение в Открытую Линию Bitrix24 через imconnector.
 * Создаёт сессию чата, к которой менеджер может ответить из CRM.
 * Возвращает chat_id сессии или null если Open Line не настроена.
 */
async function sendToOpenLine(data: LeadData, messenger: string): Promise<number | null> {
  const openLineId = getEnv(messenger, "BITRIX_OPEN_LINE_ID");
  const connectorId = getEnv(messenger, "BITRIX_CONNECTOR_ID") ?? "psiopora_bot";

  if (!openLineId || !data.telegramUserId) return null;

  const messageId = `${messenger}_${data.telegramUserId}_${Date.now()}`;
  const messageText =
    `Клиент оставил заявку на консультацию через ${messenger}-бот.\n` +
    `Имя: ${data.name}\n` +
    `Телефон: ${data.phone}` +
    (data.campaign ? `\nКампания: ${data.campaign}` : "");

  const result = await bitrixPost<{ chat_id?: number; session_id?: number }>(
    "imconnector.send.messages",
    {
      CONNECTOR: connectorId,
      LINE: openLineId,
      MESSAGES: [
        {
          id: messageId,
          date: new Date().toISOString(),
          text: messageText,
          user: {
            id: String(data.telegramUserId),
            name: data.name,
            avatar: "",
            url: buildUserUrl(messenger, data.telegramUserId),
          },
        },
      ],
    },
    messenger
  );

  return result?.chat_id ?? null;
}

async function bindLeadToOpenLine(leadId: number, chatId: number, messenger: string): Promise<void> {
  await bitrixPost("imopenlines.crm.lead.add", {
    CHAT_ID: chatId,
    ENTITY_ID: leadId,
  }, messenger);
}

export async function createBitrixLead(data: LeadData): Promise<void> {
  const messenger = data.messenger ?? "telegram";
  const webhookUrl = getEnv(messenger, "BITRIX_WEBHOOK_URL");
  if (!webhookUrl) {
    console.warn(`[bitrix] BITRIX_WEBHOOK_URL не задан для ${messenger}, пропускаем`);
    return;
  }

  // 1. Создаём лид в CRM
  const leadId = await bitrixPost<number>("crm.lead.add", {
    fields: buildLeadFields(data),
  }, messenger);
  console.log(
    `[bitrix] лид создан id=${leadId} name=${data.name} phone=${data.phone}${data.campaign ? ` campaign=${data.campaign}` : ""} messenger=${messenger}`
  );

  // 2. Если настроена Открытая Линия — создаём сессию чата и привязываем лид
  const openLineId = getEnv(messenger, "BITRIX_OPEN_LINE_ID");
  if (!openLineId) return;

  try {
    const chatId = await sendToOpenLine(data, messenger);
    if (chatId) {
      await bindLeadToOpenLine(leadId, chatId, messenger);
      console.log(
        `[bitrix] открытая линия привязана: lead=${leadId} chat=${chatId} line=${openLineId} messenger=${messenger}`
      );
    }
  } catch (err: any) {
    console.error("[bitrix] ошибка привязки открытой линии:", err.message);
  }
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
