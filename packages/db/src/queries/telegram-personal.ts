import { and, eq } from "drizzle-orm";
import { db } from "../client";
import { telegramPersonalAccounts } from "../schema/telegram-personal";

export type TelegramPersonalAccount =
  typeof telegramPersonalAccounts.$inferSelect;

/**
 * "connected" — обычное состояние строки. "error" — воркер (apps/tg-userbot-worker)
 * не смог поднять клиент или обнаружил, что сессия отозвана/недействительна
 * (см. markTelegramPersonalAccountError). Промежуточные шаги логина в эту
 * таблицу не попадают — см. комментарий у колонки status в schema/telegram-personal.
 */
export type TelegramPersonalAccountStatus = "connected" | "error";

/** Все подключённые номера портала — для карточки в настройках. */
export async function listTelegramPersonalAccounts(
  memberId: string,
): Promise<TelegramPersonalAccount[]> {
  if (!db) return [];
  return db
    .select()
    .from(telegramPersonalAccounts)
    .where(eq(telegramPersonalAccounts.memberId, memberId));
}

/** Все подключённые номера всех порталов — воркер (apps/tg-userbot-worker)
 * поднимает по живому MTProto-клиенту на каждую строку при старте. */
export async function listConnectedTelegramPersonalAccounts(): Promise<
  TelegramPersonalAccount[]
> {
  if (!db) return [];
  return db
    .select()
    .from(telegramPersonalAccounts)
    .where(
      eq(
        telegramPersonalAccounts.status,
        "connected" satisfies TelegramPersonalAccountStatus,
      ),
    );
}

export async function getTelegramPersonalAccount(
  memberId: string,
  openLineId: string,
): Promise<TelegramPersonalAccount | null> {
  if (!db) return null;
  const [row] = await db
    .select()
    .from(telegramPersonalAccounts)
    .where(
      and(
        eq(telegramPersonalAccounts.memberId, memberId),
        eq(telegramPersonalAccounts.openLineId, openLineId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Ищет аккаунт по одной только линии, без memberId — используется
 * apps/bitrix-webhook, у которого нет OAuth-сессии портала (только общий
 * BITRIX_WEBHOOK_TOKEN), чтобы понять, какому личному номеру и порталу
 * адресован ответ оператора (ONIMCONNECTORMESSAGEADD → data.LINE).
 */
export async function getTelegramPersonalAccountByLine(
  openLineId: string,
): Promise<TelegramPersonalAccount | null> {
  if (!db) return null;
  const [row] = await db
    .select()
    .from(telegramPersonalAccounts)
    .where(eq(telegramPersonalAccounts.openLineId, openLineId))
    .limit(1);
  return row ?? null;
}

/**
 * Заводит/обновляет запись об успешно подключённом номере. Промежуточное
 * состояние логина (код/пароль ещё не подтверждены) в БД не хранится —
 * оно живёт только в Redis (см. packages/api/src/routers/telegram-personal),
 * пока не станет финальной сессией.
 */
export async function upsertTelegramPersonalAccountConnected(data: {
  memberId: string;
  openLineId: string;
  connectorId: string;
  phone: string;
  apiId: string;
  apiHashEncrypted: string;
  sessionEncrypted: string;
}): Promise<void> {
  if (!db) return;
  await db
    .insert(telegramPersonalAccounts)
    .values({
      id: crypto.randomUUID(),
      ...data,
      status: "connected" satisfies TelegramPersonalAccountStatus,
      lastError: null,
    })
    .onConflictDoUpdate({
      target: [
        telegramPersonalAccounts.memberId,
        telegramPersonalAccounts.openLineId,
      ],
      set: {
        connectorId: data.connectorId,
        phone: data.phone,
        apiId: data.apiId,
        apiHashEncrypted: data.apiHashEncrypted,
        sessionEncrypted: data.sessionEncrypted,
        status: "connected" satisfies TelegramPersonalAccountStatus,
        lastError: null,
        updatedAt: new Date(),
      },
    });
}

export async function markTelegramPersonalAccountError(
  memberId: string,
  openLineId: string,
  error: string,
): Promise<void> {
  if (!db) return;
  await db
    .update(telegramPersonalAccounts)
    .set({
      status: "error" satisfies TelegramPersonalAccountStatus,
      lastError: error,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(telegramPersonalAccounts.memberId, memberId),
        eq(telegramPersonalAccounts.openLineId, openLineId),
      ),
    );
}

export async function removeTelegramPersonalAccount(
  memberId: string,
  openLineId: string,
): Promise<void> {
  if (!db) return;
  await db
    .delete(telegramPersonalAccounts)
    .where(
      and(
        eq(telegramPersonalAccounts.memberId, memberId),
        eq(telegramPersonalAccounts.openLineId, openLineId),
      ),
    );
}
