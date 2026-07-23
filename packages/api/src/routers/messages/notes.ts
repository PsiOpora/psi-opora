import {
  addClientNote,
  deleteClientNote,
  listClientNotes,
} from "@psi-opora/db/queries";
import { publicProcedure } from "../../orpc";
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

/** Внутренние заметки по диалогу — клиенту не отправляются. */
export const notes = publicProcedure
  .input(clientThreadSchema)
  .handler(async ({ input }): Promise<{ notes: ClientNoteItem[] }> => {
    const rows = await listClientNotes(input.messenger, input.userId);
    return { notes: rows.map(toItem) };
  });

export const addNote = publicProcedure
  .input(addClientNoteSchema)
  .handler(async ({ input }): Promise<{ note: ClientNoteItem | null }> => {
    const row = await addClientNote({
      messenger: input.messenger,
      userId: input.userId,
      text: input.text,
      operatorId: input.operatorId,
      operatorName: input.operatorName,
    });
    return { note: row ? toItem(row) : null };
  });

export const deleteNote = publicProcedure
  .input(deleteClientNoteSchema)
  .handler(async ({ input }): Promise<{ ok: true }> => {
    await deleteClientNote(input.noteId);
    return { ok: true };
  });
