import { and, eq } from "drizzle-orm";
import { db } from "../client";
import { telegramPersonalAccounts } from "../schema/telegram-personal";

export type TelegramPersonalAccount =
  typeof telegramPersonalAccounts.$inferSelect;

export type TelegramPersonalAccountStatus =
  | "pending_code"
  | "pending_password"
  | "connected"
  | "disconnected"
  | "error";

/** Все подключённые (или в процессе подключения) номера портала — для карточки в настройках. */
export async function listTelegramPersonalAccounts(
  memberId: string,
): Promise<TelegramPersonalAccount[]> {
  if (!db) return [];
  return db
    .select()
    .from(telegramPersonalAccounts)
    .where(eq(telegramPersonalAccounts.memberId, memberId));
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
        sessionEncrypted: data.sessionEncrypted,
        status: "connected" satisfies TelegramPersonalAccountStatus,
        lastError: null,
        updatedAt: new Date(),
      },
    });
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
