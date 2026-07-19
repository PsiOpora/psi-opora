export interface DealData {
  name: string;
  phone: string;
  email?: string;
  campaign?: string;
  source?: string;
  telegramUserId?: number;
  messenger?: string;
  chatId?: number;
  operatorId?: number;
  /** Дополнительный комментарий к сделке (выбор пользователя в сценарии). */
  comment?: string;
}

function getEnv(messenger: string, key: string): string | undefined {
  const prefix = messenger === "telegram" ? "TG" : "MAX";
  return process.env[`${prefix}_${key}`] ?? process.env[key];
}

function getBotId(messenger: string): string {
  return getEnv(messenger, "BOT_ID") ?? messenger;
}

function getSourceId(messenger: string): string {
  const sourceId = getEnv(messenger, "BITRIX_SOURCE_ID");
  if (!sourceId) {
    throw new Error(
      `BITRIX_SOURCE_ID не задан для ${messenger} — источник в Bitrix не определён`,
    );
  }
  return sourceId;
}

function getSourceName(messenger: string): string {
  const label = messenger === "telegram" ? "Telegram" : "MAX";
  return getEnv(messenger, "BITRIX_SOURCE_NAME") ?? `${label}-бот`;
}

function getWebhookBase(messenger: string): string {
  const url = getEnv(messenger, "BITRIX_WEBHOOK_URL");
  if (!url) throw new Error(`BITRIX_WEBHOOK_URL не задан для ${messenger}`);
  return url.replace(/\/$/, "");
}

async function bitrixPost<T = unknown>(
  method: string,
  body: unknown,
  messenger: string,
): Promise<T> {
  const res = await fetch(`${getWebhookBase(messenger)}/${method}.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (json.error) {
    throw new Error(
      `Bitrix24 [${method}]: ${json.error} — ${json.error_description ?? ""}`,
    );
  }
  return json.result as T;
}

// Поле контакта в Wazzup-интеграции (кнопка «написать клиенту» в CRM),
// заполняется автоматически только при обращении через Open Line Wazzup —
// контактам, созданным ботом напрямую через API, нужно проставлять вручную.
const MESSENGER_WZ_ID_FIELD: Record<string, string> = {
  max: "UF_CRM_MAXID_WZ",
  telegram: "UF_CRM_TELEGRAMID_WZ",
};

function buildContactFields(data: DealData) {
  const messenger = data.messenger ?? "telegram";
  const wzIdField = MESSENGER_WZ_ID_FIELD[messenger];
  return {
    NAME: data.name,
    PHONE: [{ VALUE: data.phone, VALUE_TYPE: "WORK" }],
    ...(data.email
      ? { EMAIL: [{ VALUE: data.email, VALUE_TYPE: "WORK" }] }
      : {}),
    SOURCE_ID: getSourceId(messenger),
    SOURCE_DESCRIPTION: [data.source, data.campaign]
      .filter(Boolean)
      .join(" / "),
    // Сценарий бота (см. scenario/engine.ts) всегда показывает экран
    // согласия с публичной офертой перед сбором контактов — и во флоу
    // консультации, и во флоу гайда, — так что к моменту создания
    // контакта согласие уже получено.
    UF_CRM_CONTACT_1779910236669: 1,
    ...(data.telegramUserId
      ? {
          IM: [{ VALUE: String(data.telegramUserId), VALUE_TYPE: messenger }],
          ...(wzIdField ? { [wzIdField]: String(data.telegramUserId) } : {}),
        }
      : {}),
  };
}

// ID значений поля "Мессенджер" (UF_CRM_1779643796551) в Bitrix24.
const MESSENGER_FIELD_VALUES: Record<string, string> = {
  max: "326", // МАКС
  telegram: "328", // Telegram
};
const MESSENGER_FIELD_OTHER = "376"; // Другой

function buildDealFields(data: DealData, contactId: number) {
  const messenger = data.messenger ?? "telegram";
  const botId = getBotId(messenger);
  const description = [data.source, data.campaign].filter(Boolean).join(" / ");
  return {
    TITLE: `Заявка (${botId}): ${data.name}`,
    CONTACT_IDS: [contactId],
    SOURCE_ID: getSourceId(messenger),
    SOURCE_DESCRIPTION: description || `${messenger} бот`,
    UTM_SOURCE: data.source ?? messenger,
    UTM_MEDIUM: `${messenger}_bot`,
    UTM_CAMPAIGN: data.campaign ?? "",
    UTM_CONTENT: botId,
    UF_CRM_1779643796551:
      MESSENGER_FIELD_VALUES[messenger] ?? MESSENGER_FIELD_OTHER,
    COMMENTS: [
      `Бот: ${botId}`,
      data.telegramUserId ? `${messenger} user_id: ${data.telegramUserId}` : "",
      data.comment ?? "",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

async function linkBitrixTrace(
  messenger: string,
  contactId: number,
  dealId: number,
  data: DealData,
): Promise<void> {
  const trace = {
    SOURCE_ID: getSourceId(messenger),
    SOURCE_DESC:
      [data.source, data.campaign].filter(Boolean).join(" / ") ||
      `${messenger} бот`,
  };

  try {
    await bitrixPost(
      "crm.tracking.trace.add",
      {
        TRACE: JSON.stringify(trace),
        ENTITIES: [
          { TYPE: "CONTACT", ID: contactId },
          { TYPE: "DEAL", ID: dealId },
        ],
      },
      messenger,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[bitrix] не удалось привязать трейс сквозной аналитики: ${message}`,
    );
  }
}

export async function createBitrixDeal(
  data: DealData,
): Promise<{ contactId: number; dealId: number }> {
  const messenger = data.messenger ?? "telegram";
  const webhookUrl = getEnv(messenger, "BITRIX_WEBHOOK_URL");
  if (!webhookUrl) {
    console.warn(
      `[bitrix] BITRIX_WEBHOOK_URL не задан для ${messenger}, пропускаем`,
    );
    return { contactId: 0, dealId: 0 };
  }

  const contactId = await bitrixPost<number>(
    "crm.contact.add",
    {
      fields: buildContactFields(data),
    },
    messenger,
  );

  const dealId = await bitrixPost<number>(
    "crm.deal.add",
    {
      fields: buildDealFields(data, contactId),
    },
    messenger,
  );
  console.log(
    `[bitrix] сделка создана id=${dealId} contact=${contactId} name=${data.name} phone=${data.phone}${data.email ? ` email=${data.email}` : ""}${data.source ? ` source=${data.source}` : ""}${data.campaign ? ` campaign=${data.campaign}` : ""} bot=${getBotId(messenger)}`,
  );

  await linkBitrixTrace(messenger, contactId, dealId, data);

  if (data.chatId) {
    try {
      await bitrixPost(
        "imopenlines.crm.chat.user.add",
        {
          CRM_ENTITY_TYPE: "contact",
          CRM_ENTITY: contactId,
          USER_ID: data.operatorId ?? 0,
          CHAT_ID: data.chatId,
        },
        messenger,
      );
      console.log(
        `[bitrix] чат ${data.chatId} привязан к контакту ${contactId}`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[bitrix] не удалось привязать чат к контакту: ${message}`);
    }
  }

  return { contactId, dealId };
}

/**
 * Добавляет комментарий в таймлайн сделки (например, ответ на вопрос
 * о рассылке). Ошибки не пробрасываются — комментарий не критичен.
 */
export async function appendDealComment(
  messenger: string,
  dealId: number,
  comment: string,
): Promise<void> {
  const webhookUrl = getEnv(messenger, "BITRIX_WEBHOOK_URL");
  if (!webhookUrl || !dealId) return;

  try {
    await bitrixPost(
      "crm.timeline.comment.add",
      {
        fields: {
          ENTITY_ID: dealId,
          ENTITY_TYPE: "deal",
          COMMENT: comment,
        },
      },
      messenger,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[bitrix] не удалось добавить комментарий к сделке ${dealId}: ${message}`,
    );
  }
}

export interface BitrixSource {
  STATUS_ID: string;
  NAME: string;
}

export async function listBitrixSources(
  messenger: string,
): Promise<BitrixSource[]> {
  const webhookUrl = getEnv(messenger, "BITRIX_WEBHOOK_URL");
  if (!webhookUrl)
    throw new Error(`BITRIX_WEBHOOK_URL не задан для ${messenger}`);

  return bitrixPost<BitrixSource[]>(
    "crm.status.list",
    {
      filter: { ENTITY_ID: "SOURCE" },
      select: ["STATUS_ID", "NAME"],
    },
    messenger,
  );
}

export async function registerBitrixSource(messenger: string): Promise<void> {
  const webhookUrl = getEnv(messenger, "BITRIX_WEBHOOK_URL");
  if (!webhookUrl)
    throw new Error(`BITRIX_WEBHOOK_URL не задан для ${messenger}`);

  const sourceId = getSourceId(messenger);
  const sourceName = getSourceName(messenger);

  try {
    await bitrixPost(
      "crm.status.add",
      {
        fields: { ENTITY_ID: "SOURCE", STATUS_ID: sourceId, NAME: sourceName },
      },
      messenger,
    );
    console.log(`[bitrix] источник создан: ${sourceId} (${sourceName})`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (String(message).includes("Duplicate")) {
      console.log(`[bitrix] источник уже существует: ${sourceId}`);
      return;
    }
    throw err;
  }
}

export async function registerBitrixConnector(
  messenger: string,
): Promise<void> {
  const webhookUrl = getEnv(messenger, "BITRIX_WEBHOOK_URL");
  if (!webhookUrl)
    throw new Error(`BITRIX_WEBHOOK_URL не задан для ${messenger}`);

  const connectorId =
    getEnv(messenger, "BITRIX_CONNECTOR_ID") ?? `psiopora_${messenger}_bot`;
  const openLineId = getEnv(messenger, "BITRIX_OPEN_LINE_ID");

  await bitrixPost(
    "imconnector.register",
    {
      ID: connectorId,
      NAME: `Пси-Опора ${messenger === "telegram" ? "Telegram" : "MAX"} Бот`,
      ICON: { DATA_IMAGE: "" },
    },
    messenger,
  );
  console.log(`[bitrix] коннектор зарегистрирован: ${connectorId}`);

  if (openLineId) {
    await bitrixPost(
      "imconnector.activate",
      {
        CONNECTOR: connectorId,
        LINE: openLineId,
        ACTIVE: "Y",
      },
      messenger,
    );
    console.log(
      `[bitrix] коннектор активирован для линии: ${openLineId} (${messenger})`,
    );
  }
}
