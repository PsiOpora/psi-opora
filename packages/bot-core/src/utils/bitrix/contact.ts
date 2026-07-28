import { bitrixPost, getSourceId } from "./client";
import type { ContactData } from "./types";

// Привязка мессенджера в карточке контакта — мультиполе IM с типом OPENLINE
// и значением `imol|{connector}|{line}|{chat_id}|{внутренний id чата Bitrix}`
// (пример: imol|psiopora_max_bot|6|358982080|430) — тот же формат, которым
// Bitrix помечает контакты, созданные трекером Открытой линии. Последний
// сегмент — внутренний id чата, известный только после resolveOpenLineDialog,
// поэтому готовое значение собирается там (OpenLineDialog.imol). Без диалога
// оставляем голый ID пользователя как справочную запись.
// `imol === null` — привязку не добавлять вовсе (контакт создан трекером
// линии: Bitrix уже проставил IM сам, повторная передача без ID мультиполя
// добавила бы дублирующую строку).
export function buildMessengerLinkFields(data: ContactData, imol?: string | null) {
  if (imol === null) return null;
  if (imol) {
    return { IM: [{ VALUE: imol, VALUE_TYPE: "OPENLINE" }] };
  }
  if (!data.telegramUserId) return null;
  const messenger = data.messenger ?? "telegram";
  return {
    IM: [
      {
        VALUE: String(data.telegramUserId),
        VALUE_TYPE: messenger,
      },
    ],
  };
}

/**
 * Собирает доп. данные профиля мессенджера (username, язык, bio) в
 * читаемый комментарий для карточки контакта — Bitrix не заводит под них
 * отдельных полей, поэтому это просто текстовая справка для оператора.
 */
function buildProfileComment(data: ContactData): string | undefined {
  const lines = [
    data.username && `Username: @${data.username}`,
    data.languageCode && `Язык интерфейса: ${data.languageCode}`,
    data.isPremium && "Telegram Premium: да",
    data.bio && `О себе: ${data.bio}`,
  ].filter(Boolean);
  return lines.length ? `Профиль в мессенджере:\n${lines.join("\n")}` : undefined;
}

export function buildContactFields(data: ContactData, imol?: string | null) {
  const messenger = data.messenger ?? "telegram";
  const profileComment = buildProfileComment(data);
  return {
    NAME: data.name,
    ...(data.phone ? { PHONE: [{ VALUE: data.phone, VALUE_TYPE: "WORK" }] } : {}),
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
    ...(buildMessengerLinkFields(data, imol) ?? {}),
  };
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
 * по телефону и email, — чтобы не плодить дубликаты для одного и того же
 * человека. (Контакт, привязанный к чату мессенджера, находится раньше —
 * через диалог Открытой линии, см. resolveOpenLineDialog.)
 * Ошибки поиска не пробрасываются: при сбое просто создаём новый контакт,
 * как раньше.
 */
export async function findExistingContactId(
  data: ContactData,
): Promise<number | null> {
  const messenger = data.messenger ?? "telegram";
  try {
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
