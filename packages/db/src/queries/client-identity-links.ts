import { and, eq } from "drizzle-orm";
import type { Database } from "../client.types";
import { clientIdentityLinks } from "../schema/client-identity-links";

export type ClientIdentityLink = typeof clientIdentityLinks.$inferSelect;

export interface ClientIdentity {
  messenger: string;
  userId: string;
}

function makeId(messenger: string, userId: string): string {
  return `${messenger}:${userId}`;
}

function sameIdentity(a: ClientIdentity, b: ClientIdentity): boolean {
  return a.messenger === b.messenger && a.userId === b.userId;
}

/** Если identity уже поглощена другой (secondary в связке) — возвращает её primary, иначе саму identity. */
export async function resolveCanonicalIdentity(
  db: Database,
  messenger: string,
  userId: string,
): Promise<ClientIdentity> {
  if (!db) return { messenger, userId };
  const [row] = await db
    .select({
      primaryMessenger: clientIdentityLinks.primaryMessenger,
      primaryUserId: clientIdentityLinks.primaryUserId,
    })
    .from(clientIdentityLinks)
    .where(eq(clientIdentityLinks.id, makeId(messenger, userId)))
    .limit(1);
  if (!row) return { messenger, userId };
  return { messenger: row.primaryMessenger, userId: row.primaryUserId };
}

/** Все identity, схлопнутые в этого клиента: канонический (первым) + все поглощённые. */
export async function listGroupIdentities(
  db: Database,
  messenger: string,
  userId: string,
): Promise<ClientIdentity[]> {
  if (!db) return [{ messenger, userId }];
  const primary = await resolveCanonicalIdentity(db, messenger, userId);
  const secondaries = await db
    .select({
      messenger: clientIdentityLinks.messenger,
      userId: clientIdentityLinks.userId,
    })
    .from(clientIdentityLinks)
    .where(
      and(
        eq(clientIdentityLinks.primaryMessenger, primary.messenger),
        eq(clientIdentityLinks.primaryUserId, primary.userId),
      ),
    );
  return [primary, ...secondaries];
}

export interface MergeClientIdentitiesEntry {
  messenger: string;
  userId: string;
  intoMessenger: string;
  intoUserId: string;
  operatorId?: string;
  operatorName?: string;
}

/**
 * Мёржит identity (messenger,userId) в канал (intoMessenger,intoUserId) —
 * второй становится/остаётся каноническим (primary). Если у цели уже есть
 * свой primary (её саму уже с кем-то объединили), поглощаемая identity
 * подвешивается под этот истинный root, а не под промежуточное звено —
 * так primary никогда сама не оказывается чьей-то secondary (инвариант,
 * на который опирается resolveCanonicalIdentity: один шаг резолвинга).
 */
export async function mergeClientIdentities(
  db: Database,
  entry: MergeClientIdentitiesEntry,
): Promise<ClientIdentity> {
  const source: ClientIdentity = {
    messenger: entry.messenger,
    userId: entry.userId,
  };
  const target: ClientIdentity = {
    messenger: entry.intoMessenger,
    userId: entry.intoUserId,
  };

  if (sameIdentity(source, target)) {
    throw new Error("Нельзя объединить клиента с самим собой");
  }
  if (!db) return target;

  const root = await resolveCanonicalIdentity(
    db,
    target.messenger,
    target.userId,
  );

  if (sameIdentity(root, source)) {
    throw new Error(
      "Этот канал уже объединён с выбранным клиентом — сначала расцепите его",
    );
  }

  const id = makeId(source.messenger, source.userId);
  await db
    .insert(clientIdentityLinks)
    .values({
      id,
      messenger: source.messenger,
      userId: source.userId,
      primaryMessenger: root.messenger,
      primaryUserId: root.userId,
      mergedByOperatorId: entry.operatorId,
      mergedByOperatorName: entry.operatorName,
    })
    .onConflictDoUpdate({
      target: clientIdentityLinks.id,
      set: {
        primaryMessenger: root.messenger,
        primaryUserId: root.userId,
        mergedByOperatorId: entry.operatorId,
        mergedByOperatorName: entry.operatorName,
        createdAt: new Date(),
      },
    });

  // Поглощаемая identity могла сама быть primary для кого-то — переподвешиваем
  // её secondary под новый root, чтобы объединять целые группы одним действием.
  await db
    .update(clientIdentityLinks)
    .set({ primaryMessenger: root.messenger, primaryUserId: root.userId })
    .where(
      and(
        eq(clientIdentityLinks.primaryMessenger, source.messenger),
        eq(clientIdentityLinks.primaryUserId, source.userId),
      ),
    );

  return root;
}

/** Расцепляет канал — он снова становится независимым клиентом. */
export async function unmergeClientIdentity(
  db: Database,
  messenger: string,
  userId: string,
): Promise<void> {
  if (!db) return;
  await db
    .delete(clientIdentityLinks)
    .where(eq(clientIdentityLinks.id, makeId(messenger, userId)));
}

/** Вся таблица связей одним запросом — для схлопывания списка клиентов (таблица маленькая). */
export async function listAllIdentityLinks(
  db: Database,
): Promise<ClientIdentityLink[]> {
  if (!db) return [];
  return db.select().from(clientIdentityLinks);
}
