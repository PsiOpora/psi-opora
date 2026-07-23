import {
  deleteQuickReply as deleteQuickReplyQuery,
  listQuickReplies,
  saveQuickReply as saveQuickReplyQuery,
} from "@psi-opora/db/queries";
import { publicProcedure } from "../../orpc";
import {
  deleteQuickReplySchema,
  saveQuickReplySchema,
} from "../../schemas/messages";
import type { QuickReplyItem } from "./types";

function toItem(row: {
  id: string;
  title: string;
  text: string;
}): QuickReplyItem {
  return { id: row.id, title: row.title, text: row.text };
}

/** Быстрые ответы (шаблоны) — общие на всю команду. */
export const quickReplies = publicProcedure.handler(
  async (): Promise<{ items: QuickReplyItem[] }> => {
    const rows = await listQuickReplies();
    return { items: rows.map(toItem) };
  },
);

export const saveQuickReply = publicProcedure
  .input(saveQuickReplySchema)
  .handler(async ({ input }): Promise<{ item: QuickReplyItem | null }> => {
    const row = await saveQuickReplyQuery({
      id: input.id,
      title: input.title,
      text: input.text,
    });
    return { item: row ? toItem(row) : null };
  });

export const deleteQuickReply = publicProcedure
  .input(deleteQuickReplySchema)
  .handler(async ({ input }): Promise<{ ok: true }> => {
    await deleteQuickReplyQuery(input.id);
    return { ok: true };
  });
