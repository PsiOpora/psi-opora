import { and, eq } from "drizzle-orm";
import { db } from "../client";
import { whatsappPersonalAccounts } from "../schema/whatsapp-personal";

export type WhatsappPersonalAccount =
  typeof whatsappPersonalAccounts.$inferSelect;

/**
 * "connected" — обычное состояние строки. "error" — WAHA сообщила, что
 * сессия развалилась (FAILED/логаут с телефона), см. markWhatsappPersonalAccountError.
 * Промежуточные шаги логина в эту таблицу не попадают — см. комментарий
 * у колонки status в schema/whatsapp-personal.
 */
export type WhatsappPersonalAccountStatus = "connected" | "error";

/** Все подключённые номера портала — для карточки в настройках. */
export async function listWhatsappPersonalAccounts(
  memberId: string,
): Promise<WhatsappPersonalAccount[]> {
  if (!db) return [];
  return db
    .select()
    .from(whatsappPersonalAccounts)
    .where(eq(whatsappPersonalAccounts.memberId, memberId));
}

export async function getWhatsappPersonalAccount(
  memberId: string,
  openLineId: string,
): Promise<WhatsappPersonalAccount | null> {
  if (!db) return null;
  const [row] = await db
    .select()
    .from(whatsappPersonalAccounts)
    .where(
      and(
        eq(whatsappPersonalAccounts.memberId, memberId),
        eq(whatsappPersonalAccounts.openLineId, openLineId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Ищет аккаунт по коннектору и линии, без memberId — используется
 * apps/bitrix-webhook (у него нет OAuth-сессии портала), чтобы понять,
 * какому номеру адресован ответ оператора (ONIMCONNECTORMESSAGEADD →
 * data.CONNECTOR/LINE). Линия нужна и на "старых" записях, где несколько
 * номеров портала ещё делят один статический connectorId (см. миграцию на
 * тройной unique) — без неё поиск по одному connectorId был бы неоднозначным.
 */
export async function getWhatsappPersonalAccountByConnector(
  connectorId: string,
  openLineId: string,
): Promise<WhatsappPersonalAccount | null> {
  if (!db) return null;
  const [row] = await db
    .select()
    .from(whatsappPersonalAccounts)
    .where(
      and(
        eq(whatsappPersonalAccounts.connectorId, connectorId),
        eq(whatsappPersonalAccounts.openLineId, openLineId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Ищет аккаунт по имени WAHA-сессии — вебхук входящих сообщений
 * (apps/bitrix-webhook/api/waha-webhook) получает от WAHA только `session`.
 */
export async function getWhatsappPersonalAccountBySession(
  sessionName: string,
): Promise<WhatsappPersonalAccount | null> {
  if (!db) return null;
  const [row] = await db
    .select()
    .from(whatsappPersonalAccounts)
    .where(eq(whatsappPersonalAccounts.sessionName, sessionName))
    .limit(1);
  return row ?? null;
}

/** Заводит/обновляет запись об успешно подключённом номере (WAHA-сессия
 * дошла до статуса WORKING, см. pollStatus в routers/whatsapp-personal). */
export async function upsertWhatsappPersonalAccountConnected(data: {
  memberId: string;
  openLineId: string;
  connectorId: string;
  phone: string;
  sessionName: string;
}): Promise<void> {
  if (!db) return;
  await db
    .insert(whatsappPersonalAccounts)
    .values({
      id: crypto.randomUUID(),
      ...data,
      status: "connected" satisfies WhatsappPersonalAccountStatus,
      lastError: null,
    })
    .onConflictDoUpdate({
      target: [
        whatsappPersonalAccounts.memberId,
        whatsappPersonalAccounts.openLineId,
        whatsappPersonalAccounts.connectorId,
      ],
      set: {
        connectorId: data.connectorId,
        phone: data.phone,
        sessionName: data.sessionName,
        status: "connected" satisfies WhatsappPersonalAccountStatus,
        lastError: null,
        updatedAt: new Date(),
      },
    });
}

export async function markWhatsappPersonalAccountError(
  memberId: string,
  openLineId: string,
  connectorId: string,
  error: string,
): Promise<void> {
  if (!db) return;
  await db
    .update(whatsappPersonalAccounts)
    .set({
      status: "error" satisfies WhatsappPersonalAccountStatus,
      lastError: error,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(whatsappPersonalAccounts.memberId, memberId),
        eq(whatsappPersonalAccounts.openLineId, openLineId),
        eq(whatsappPersonalAccounts.connectorId, connectorId),
      ),
    );
}

export async function removeWhatsappPersonalAccount(
  memberId: string,
  openLineId: string,
  connectorId: string,
): Promise<void> {
  if (!db) return;
  await db
    .delete(whatsappPersonalAccounts)
    .where(
      and(
        eq(whatsappPersonalAccounts.memberId, memberId),
        eq(whatsappPersonalAccounts.openLineId, openLineId),
        eq(whatsappPersonalAccounts.connectorId, connectorId),
      ),
    );
}
