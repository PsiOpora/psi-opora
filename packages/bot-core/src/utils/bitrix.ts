import { getBotConnector } from "@psi-opora/db/queries.edge";

/**
 * Минимальный интерфейс Bitrix24-клиента, который нужен методам `imconnector.*`
 * (`imconnector.register`/`imconnector.activate`/`imconnector.send.messages`
 * работают только в контексте OAuth-приложения — обычный входящий вебхук,
 * которым пользуется остальной этот файл через `bitrixPost`, для них не
 * подходит: Bitrix отвечает `WRONG_AUTH_TYPE`). Специально не импортируем
 * `BitrixApi` из `@psi-opora/bitrix-client` — тот пакет сам зависит от
 * bot-core (использует `createUpstashRedis`), обратная зависимость создала
 * бы цикл воркспейсов. Вызывающая сторона (apps/tg-bot, apps/max-bot)
 * передаёт уже готовый клиент через `resolveBitrixApi(memberId)`.
 */
export interface BitrixApiLike {
  call<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T>;
}

export interface DealData {
  name: string;
  phone: string;
  email?: string;
  campaign?: string;
  source?: string;
  telegramUserId?: number;
  messenger?: string;
  /** Внешний ID чата, переданный в imconnector.send.messages (chat.id) —
   * нужен, чтобы через USER_CODE найти диалог Bitrix и созданные по нему
   * трекером Открытой линии контакт/сделку (см. resolveOpenLineDialog). */
  chatId?: number;
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

// Значение IM-поля — голый ID пользователя в мессенджере, просто справочная
// запись. Формат `imol|{connector}|{line}|{user_id}|{chat_id}`, которым
// Bitrix помечает открытую линию как источник мессенджер-идентификатора, —
// это внутренний, генерируемый самим Bitrix при обработке imconnector.*
// идентификатор (см. документацию по импорту контактов CRM), а не то, что
// можно собрать вручную по этой схеме — попытка сконструировать его на
// стороне бота даёт нерабочее значение.
function buildMessengerLinkFields(data: DealData) {
  if (!data.telegramUserId) return null;
  const messenger = data.messenger ?? "telegram";
  const wzIdField = MESSENGER_WZ_ID_FIELD[messenger];
  return {
    IM: [
      {
        VALUE: String(data.telegramUserId),
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

interface OpenLineDialog {
  /** Внутренний ID чата Bitrix (для imopenlines.crm.chat.user.add). */
  chatId: number;
  /** Контакт, который CRM-трекер Открытой линии создал по чату. */
  contactId: number | null;
  /** Сделка, которую CRM-трекер Открытой линии создал по чату. */
  dealId: number | null;
  leadId: number | null;
}

/**
 * entity_data_2 диалога — привязки CRM парами `TYPE|ID`:
 * `LEAD|0|COMPANY|0|CONTACT|123|DEAL|456` (0 = привязки нет).
 */
function parseDialogCrmBindings(
  raw: string | undefined,
): Pick<OpenLineDialog, "contactId" | "dealId" | "leadId"> {
  const bindings: Record<string, number> = {};
  const parts = (raw ?? "").split("|");
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const type = parts[i];
    const id = Number(parts[i + 1]);
    if (type && Number.isFinite(id) && id > 0) bindings[type] = id;
  }
  return {
    contactId: bindings.CONTACT ?? null,
    dealId: bindings.DEAL ?? null,
    leadId: bindings.LEAD ?? null,
  };
}

/**
 * Резолвит диалог Открытой линии через imopenlines.dialog.get по USER_CODE:
 * настоящий внутренний ID чата Bitrix (нужен для imopenlines.crm.chat.user.add —
 * CHAT_ID там означает внутренний ID чата, а не наш внешний user_id/chat_id)
 * плюс CRM-сущности, которые трекер линии уже успел создать по этому чату
 * (entity_data_2) — их используем вместо создания дублей.
 * Формат USER_CODE — `{connector}|{line}|{chat_id}|{user_id}` —
 * это то же самое, что мы уже передаём в imconnector.send.messages
 * (chat.id/user.id), так что дополнительно ничего не нужно хранить.
 * ACCESS_ERROR — нормальная ситуация, если диалог ещё не создан (сообщение
 * через коннектор ещё не отправлялось) — не логируем как ошибку.
 */
async function resolveOpenLineDialog(
  messenger: string,
  userId: number,
  chatId: number,
): Promise<OpenLineDialog | null> {
  const config = await getBotConnector(messenger);
  if (!config) return null;
  const userCode = `${config.connectorId}|${config.openLineId}|${chatId}|${userId}`;
  try {
    const result = await bitrixPost<{ id?: number; entity_data_2?: string }>(
      "imopenlines.dialog.get",
      { USER_CODE: userCode },
      messenger,
    );
    if (!result?.id) return null;
    return { chatId: result.id, ...parseDialogCrmBindings(result.entity_data_2) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("ACCESS_ERROR")) {
      console.error(
        `[bitrix] не удалось получить диалог по USER_CODE ${userCode}: ${message}`,
      );
    }
    return null;
  }
}

// Трекер Открытой линии создаёт контакт+сделку по первому сообщению чата
// асинхронно на стороне Bitrix — к моменту завершения сценария они почти
// всегда уже есть, но при лаге ждём немного, прежде чем создавать свою
// сделку (сделка трекера предпочтительнее: к ней Bitrix сам привязывает
// чат, канал и источник линии). Бюджет ожидания намеренно маленький:
// бот работает в serverless-обработчике вебхука Telegram, и grammY
// webhookCallback обязан ответить за 10 секунд — иначе Telegram пришлёт
// апдейт повторно.
const OPENLINE_DEAL_WAIT_ATTEMPTS = 4;
const OPENLINE_DEAL_WAIT_DELAY_MS = 1200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Резолвит диалог Открытой линии, дожидаясь появления сделки (или лида —
 * в классическом режиме CRM трекер создаёт лид, ждать сделку бессмысленно),
 * созданной трекером линии. Если за отведённые попытки CRM-сущность так и
 * не появилась, возвращает последний известный диалог (возможно, без
 * сделки) — дальше сработает фолбэк с созданием собственной сделки.
 */
async function waitForOpenLineDialog(
  messenger: string,
  userId: number,
  chatId: number,
): Promise<OpenLineDialog | null> {
  let dialog: OpenLineDialog | null = null;
  for (let attempt = 1; attempt <= OPENLINE_DEAL_WAIT_ATTEMPTS; attempt++) {
    dialog = await resolveOpenLineDialog(messenger, userId, chatId);
    if (dialog?.dealId || dialog?.leadId) return dialog;
    if (attempt < OPENLINE_DEAL_WAIT_ATTEMPTS) {
      console.log(
        `[bitrix] сделка трекера Открытой линии ещё не создана (попытка ${attempt}/${OPENLINE_DEAL_WAIT_ATTEMPTS}) — ждём ${OPENLINE_DEAL_WAIT_DELAY_MS}мс`,
      );
      await sleep(OPENLINE_DEAL_WAIT_DELAY_MS);
    }
  }
  return dialog;
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

  // Бот дублирует переписку в Открытую линию (sendMessageToOpenLine), и её
  // CRM-трекер сам заводит контакт+сделку по первому сообщению чата. Чтобы не
  // плодить вторую сделку, дожидаемся (с коротким ретраем), что линия создала
  // по этому диалогу, — и обновляем её сущности вместо создания новых.
  const dialog =
    data.chatId && data.telegramUserId
      ? await waitForOpenLineDialog(messenger, data.telegramUserId, data.chatId)
      : null;
  if (dialog && !dialog.dealId && !dialog.leadId) {
    console.warn(
      `[bitrix] трекер Открытой линии так и не создал сделку по чату ${dialog.chatId} — создаём собственную`,
    );
  }
  if (dialog?.leadId) {
    console.warn(
      `[bitrix] по чату уже создан лид id=${dialog.leadId} (Открытая линия работает в классическом режиме CRM) — возможен дубль с создаваемой сделкой`,
    );
  }

  let contactId = dialog?.contactId ?? null;
  if (contactId) {
    // Контакт трекера линии — «пустышка» с именем из мессенджера: дополняем
    // его собранными ботом данными (телефон, email, согласие, профиль).
    console.log(
      `[bitrix] используем контакт Открытой линии id=${contactId} (phone=${data.phone}${data.email ? ` email=${data.email}` : ""})`,
    );
    try {
      await bitrixPost(
        "crm.contact.update",
        { id: contactId, fields: buildContactFields(data) },
        messenger,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[bitrix] не удалось обновить контакт Открытой линии ${contactId}: ${message}`,
      );
    }
  } else {
    contactId = await findExistingContactId(data);
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
  }

  let dealId = 0;
  if (dialog?.dealId) {
    // Сделку уже создал трекер Открытой линии — наполняем её данными бота
    // вместо создания дубля. При сбое обновления (сделку могли удалить)
    // откатываемся на прежнее поведение — создаём новую.
    try {
      await bitrixPost(
        "crm.deal.update",
        { id: dialog.dealId, fields: buildDealFields(data, contactId) },
        messenger,
      );
      dealId = dialog.dealId;
      console.log(
        `[bitrix] обновлена сделка Открытой линии id=${dealId} contact=${contactId} name=${data.name} phone=${data.phone}${data.email ? ` email=${data.email}` : ""}${data.source ? ` source=${data.source}` : ""}${data.campaign ? ` campaign=${data.campaign}` : ""} bot=${getBotId(messenger)}`,
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[bitrix] не удалось обновить сделку Открытой линии ${dialog.dealId}, создаём новую: ${message}`,
      );
    }
  }
  if (!dealId) {
    dealId = await bitrixPost<number>(
      "crm.deal.add",
      {
        fields: buildDealFields(data, contactId),
      },
      messenger,
    );
    console.log(
      `[bitrix] сделка создана id=${dealId} contact=${contactId} name=${data.name} phone=${data.phone}${data.email ? ` email=${data.email}` : ""}${data.source ? ` source=${data.source}` : ""}${data.campaign ? ` campaign=${data.campaign}` : ""} bot=${getBotId(messenger)}`,
    );
  }

  await linkBitrixTrace(messenger, contactId, dealId, data);

  // Привязка чата к контакту нужна, только если контакт не от трекера линии
  // (свой чат трекер привязывает сам при создании).
  if (dialog && dialog.contactId !== contactId) {
    try {
      await bitrixPost(
        "imopenlines.crm.chat.user.add",
        {
          CRM_ENTITY_TYPE: "contact",
          CRM_ENTITY: contactId,
          USER_ID: 0,
          CHAT_ID: dialog.chatId,
        },
        messenger,
      );
      console.log(
        `[bitrix] чат ${dialog.chatId} привязан к контакту ${contactId}`,
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
  /** Собственный ID сообщения во внешней системе (Telegram message_id) —
   * делает внешний ID сообщения в Bitrix детерминированным, чтобы потом
   * адресно обновить его через updateMessageInOpenLine (правка сообщения
   * в Telegram). Без него используется текущее время — обновить такое
   * сообщение позже уже нельзя. */
  messageId?: number;
  /** Вложения (фото/документ/голосовое) — прямая ссылка и имя файла. */
  files?: { url: string; name: string }[];
}

function buildExternalMessageId(
  data: Pick<OpenLineMessageData, "messenger" | "userId" | "messageId">,
): string {
  return data.messageId != null
    ? `${data.messenger}-${data.userId}-${data.messageId}`
    : `${data.messenger}-${data.userId}-${Date.now()}`;
}

/**
 * Дублирует сообщение клиента в Открытую линию Bitrix24 через
 * imconnector.send.messages — так оператор видит переписку из бота и
 * может ответить прямо в Открытой линии. Ответ оператора прилетает
 * обратным вебхуком (событие ONIMCONNECTORMESSAGEADD) — см.
 * apps/bitrix-webhook, который пересылает его через sendMessengerMessage.
 *
 * Требует OAuth-клиент (см. BitrixApiLike) — вызывающая сторона резолвит
 * его через `resolveBitrixApi(memberId)` из `@psi-opora/bitrix-client`.
 * CONNECTOR/LINE берутся из bot_connectors (packages/db) — заполняется
 * автоматически при активации канала бота в Контакт-центре (см.
 * packages/api/src/routers/bot-connector), а не из .env. Без `api` или
 * без записи в БД тихо пропускаем (канал ещё не активирован — не
 * критично для остальной работы бота).
 */
export async function sendMessageToOpenLine(
  api: BitrixApiLike | undefined,
  data: OpenLineMessageData,
): Promise<void> {
  if (!api) return;
  const config = await getBotConnector(data.messenger);
  if (!config) return;

  const name = sanitizeOpenLineName(data.name);

  try {
    await api.call("imconnector.send.messages", {
      CONNECTOR: config.connectorId,
      LINE: Number(config.openLineId),
      MESSAGES: [
        {
          user: {
            id: String(data.userId),
            ...(name ? { name } : {}),
            skip_phone_validate: "Y",
          },
          message: {
            id: buildExternalMessageId(data),
            date: Math.floor(Date.now() / 1000),
            text: data.text,
            ...(data.files?.length ? { files: data.files } : {}),
          },
          chat: {
            id: String(data.chatId),
            name: data.name || `${data.messenger} #${data.userId}`,
          },
        },
      ],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[bitrix] не удалось переслать сообщение в Открытую линию: ${message}`,
    );
  }
}

/**
 * Пересылает правку уже отправленного сообщения (Telegram edited_message)
 * в Открытую линию через imconnector.update.messages — находит нужное
 * сообщение по тому же внешнему ID, что был использован при исходной
 * отправке (см. buildExternalMessageId), поэтому messageId здесь обязателен:
 * без него нечего обновлять — id совпадёт лишь случайно.
 */
export async function updateMessageInOpenLine(
  api: BitrixApiLike | undefined,
  data: OpenLineMessageData & { messageId: number },
): Promise<void> {
  if (!api) return;
  const config = await getBotConnector(data.messenger);
  if (!config) return;

  const name = sanitizeOpenLineName(data.name);

  try {
    await api.call("imconnector.update.messages", {
      CONNECTOR: config.connectorId,
      LINE: Number(config.openLineId),
      MESSAGES: [
        {
          user: {
            id: String(data.userId),
            ...(name ? { name } : {}),
            skip_phone_validate: "Y",
          },
          message: {
            id: buildExternalMessageId(data),
            date: Math.floor(Date.now() / 1000),
            text: data.text,
          },
          chat: {
            id: String(data.chatId),
            name: data.name || `${data.messenger} #${data.userId}`,
          },
        },
      ],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[bitrix] не удалось переслать правку сообщения в Открытую линию: ${message}`,
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

// Регистрация коннектора (imconnector.register) и активация линии теперь
// происходят нативно — кнопка в дашборде (apps/dashboard/.../bot-connector-card.tsx,
// b24.callMethod, гарантированный app context) и виджет настроек канала
// (packages/api/src/routers/bot-connector), а не серверный вызов отсюда.
