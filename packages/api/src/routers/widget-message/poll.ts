import { listBotMessagesSince } from "@psi-opora/db/queries";
import { publicProcedure } from "../../orpc";
import { widgetPollSchema } from "../../schemas/broadcast";
import { resolveContact } from "./helpers";
import type { WidgetHistoryItem } from "./types";

/**
 * Новые сообщения диалога после `sinceIso` — для поллинга истории в открытой
 * вкладке. Как и в send, каналы не принимаются от клиента: они каждый раз
 * пересчитываются из актуальных данных CRM (resolveContact), иначе можно
 * было бы подставить чужие messenger/userId и читать чужую переписку.
 */
export const poll = publicProcedure
	.input(widgetPollSchema)
	.handler(
		async ({
			input,
			context,
		}): Promise<{ messages?: WidgetHistoryItem[]; error?: string }> => {
			if (!/^\d+$/.test(input.id)) {
				return { error: "Некорректный ID элемента CRM" };
			}

			const since = new Date(input.sinceIso);
			if (Number.isNaN(since.getTime())) return { error: "Некорректная дата" };

			const api = await context.getBitrixApi();
			if (!api) {
				return { error: "Нет подключения к Битрикс24 — обновите страницу" };
			}

			try {
				const { contact, error } = await resolveContact(
					api,
					input.entity,
					input.id,
					context.memberId,
				);
				if (error || !contact) return { error };

				const perChannel = await Promise.all(
					contact.channels.map(async (channel) => {
						const rows = await listBotMessagesSince(
							channel.messenger,
							channel.userId,
							since,
						).catch(() => []);
						return rows.map((row) => ({
							id: row.id,
							messenger: channel.messenger,
							direction:
								row.direction === "in" ? ("in" as const) : ("out" as const),
							source: row.source,
							text: row.text,
							status: row.status,
							createdAt: row.createdAt.toISOString(),
						}));
					}),
				);

				return {
					messages: perChannel
						.flat()
						.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
				};
			} catch (err) {
				return { error: (err as Error).message };
			}
		},
	);
