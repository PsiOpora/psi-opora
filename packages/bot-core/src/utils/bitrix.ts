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
async function sendToOpenLine(data: DealData, messenger: string): Promise<number | null> {
  const openLineId = getEnv(messenger, "BITRIX_OPEN_LINE_ID");
  const connectorId = getEnv(messenger, "BITRIX_CONNECTOR_ID") ?? "psiopora_bot";

  if (!openLineId || !data.telegramUserId) return null;

  const messageText =
    `Клиент оставил заявку на консультацию через ${messenger}-бот.\n` +
    `Имя: ${data.name}\n` +
    `Телефон: ${data.phone}` +
    (data.campaign ? `\nКампания: ${data.campaign}` : "");

  const result = await bitrixPost<{
    SUCCESS?: boolean;
    DATA?: { RESULT?: Array<{ session?: { CHAT_ID?: string | number } }> };
  }>(
    "imconnector.send.messages",
    {
      CONNECTOR: connectorId,
      LINE: openLineId,
      MESSAGES: [
        {
          user: {
            id: String(data.telegramUserId),
            name: data.name,
            url: buildUserUrl(messenger, data.telegramUserId),
            skip_phone_validate: "Y",
          },
          message: {
            id: `${messenger}_${data.telegramUserId}_${Date.now()}`,
            date: Math.floor(Date.now() / 1000),
            text: messageText,
          },
          chat: {
            id: `${messenger}_${data.telegramUserId}`,
            name: data.name,
          },
        },
      ],
    },
    messenger
  );

  const chatId = result?.DATA?.RESULT?.[0]?.session?.CHAT_ID;
  return chatId ? Number(chatId) : null;
}

/**
 * Bitrix24 сам привязывает CRM-сущность к чату открытой линии (трекер CRM)
 * на основе настроек линии в админке — API для ручной привязки произвольной
 * сделки к чату не существует. Здесь только проверяем, что чат реально
 * привязан к нашей сделке, чтобы не полагаться на "тихий" сбой.
 */
async function verifyOpenLineBinding(chatId: number, dealId: number, messenger: string): Promise<void> {
  const dialog = await bitrixPost<{ entity_data_2?: string }>(
    "imopenlines.dialog.get",
    { CHAT_ID: chatId },
    messenger
  );

  const boundDealId = dialog?.entity_data_2?.match(/DEAL\|(\d+)/)?.[1];

  if (boundDealId && Number(boundDealId) === dealId) {
    console.log(`[bitrix] открытая линия привязана к сделке: deal=${dealId} chat=${chatId}`);
  } else {
    console.warn(
      `[bitrix] чат открытой линии chat=${chatId} не привязан к сделке deal=${dealId} ` +
      `(bound=${dialog?.entity_data_2 ?? "?"}). Проверьте в Bitrix24: Контакт-центр → линия → ` +
      `вкладка CRM → тип создаваемого элемента должен быть «Сделка».`
    );
  }
}

export async function createBitrixDeal(data: DealData): Promise<void> {
  const messenger = data.messenger ?? "telegram";
  const webhookUrl = getEnv(messenger, "BITRIX_WEBHOOK_URL");
  if (!webhookUrl) {
    console.warn(`[bitrix] BITRIX_WEBHOOK_URL не задан для ${messenger}, пропускаем`);
    return;
  }

  // 1. Создаём контакт (имя+телефон) и сделку в CRM
  const contactId = await bitrixPost<number>("crm.contact.add", {
    fields: buildContactFields(data),
  }, messenger);

  const dealId = await bitrixPost<number>("crm.deal.add", {
    fields: buildDealFields(data, contactId),
  }, messenger);
  console.log(
    `[bitrix] сделка создана id=${dealId} contact=${contactId} name=${data.name} phone=${data.phone}${data.campaign ? ` campaign=${data.campaign}` : ""} messenger=${messenger}`
  );

  // 2. Если настроена Открытая Линия — создаём сессию чата и проверяем привязку
  const openLineId = getEnv(messenger, "BITRIX_OPEN_LINE_ID");
  if (!openLineId) return;

  try {
    const chatId = await sendToOpenLine(data, messenger);
    if (chatId) {
      await verifyOpenLineBinding(chatId, dealId, messenger);
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
