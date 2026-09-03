import { env, logger } from "@psi-opora/config";

const UPLOAD_URL_BASE = "https://api-metrika.yandex.net/management/v1/counter";

export interface ConsultationGoalParams {
	/** ClientID Яндекс.Метрики визита (см. utils/utm.ts extractYmClientId). */
	clientId: string;
	/** ID сделки в Bitrix — только для логов, в саму конверсию не уходит. */
	dealId?: number;
	/** Момент создания сделки — по умолчанию текущее время. */
	occurredAt?: Date;
}

function buildConversionsCsv(
	clientId: string,
	target: string,
	unixTimestamp: number,
): string {
	return `ClientId,Target,DateTime\n${clientId},${target},${unixTimestamp}\n`;
}

/**
 * Загружает в Яндекс.Метрику офлайн-конверсию «Запись на консультацию» по
 * ClientID визита сразу после создания сделки в Bitrix — это единственный
 * официальный способ Метрики принять конверсию, привязанную к ClientID
 * (https://yandex.ru/dev/metrika/ru/management/offline-conv), без ручного
 * экспорта из Bitrix и последующей загрузки. Данные появляются в отчётах
 * Метрики в течение ~2 часов после загрузки — это SLA самого метода upload,
 * а не задержка на нашей стороне.
 *
 * Если счётчик/токен не настроены, тихо пропускает отправку (warn в лог) —
 * сделка в Bitrix при этом создаётся как обычно.
 */
export async function sendConsultationGoalToYandexMetrika(
	params: ConsultationGoalParams,
): Promise<boolean> {
	const counterId = env.YANDEX_METRIKA_COUNTER_ID;
	const token = env.YANDEX_METRIKA_OAUTH_TOKEN;
	const target = env.YANDEX_METRIKA_CONSULTATION_GOAL;

	if (!counterId || !token) {
		logger.warn("yandex_metrika.not_configured", { dealId: params.dealId });
		return false;
	}
	if (!params.clientId) {
		logger.warn("yandex_metrika.no_client_id", { dealId: params.dealId });
		return false;
	}

	const unixTimestamp = Math.floor(
		(params.occurredAt ?? new Date()).getTime() / 1000,
	);
	const csv = buildConversionsCsv(params.clientId, target, unixTimestamp);

	const form = new FormData();
	form.append("file", new Blob([csv], { type: "text/csv" }), "conversions.csv");

	try {
		const res = await fetch(
			`${UPLOAD_URL_BASE}/${counterId}/offline_conversions/upload?client_id_type=CLIENT_ID`,
			{
				method: "POST",
				headers: { Authorization: `OAuth ${token}` },
				body: form,
			},
		);

		if (!res.ok) {
			const body = await res.text().catch(() => "");
			logger.error(
				"yandex_metrika.upload_failed",
				new Error(`HTTP ${res.status}`),
				{ dealId: params.dealId, status: res.status, body: body.slice(0, 500) },
			);
			return false;
		}

		logger.info("yandex_metrika.goal_sent", {
			dealId: params.dealId,
			target,
			clientId: params.clientId,
		});
		return true;
	} catch (err) {
		logger.error("yandex_metrika.upload_error", err as Error, {
			dealId: params.dealId,
		});
		return false;
	}
}
