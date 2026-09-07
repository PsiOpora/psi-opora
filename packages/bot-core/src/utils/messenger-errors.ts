/**
 * Подстроки ошибок Telegram/MAX, которые означают "сообщение отправить
 * некому" — клиент заблокировал бота, удалил чат или деактивировал аккаунт.
 * Используется в reminders.ts, чтобы отличить в воронке причину "бот
 * заблокирован" от прочих сбоев отправки. Человекочитаемый перевод этих же
 * ошибок для интерфейса оператора — см. packages/jobs/src/messenger-errors.ts.
 */
const BLOCKED_ERROR_SUBSTRINGS = [
	"bot was blocked by the user",
	"user is deactivated",
	"chat not found",
	"error.dialog.suspended",
	"error.dialog.notfound",
];

export function isBotBlockedError(message: string): boolean {
	const lower = message.toLowerCase();
	return BLOCKED_ERROR_SUBSTRINGS.some((substring) =>
		lower.includes(substring),
	);
}
