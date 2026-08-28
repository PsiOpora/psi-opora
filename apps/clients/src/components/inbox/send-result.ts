interface SendResult {
	ok?: boolean;
	id?: string;
	error?: string;
}

interface SuccessfulSendResult extends SendResult {
	ok: true;
	id: string;
}

const INVALID_SEND_RESPONSE_ERROR =
	"Не удалось подтвердить сохранение сообщения. Обновите диалог перед повторной отправкой.";

/** Only a successful response with a persisted message ID may update the composer. */
export function isSuccessfulSendResult(
	result: SendResult,
): result is SuccessfulSendResult {
	return result.ok === true && Boolean(result.id);
}

export function getSendResultError(result: SendResult): string | null {
	if (isSuccessfulSendResult(result)) return null;
	return result.error ?? INVALID_SEND_RESPONSE_ERROR;
}
