export interface LeadData {
  name: string;
  phone: string;
  campaign?: string;
  telegramUserId?: number;
  messenger?: string;
}

function getWebhookBase(): string {
  const url = process.env.BITRIX_WEBHOOK_URL;
  if (!url) throw new Error("BITRIX_WEBHOOK_URL не задан");
  return url.replace(/\/$/, "");
}

async function bitrixPost<T = unknown>(method: string, body: unknown): Promise<T> {
  const res = await fetch(`${getWebhookBase()}/${method}.json`, {
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
async function sendToOpenLine(data: LeadData): Promise<number | null> {
  const openLineId = process.env.BITRIX_OPEN_LINE_ID;
  const connectorId = process.env.BITRIX_CONNECTOR_ID ?? "psiopora_bot";

  if (!openLineId || !data.telegramUserId) return null;

  const messenger = data.messenger ?? "telegram";
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
    }
  );

  return result?.chat_id ?? null;
}

/**
 * Привязывает существующий лид к сессии Открытой Линии.
 * Вызывается после создания лида, если есть chat_id из Open Line.
 */
async function bindLeadToOpenLine(leadId: number, chatId: number): Promise<void> {
  await bitrixPost("imopenlines.crm.lead.add", {
    CHAT_ID: chatId,
    ENTITY_ID: leadId,
  });
}

export async function createBitrixLead(data: LeadData): Promise<void> {
  const webhookUrl = process.env.BITRIX_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("[bitrix] BITRIX_WEBHOOK_URL не задан, пропускаем");
    return;
  }

  const messenger = data.messenger ?? "telegram";

  // 1. Создаём лид в CRM
  const leadId = await bitrixPost<number>("crm.lead.add", {
    fields: buildLeadFields(data),
  });
  console.log(
    `[bitrix] лид создан id=${leadId} name=${data.name} phone=${data.phone}${data.campaign ? ` campaign=${data.campaign}` : ""} messenger=${messenger}`
  );

  // 2. Если настроена Открытая Линия — создаём сессию чата и привязываем лид
  const openLineId = process.env.BITRIX_OPEN_LINE_ID;
  if (!openLineId) return;

  try {
    const chatId = await sendToOpenLine(data);
    if (chatId) {
      await bindLeadToOpenLine(leadId, chatId);
      console.log(
        `[bitrix] открытая линия привязана: lead=${leadId} chat=${chatId} line=${openLineId} messenger=${messenger}`
      );
    }
  } catch (err: any) {
    console.error("[bitrix] ошибка привязки открытой линии:", err.message);
  }
}

/**
 * Регистрирует коннектор в Bitrix24 (разовая настройка).
 * Запускать один раз через: bun run packages/bot-core/src/utils/bitrix.ts
 */
export async function registerBitrixConnector(): Promise<void> {
  const webhookUrl = process.env.BITRIX_WEBHOOK_URL;
  if (!webhookUrl) throw new Error("BITRIX_WEBHOOK_URL не задан");

  const connectorId = process.env.BITRIX_CONNECTOR_ID ?? "psiopora_bot";
  const openLineId = process.env.BITRIX_OPEN_LINE_ID;

  await bitrixPost("imconnector.register", {
    ID: connectorId,
    NAME: "Пси-Опора Бот",
    ICON: {
      DATA_IMAGE: "",
    },
  });
  console.log(`[bitrix] коннектор зарегистрирован: ${connectorId}`);

  if (openLineId) {
    await bitrixPost("imconnector.activate", {
      CONNECTOR: connectorId,
      LINE: openLineId,
      ACTIVE: "Y",
    });
    console.log(`[bitrix] коннектор активирован для линии: ${openLineId}`);
  }
}
