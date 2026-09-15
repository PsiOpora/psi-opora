import {
	resolveCanonicalIdentity,
	setConversationTags,
} from "@psi-opora/db/queries";
import { bitrixProcedure } from "../../orpc";
import { setConversationTagsSchema } from "../../schemas/messages";

/** Полностью заменяет теги диалога (пустой массив — снять все). Пишет всегда
 * на канонического клиента (см. merge.ts) — защита от устаревшей ссылки на
 * уже объединённую secondary-identity. */
export const setTags = bitrixProcedure
	.input(setConversationTagsSchema)
	.handler(async ({ input }): Promise<{ ok: true }> => {
		// Дубликаты убираем на сервере, чтобы фильтры по тегам не «двоились».
		const unique = [
			...new Set(input.tags.map((t) => t.trim()).filter(Boolean)),
		];
		const primary = await resolveCanonicalIdentity(
			input.messenger,
			input.userId,
		);
		await setConversationTags(primary.messenger, primary.userId, unique);
		return { ok: true };
	});
