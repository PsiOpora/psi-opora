import { bitrixProcedure } from "../../orpc";
import { widgetOlderSchema, widgetSearchSchema } from "../../schemas/broadcast";
import { loadHistory, resolveWidgetContact, searchHistory } from "./helpers";
import type { WidgetHistoryItem } from "./types";

/**
 * Страница более старых сообщений — подгрузка истории вверх при прокрутке.
 * Каналы пересчитываются из CRM (см. resolveWidgetContact), от клиента
 * принимается только курсор.
 */
export const loadOlder = bitrixProcedure.input(widgetOlderSchema).handler(
	async ({
		input,
		context,
	}): Promise<{
		messages?: WidgetHistoryItem[];
		hasMore?: boolean;
		error?: string;
	}> => {
		const before = new Date(input.beforeIso);
		if (Number.isNaN(before.getTime())) return { error: "Некорректная дата" };

		const resolved = await resolveWidgetContact(input, {
			memberId: context.memberId,
			getBitrixApi: () => context.getBitrixApi(),
		});
		if ("error" in resolved) return { error: resolved.error };

		const page = await loadHistory(resolved.contact.channels, before);
		return { messages: page.items, hasMore: page.hasMore };
	},
);

/** Поиск по тексту переписки со всеми каналами контакта. */
export const search = bitrixProcedure
	.input(widgetSearchSchema)
	.handler(
		async ({
			input,
			context,
		}): Promise<{ messages?: WidgetHistoryItem[]; error?: string }> => {
			const resolved = await resolveWidgetContact(input, {
				memberId: context.memberId,
				getBitrixApi: () => context.getBitrixApi(),
			});
			if ("error" in resolved) return { error: resolved.error };

			return {
				messages: await searchHistory(resolved.contact.channels, input.query),
			};
		},
	);
