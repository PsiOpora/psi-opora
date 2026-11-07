import { listBotMessagesSince } from "@psi-opora/db/queries";
import { bitrixProcedure } from "../../orpc";
import { widgetPollSchema } from "../../schemas/broadcast";
import { resolveWidgetContact, toWidgetHistoryItem } from "./helpers";
import type { WidgetHistoryItem } from "./types";

/**
 * Новые сообщения диалога после `sinceIso` — для поллинга истории в открытой
 * вкладке. Как и в send, каналы не принимаются от клиента: они каждый раз
 * пересчитываются из актуальных данных CRM (resolveWidgetContact), иначе можно
 * было бы подставить чужие messenger/userId и читать чужую переписку.
 */
export const poll = bitrixProcedure
	.input(widgetPollSchema)
	.handler(
		async ({
			input,
			context,
		}): Promise<{ messages?: WidgetHistoryItem[]; error?: string }> => {
			const since = new Date(input.sinceIso);
			if (Number.isNaN(since.getTime())) return { error: "Некорректная дата" };

			const resolved = await resolveWidgetContact(input, {
				memberId: context.memberId,
				getBitrixApi: () => context.getBitrixApi(),
			});
			if ("error" in resolved) return { error: resolved.error };

			try {
				const perChannel = await Promise.all(
					resolved.contact.channels.map(async (channel) => {
						const userIds = [channel.userId, ...(channel.historyUserIds ?? [])];
						const rows = (
							await Promise.all(
								userIds.map((userId) =>
									listBotMessagesSince(
										channel.messenger,
										userId,
										since,
										undefined,
										channel.connectorId,
									).catch(() => []),
								),
							)
						).flat();
						return rows.map((row) =>
							toWidgetHistoryItem(row, channel.messenger),
						);
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
