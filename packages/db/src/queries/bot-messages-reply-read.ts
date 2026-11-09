import { and, eq, inArray, lt } from "drizzle-orm";
import type { Database } from "../client.types";
import { botMessages } from "../schema/bot-messages";

/**
 * Официальные боты (Telegram Bot API, MAX Bot API) не сообщают о прочтении
 * сообщений клиентом. Для них «прочитано» выводится косвенно: если клиент
 * что-то написал или нажал кнопку, он точно видел всё, что мы отправили до
 * этого. Личные номера и WhatsApp получают настоящие read-события и сюда не
 * относятся.
 */
export const REPLY_READ_MESSENGERS: readonly string[] = ["telegram", "max"];

/**
 * Поднимает до «read» исходящие сообщения официального бота, отправленные
 * раньше ответа клиента. Статус "queued"/"failed" не трогаем — недоставленное
 * не становится прочитанным. Возвращает число обновлённых сообщений.
 */
export async function markOutgoingReadByClientReply(
	db: Database,
	params: { messenger: string; userId: string; repliedAt: Date },
): Promise<number> {
	if (!db || !REPLY_READ_MESSENGERS.includes(params.messenger)) return 0;
	const rows = await db
		.update(botMessages)
		.set({ status: "read", updatedAt: new Date() })
		.where(
			and(
				eq(botMessages.messenger, params.messenger),
				eq(botMessages.userId, params.userId),
				eq(botMessages.direction, "out"),
				inArray(botMessages.status, ["sent", "delivered"]),
				lt(botMessages.createdAt, params.repliedAt),
			),
		)
		.returning({ id: botMessages.id });
	return rows.length;
}
