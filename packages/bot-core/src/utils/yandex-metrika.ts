import { logger } from "@psi-opora/config";
import { getYandexMetrikaSettings } from "@psi-opora/db/queries";

const UPLOAD_URL_BASE = "https://api-metrika.yandex.net/management/v1/counter";
const DEFAULT_GOAL_ID = "free_consultation_booked";

export interface ConsultationGoalParams {
	/** ClientID Яндекс.Метрики визита (см. utils/utm.ts extractYmClientId). */
	clientId?: string;
	/**
	 * Запасной идентификатор — id клика по объявлению Директа (см.
	 * utils/utm.ts extractYmClientId). Используется, только если ClientID не
	 * захватился: сайт мог не успеть его получить (блокировщик, отказ от
	 * cookie), а yclid при этом прямо подтверждает переход по рекламе.
	 */
	yclid?: string;
	/** ID сделки в Bitrix — только для логов, в саму конверсию не уходит. */
	dealId?: number;
	/** Момент создания сделки — по умолчанию текущее время. */
	occurredAt?: Date;
}

/**
 * ClientId и Yclid — взаимоисключающие колонки CSV: обе ссылаются на один и
 * тот же визит, но `client_id_type=CLIENT_ID` в URL относится только к
 * ClientId, а для Yclid этот параметр не указывается (см. проверку через
 * реальный вызов API — обе колонки принимаются методом upload).
 */
function buildConversionsCsv(
	idColumn: "ClientId" | "Yclid",
	idValue: string,
	target: string,
	unixTimestamp: number,
): string {
	return `${idColumn},Target,DateTime\n${idValue},${target},${unixTimestamp}\n`;
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
 * Счётчик/токен/цель настраиваются администратором в дашборде
 * (/settings/metrika, таблица yandex_metrika_settings), а не в .env — так
 * их можно поменять без деплоя. Если ничего не настроено, тихо пропускает
 * отправку (warn в лог) — сделка в Bitrix при этом создаётся как обычно.
 */
export async function sendConsultationGoalToYandexMetrika(
	params: ConsultationGoalParams,
): Promise<boolean> {
	const settings = await getYandexMetrikaSettings();
	const counterId = settings?.counterId;
	const token = settings?.oauthToken;
	const target = settings?.goalId || DEFAULT_GOAL_ID;

	if (!counterId || !token) {
		logger.warn("yandex_metrika.not_configured", { dealId: params.dealId });
		return false;
	}
	if (!params.clientId && !params.yclid) {
		logger.warn("yandex_metrika.no_client_id", { dealId: params.dealId });
		return false;
	}

	const unixTimestamp = Math.floor(
		(params.occurredAt ?? new Date()).getTime() / 1000,
	);
	// ClientID приоритетнее: он у Метрики точнее привязывается к визиту, чем
	// yclid (клик мог случиться в другой сессии/устройстве до захода на сайт).
	const csv = params.clientId
		? buildConversionsCsv("ClientId", params.clientId, target, unixTimestamp)
		: buildConversionsCsv(
				"Yclid",
				params.yclid as string,
				target,
				unixTimestamp,
			);
	const clientIdTypeQuery = params.clientId ? "?client_id_type=CLIENT_ID" : "";

	const form = new FormData();
	form.append("file", new Blob([csv], { type: "text/csv" }), "conversions.csv");

	try {
		const res = await fetch(
			`${UPLOAD_URL_BASE}/${counterId}/offline_conversions/upload${clientIdTypeQuery}`,
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
			yclid: params.clientId ? undefined : params.yclid,
		});
		return true;
	} catch (err) {
		logger.error("yandex_metrika.upload_error", err as Error, {
			dealId: params.dealId,
		});
		return false;
	}
}
