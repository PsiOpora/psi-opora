import { env } from "@psi-opora/config";

export const WHATSAPP_WEBHOOK_CONFIG_ERROR =
	"Не настроены WAHA_WEBHOOK_URL и WAHA_WEBHOOK_SECRET — входящие сообщения WhatsApp не будут доставляться. Сначала заполните переменные окружения приложения.";

export function buildSessionWebhook(
	url: string | undefined,
	hmacKey: string | undefined,
): { url: string; hmacKey: string } | undefined {
	if (!url || !hmacKey) return undefined;
	return { url, hmacKey };
}

/**
 * Конфигурация вебхука входящих для создаваемой WAHA-сессии: WAHA сама
 * доставляет события `message` на apps/bitrix-webhook (см. api/waha-webhook),
 * подписывая тело HMAC-ключом — поэтому у нас нет always-on процесса
 * на приём, в отличие от tg-userbot-worker.
 */
export function sessionWebhook(): { url: string; hmacKey: string } | undefined {
	return buildSessionWebhook(env.WAHA_WEBHOOK_URL, env.WAHA_WEBHOOK_SECRET);
}
