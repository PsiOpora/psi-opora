import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../client.types";
import { clientNotes } from "../schema/client-notes";

export type ClientNote = typeof clientNotes.$inferSelect;

export interface NewClientNoteEntry {
  messenger: string;
  userId: string;
  text: string;
  operatorId?: string;
  operatorName?: string;
}

/** Заметки по диалогу, свежие первыми. */
export async function listClientNotes(
  db: Database,
  messenger: string,
  userId: string,
): Promise<ClientNote[]> {
  if (!db) return [];
  return db
    .select()
    .from(clientNotes)
    .where(
      and(eq(clientNotes.messenger, messenger), eq(clientNotes.userId, userId)),
    )
    .orderBy(desc(clientNotes.createdAt));
}

export async function addClientNote(
  db: Database,
  entry: NewClientNoteEntry,
): Promise<ClientNote | null> {
  if (!db) return null;
  const [row] = await db
    .insert(clientNotes)
    .values({
      id: crypto.randomUUID(),
      messenger: entry.messenger,
      userId: entry.userId,
      text: entry.text,
      operatorId: entry.operatorId,
      operatorName: entry.operatorName,
      createdAt: new Date(),
    })
    .returning();
  return row ?? null;
}

export async function deleteClientNote(
  db: Database,
  noteId: string,
): Promise<void> {
  if (!db) return;
  await db.delete(clientNotes).where(eq(clientNotes.id, noteId));
}
