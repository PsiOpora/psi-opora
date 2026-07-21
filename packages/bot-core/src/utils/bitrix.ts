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
  /** Ветка сценария (см. scenario/engine.ts) — попадает в заголовок и «Продукт». */
  flow?: "consult" | "guide";
  /** Выбор в флоу гайда: кому нужна помощь. */
  audience?: "child" | "self";
  /** Выбор в флоу гайда: с чем связаны трудности. */
  issue?: "eating" | "ocd" | "other";
  /** Ниже — доп. данные профиля из мессенджера (bot_users), для карточки контакта. */
  username?: string;
  languageCode?: string;
  isPremium?: boolean;
  bio?: string;
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

// Значение IM-поля в формате Открытых линий (`imol|{connector}|{line}|{user_id}|{chat_id}`) —
// именно в таком виде Битрикс делает иконку мессенджера кликабельной и открывает диалог
// открытой линии из карточки CRM. Без chatId/lineId (чат ещё не привязан к линии) откатываемся
// на голый ID пользователя — как и раньше, просто справочная запись.
function buildImValue(
  messenger: string,
  userId: number,
  chatId?: number,
): string {
  const lineId = getEnv(messenger, "BITRIX_OPEN_LINE_ID");
  if (!chatId || !lineId) return String(userId);
  return `imol|${messenger}|${lineId}|${userId}|${chatId}`;
}

/** Поля привязки мессенджера к контакту (IM + UF Wazzup-ID) — используются и при создании, и при линковке к уже найденному контакту. */
function buildMessengerLinkFields(data: DealData) {
  if (!data.telegramUserId) return null;
  const messenger = data.messenger ?? "telegram";
  const wzIdField = MESSENGER_WZ_ID_FIELD[messenger];
  return {
    IM: [
      {
        VALUE: buildImValue(messenger, data.telegramUserId, data.chatId),
        VALUE_TYPE: messenger,
      },
    ],
    ...(wzIdField ? { [wzIdField]: String(data.telegramUserId) } : {}),
  };
}

/**
 * Собирает доп. данные профиля мессенджера (username, язык, bio) в
 * читаемый комментарий для карточки контакта — Bitrix не заводит под них
 * отдельных полей, поэтому это просто текстовая справка для оператора.
 */
function buildProfileComment(data: DealData): string | undefined {
  const lines = [
    data.username && `Username: @${data.username}`,
    data.languageCode && `Язык интерфейса: ${data.languageCode}`,
    data.isPremium && "Telegram Premium: да",
    data.bio && `О себе: ${data.bio}`,
  ].filter(Boolean);
  return lines.length ? `Профиль в мессенджере:\n${lines.join("\n")}` : undefined;
}

function buildContactFields(data: DealData) {
  const messenger = data.messenger ?? "telegram";
  const profileComment = buildProfileComment(data);
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
    ...(profileComment ? { COMMENTS: profileComment } : {}),
    ...(buildMessengerLinkFields(data) ?? {}),
  };
}

async function findContactIdByMessengerId(
  messenger: string,
  telegramUserId: number,
): Promise<number | null> {
  const wzIdField = MESSENGER_WZ_ID_FIELD[messenger];
  if (!wzIdField) return null;
  const contacts = await bitrixPost<{ ID: string }[]>(
    "crm.contact.list",
    { filter: { [wzIdField]: String(telegramUserId) }, select: ["ID"] },
    messenger,
  );
  return contacts[0] ? Number(contacts[0].ID) : null;
}

async function findContactIdByComm(
  messenger: string,
  type: "PHONE" | "EMAIL",
  value: string,
): Promise<number | null> {
  const result = await bitrixPost<{ CONTACT?: number[] }>(
    "crm.duplicate.findbycomm",
    { entity_type: "CONTACT", type, values: [value] },
    messenger,
  );
  return result.CONTACT?.[0] ?? null;
}

/**
 * Ищет контакт, уже существующий в Bitrix, перед созданием нового —
 * сперва по ID в мессенджере (самый точный признак), затем по телефону
 * и email, — чтобы не плодить дубликаты для одного и того же человека.
 * Ошибки поиска не пробрасываются: при сбое просто создаём новый контакт,
 * как раньше.
 */
async function findExistingContactId(data: DealData): Promise<number | null> {
  const messenger = data.messenger ?? "telegram";
  try {
    if (data.telegramUserId) {
      const byMessenger = await findContactIdByMessengerId(
        messenger,
        data.telegramUserId,
      );
      if (byMessenger) return byMessenger;
    }
    if (data.phone) {
      const byPhone = await findContactIdByComm(messenger, "PHONE", data.phone);
      if (byPhone) return byPhone;
    }
    if (data.email) {
      const byEmail = await findContactIdByComm(messenger, "EMAIL", data.email);
      if (byEmail) return byEmail;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[bitrix] ошибка поиска существующего контакта: ${message}`);
  }
  return null;
}

// ID значений поля "Мессенджер" (UF_CRM_1779643796551) в Bitrix24.
const MESSENGER_FIELD_VALUES: Record<string, string> = {
  max: "326", // МАКС
  telegram: "328", // Telegram
};
const MESSENGER_FIELD_OTHER = "376"; // Другой

// ID значения "Консультация" поля "Продукт" (UF_CRM_1779045469683).
// Для флоу гайда «продукт» не подставляем — это лид-магнит, а не заявка
// на конкретную услугу.
const PRODUCT_CONSULT_ID = "258";

const AUDIENCE_LABELS: Record<NonNullable<DealData["audience"]>, string> = {
  child: "Ребёнок",
  self: "Для себя",
};
const ISSUE_LABELS: Record<NonNullable<DealData["issue"]>, string> = {
  eating: "Питание",
  ocd: "ОКР",
  other: "Другое",
};

/** Короткая метка ветки сценария для заголовка сделки — видна в канбане без открытия карточки. */
function buildFlowLabel(data: DealData): string | undefined {
  if (data.flow === "consult") return "Консультация";
  if (data.flow === "guide") {
    const details = [
      data.audience && AUDIENCE_LABELS[data.audience],
      data.issue && ISSUE_LABELS[data.issue],
    ]
      .filter(Boolean)
      .join("/");
    return details ? `Гайд: ${details}` : "Гайд";
  }
  return undefined;
}

function buildDealFields(data: DealData, contactId: number) {
  const messenger = data.messenger ?? "telegram";
  const botId = getBotId(messenger);
  const description = [data.source, data.campaign].filter(Boolean).join(" / ");
  const flowLabel = buildFlowLabel(data);
  return {
    TITLE: `Заявка (${[flowLabel, botId].filter(Boolean).join(", ")}): ${data.name}`,
    CONTACT_IDS: [contactId],
    SOURCE_ID: getSourceId(messenger),
    SOURCE_DESCRIPTION: description || `${messenger} бот`,
    UTM_SOURCE: data.source ?? messenger,
    UTM_MEDIUM: `${messenger}_bot`,
    UTM_CAMPAIGN: data.campaign ?? "",
    UTM_CONTENT: botId,
    UF_CRM_1779643796551:
      MESSENGER_FIELD_VALUES[messenger] ?? MESSENGER_FIELD_OTHER,
    ...(data.flow === "consult"
      ? { UF_CRM_1779045469683: PRODUCT_CONSULT_ID }
      : {}),
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

  let contactId = await findExistingContactId(data);
  if (contactId) {
    console.log(
      `[bitrix] используем существующий контакт id=${contactId} вместо создания нового (phone=${data.phone}${data.email ? ` email=${data.email}` : ""})`,
    );
    const messengerLink = buildMessengerLinkFields(data);
    if (messengerLink) {
      try {
        await bitrixPost(
          "crm.contact.update",
          { id: contactId, fields: messengerLink },
          messenger,
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[bitrix] не удалось привязать мессенджер к контакту ${contactId}: ${message}`,
        );
      }
    }
  } else {
    contactId = await bitrixPost<number>(
      "crm.contact.add",
      {
        fields: buildContactFields(data),
      },
      messenger,
    );
  }

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

// Bitrix отклоняет весь вызов imconnector.send.messages, если user.name не
// проходит валидацию (только буквы, пробелы, дефисы, апострофы, ≤25 символов) —
// имена из Telegram/MAX могут содержать эмодзи и цифры, поэтому подставляем
// поле, только если оно точно пройдёт проверку.
function sanitizeOpenLineName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().slice(0, 25);
  return /^[\p{L}\s'-]+$/u.test(trimmed) ? trimmed : undefined;
}

export interface OpenLineMessageData {
  messenger: string;
  userId: number;
  /** ID чата в мессенджере (Telegram chat_id / MAX chat_id) — по этому
   * значению Bitrix сопоставляет сообщение с уже открытым диалогом. */
  chatId: number;
  text: string;
  /** Имя клиента для отображения в диалоге (необязательно). */
  name?: string;
}

/**
 * Дублирует сообщение клиента в Открытую линию Bitrix24 через
 * imconnector.send.messages — так оператор видит переписку из бота и
 * может ответить прямо в Открытой линии. Ответ оператора прилетает
 * обратным вебхуком (событие ONIMCONNECTORMESSAGEADD) — см.
 * apps/bitrix-webhook, который пересылает его через sendMessengerMessage.
 * Без BITRIX_OPEN_LINE_ID тихо пропускаем (коннектор не активирован).
 */
export async function sendMessageToOpenLine(
  data: OpenLineMessageData,
): Promise<void> {
  const webhookUrl = getEnv(data.messenger, "BITRIX_WEBHOOK_URL");
  const lineId = getOpenLineId(data.messenger);
  if (!webhookUrl || !lineId) return;

  const name = sanitizeOpenLineName(data.name);

  try {
    await bitrixPost(
      "imconnector.send.messages",
      {
        CONNECTOR: getConnectorId(data.messenger),
        LINE: lineId,
        MESSAGES: [
          {
            user: {
              id: String(data.userId),
              ...(name ? { name } : {}),
              skip_phone_validate: "Y",
            },
            message: {
              id: `${data.messenger}-${data.userId}-${Date.now()}`,
              date: Math.floor(Date.now() / 1000),
              text: data.text,
            },
            chat: {
              id: String(data.chatId),
              name: data.name || `${data.messenger} #${data.userId}`,
            },
          },
        ],
      },
      data.messenger,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[bitrix] не удалось переслать сообщение в Открытую линию: ${message}`,
    );
  }
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

function getConnectorId(messenger: string): string {
  return getEnv(messenger, "BITRIX_CONNECTOR_ID") ?? `psiopora_${messenger}_bot`;
}

function getOpenLineId(messenger: string): string | undefined {
  return getEnv(messenger, "BITRIX_OPEN_LINE_ID");
}

export async function registerBitrixConnector(
  messenger: string,
): Promise<void> {
  const webhookUrl = getEnv(messenger, "BITRIX_WEBHOOK_URL");
  if (!webhookUrl)
    throw new Error(`BITRIX_WEBHOOK_URL не задан для ${messenger}`);

  const connectorId = getConnectorId(messenger);
  const openLineId = getOpenLineId(messenger);

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
