import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../client.types";
import { botUsers } from "../schema/bot-users";

export type BotUser = typeof botUsers.$inferSelect;
export type NewBotUser = typeof botUsers.$inferInsert;

export interface BotUserProfileEntry {
  messenger: string;
  userId: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  username?: string;
  languageCode?: string;
  isPremium?: boolean;
  isBot?: boolean;
  bio?: string;
  avatarUrl?: string;
  photoFileId?: string;
  avatarS3Key?: string;
  source?: string;
  campaign?: string;
  rawProfile?: unknown;
}

function makeId(messenger: string, userId: string): string {
  return `${messenger}:${userId}`;
}

/**
 * Сохраняет/обновляет профиль клиента бота. При повторном обращении
 * новые непустые поля перезаписывают старые, а поля, не пришедшие в этот
 * раз (undefined), сохраняют прежнее значение — так профиль постепенно
 * дополняется данными из разных источников (апдейт, getChat, форма).
 */
export async function upsertBotUser(
  db: Database,
  entry: BotUserProfileEntry,
): Promise<void> {
  if (!db) return;

  const id = makeId(entry.messenger, entry.userId);
  const values: NewBotUser = {
    id,
    messenger: entry.messenger,
    userId: entry.userId,
    firstName: entry.firstName,
    lastName: entry.lastName,
    name: entry.name,
    username: entry.username,
    languageCode: entry.languageCode,
    isPremium: entry.isPremium,
    isBot: entry.isBot,
    bio: entry.bio,
    avatarUrl: entry.avatarUrl,
    photoFileId: entry.photoFileId,
    avatarS3Key: entry.avatarS3Key,
    source: entry.source,
    campaign: entry.campaign,
    rawProfile: entry.rawProfile,
  };

  await db
    .insert(botUsers)
    .values(values)
    .onConflictDoUpdate({
      target: botUsers.id,
      set: {
        firstName: sql`coalesce(${values.firstName ?? null}, ${botUsers.firstName})`,
        lastName: sql`coalesce(${values.lastName ?? null}, ${botUsers.lastName})`,
        name: sql`coalesce(${values.name ?? null}, ${botUsers.name})`,
        username: sql`coalesce(${values.username ?? null}, ${botUsers.username})`,
        languageCode: sql`coalesce(${values.languageCode ?? null}, ${botUsers.languageCode})`,
        isPremium: sql`coalesce(${values.isPremium ?? null}, ${botUsers.isPremium})`,
        isBot: sql`coalesce(${values.isBot ?? null}, ${botUsers.isBot})`,
        bio: sql`coalesce(${values.bio ?? null}, ${botUsers.bio})`,
        avatarUrl: sql`coalesce(${values.avatarUrl ?? null}, ${botUsers.avatarUrl})`,
        photoFileId: sql`coalesce(${values.photoFileId ?? null}, ${botUsers.photoFileId})`,
        avatarS3Key: sql`coalesce(${values.avatarS3Key ?? null}, ${botUsers.avatarS3Key})`,
        source: sql`coalesce(${botUsers.source}, ${values.source ?? null})`,
        campaign: sql`coalesce(${botUsers.campaign}, ${values.campaign ?? null})`,
        rawProfile: sql`coalesce(${values.rawProfile ?? null}, ${botUsers.rawProfile})`,
        lastSeenAt: sql`now()`,
        updatedAt: sql`now()`,
      },
    });
}

/** Профиль клиента по мессенджеру и его user_id — для обогащения карточки CRM. */
export async function getBotUserProfile(
  db: Database,
  messenger: string,
  userId: string,
): Promise<BotUser | null> {
  if (!db) return null;
  const [row] = await db
    .select()
    .from(botUsers)
    .where(and(eq(botUsers.messenger, messenger), eq(botUsers.userId, userId)))
    .limit(1);
  return row ?? null;
}
