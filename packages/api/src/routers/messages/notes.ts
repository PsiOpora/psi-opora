import {
  addClientNote,
  deleteClientNote,
  listClientNotesForGroup,
  listGroupIdentities,
  resolveCanonicalIdentity,
} from "@psi-opora/db/queries";
import { bitrixProcedure } from "../../orpc";
import {
  addClientNoteSchema,
  clientThreadSchema,
  deleteClientNoteSchema,
} from "../../schemas/messages";
import type { ClientNoteItem } from "./types";

function toItem(row: {
  id: string;
  text: string;
  operatorId: string | null;
  operatorName: string | null;
  createdAt: Date;
}): ClientNoteItem {
  return {
    id: row.id,
    text: row.text,
    operatorId: row.operatorId,
    operatorName: row.operatorName,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Внутренние заметки по диалогу — клиенту не отправляются. Если канал
 * объединён с другими (см. merge.ts), показывает заметки всей группы, чтобы
 * записи, оставленные до слияния, не терялись из вида. */
export const notes = bitrixProcedure
  .input(clientThreadSchema)
  .handler(async ({ input }): Promise<{ notes: ClientNoteItem[] }> => {
    const identities = await listGroupIdentities(input.messenger, input.userId);
    const rows = await listClientNotesForGroup(identities);
    return { notes: rows.map(toItem) };
  });

/** Новые заметки всегда пишутся на канонического клиента — так они не
 * расходятся по каналам, даже если оператор открыл диалог по устаревшей
 * ссылке на уже объединённую secondary-identity. */
export const addNote = bitrixProcedure
  .input(addClientNoteSchema)
  .handler(async ({ input }): Promise<{ note: ClientNoteItem | null }> => {
    const primary = await resolveCanonicalIdentity(
      input.messenger,
      input.userId,
    );
    const row = await addClientNote({
      messenger: primary.messenger,
      userId: primary.userId,
      text: input.text,
      operatorId: input.operatorId,
      operatorName: input.operatorName,
    });
    return { note: row ? toItem(row) : null };
  });

export const deleteNote = bitrixProcedure
  .input(deleteClientNoteSchema)
  .handler(async ({ input }): Promise<{ ok: true }> => {
    await deleteClientNote(input.noteId);
    return { ok: true };
  });
