import { setConversationTags } from "@psi-opora/db/queries";
import { publicProcedure } from "../../orpc";
import { setConversationTagsSchema } from "../../schemas/messages";

/** Полностью заменяет теги диалога (пустой массив — снять все). */
export const setTags = publicProcedure
  .input(setConversationTagsSchema)
  .handler(async ({ input }): Promise<{ ok: true }> => {
    // Дубликаты убираем на сервере, чтобы фильтры по тегам не «двоились».
    const unique = [
      ...new Set(input.tags.map((t) => t.trim()).filter(Boolean)),
    ];
    await setConversationTags(input.messenger, input.userId, unique);
    return { ok: true };
  });
