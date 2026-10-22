import type { BotMessenger, BotTargets } from "./bot-targets";
import type { BotChannel, OutreachSender, SendOutcome } from "./cascade";

/**
 * Отправитель каскада через официальных ботов MAX/Telegram (Bot API, как
 * обычная рассылка ботом). Модуль отправки импортируется лениво: он тянет
 * клиент БД, который не нужен при индексации задач Hatchet.
 */

/**
 * Ошибка Bot API → итог попытки. Клиент удалил чат или заблокировал бота —
 * как «нет в мессенджере»: дальше пробуем личные номера. Таймаут — запрос
 * мог дойти до мессенджера, поэтому «не подтверждено», а не повтор с
 * личного номера (иначе человек получит сообщение дважды).
 */
export function classifyBotError(
	error: string,
): Exclude<SendOutcome, { kind: "sent" }> {
	if (/токен .*не задан/i.test(error))
		return { kind: "channel_down", error, fatal: true };
	if (
		/chat not found|blocked by the user|user is deactivated|bot can't initiate|forbidden|dialog\.notfound|dialog\.suspended|не найден|заблокировал|остановил бота|удалён или деактивирован/i.test(
			error,
		)
	)
		return { kind: "not_found", error };
	if (/time(d)? ?out|aborted/i.test(error)) return { kind: "unknown", error };
	if (/лимит запросов|ECONNREFUSED|ENOTFOUND|Unable to connect/i.test(error))
		return { kind: "channel_down", error };
	return { kind: "failed", error };
}

const BOT_LABEL: Record<BotMessenger, string> = {
	max: "MAX",
	telegram: "Telegram",
};

/**
 * Официальный бот: пишет, только если по телефону нашёлся диалог клиента с
 * ботом (findTargets — общий поиск для обоих ботов, см. bot-targets.ts).
 */
export function createBotSender(
	channel: BotChannel,
	findTargets: (phone: string) => Promise<BotTargets>,
): OutreachSender {
	const messenger: BotMessenger = channel === "max_bot" ? "max" : "telegram";
	return {
		channel,
		async send(phone, text) {
			const targets = await findTargets(phone);
			const userId = targets[messenger];
			if (!userId) {
				return targets.error
					? { kind: "failed", error: targets.error }
					: {
							kind: "not_found",
							error: `Этот номер не писал боту ${BOT_LABEL[messenger]}`,
						};
			}
			const { sendMessengerMessage } = await import("../messenger");
			const { formatMessengerError } = await import("../messenger-errors");
			try {
				const externalId = await sendMessengerMessage(messenger, userId, text);
				return { kind: "sent", userId, externalId };
			} catch (err) {
				const outcome = classifyBotError((err as Error).message);
				return { ...outcome, error: formatMessengerError(outcome.error) };
			}
		},
	};
}
