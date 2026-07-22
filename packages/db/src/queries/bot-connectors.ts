import { eq } from "drizzle-orm";
import type { Database } from "../client.types";
import { botConnectors } from "../schema/bot-connectors";

export type BotConnector = typeof botConnectors.$inferSelect;

export async function getBotConnector(
  db: Database,
  messenger: string,
): Promise<BotConnector | null> {
  if (!db) return null;
  const [row] = await db
    .select()
    .from(botConnectors)
    .where(eq(botConnectors.messenger, messenger))
    .limit(1);
  return row ?? null;
}

export async function upsertBotConnector(
  db: Database,
  data: {
    messenger: string;
    memberId: string;
    openLineId: string;
    connectorId: string;
    /** Не передавайте, если токен не менялся — иначе затрёте уже сохранённый. */
    botTokenEncrypted?: string;
  },
): Promise<void> {
  if (!db) return;
  await db
    .insert(botConnectors)
    .values(data)
    .onConflictDoUpdate({
      target: botConnectors.messenger,
      set: {
        memberId: data.memberId,
        openLineId: data.openLineId,
        connectorId: data.connectorId,
        ...(data.botTokenEncrypted !== undefined
          ? { botTokenEncrypted: data.botTokenEncrypted }
          : {}),
        updatedAt: new Date(),
      },
    });
}

export async function markBotConnectorWebhookConfigured(
  db: Database,
  messenger: string,
): Promise<void> {
  if (!db) return;
  await db
    .update(botConnectors)
    .set({ webhookConfiguredAt: new Date(), updatedAt: new Date() })
    .where(eq(botConnectors.messenger, messenger));
}

export async function removeBotConnector(
  db: Database,
  messenger: string,
): Promise<void> {
  if (!db) return;
  await db.delete(botConnectors).where(eq(botConnectors.messenger, messenger));
}
