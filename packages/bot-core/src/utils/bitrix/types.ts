/**
 * Минимальный интерфейс Bitrix24-клиента, который нужен методам `imconnector.*`
 * (`imconnector.register`/`imconnector.activate`/`imconnector.send.messages`
 * работают только в контексте OAuth-приложения — обычный входящий вебхук,
 * которым пользуется остальной этот файл через `bitrixPost`, для них не
 * подходит: Bitrix отвечает `WRONG_AUTH_TYPE`). Специально не импортируем
 * `BitrixApi` из `@psi-opora/bitrix-client` — тот пакет сам зависит от
 * bot-core (использует `createRedisClient`), обратная зависимость создала
 * бы цикл воркспейсов. Вызывающая сторона (apps/tg-bot, apps/max-bot)
 * передаёт уже готовый клиент через `resolveBitrixApi(memberId)`.
 */
export interface BitrixApiLike {
	call<T = unknown>(
		method: string,
		params?: Record<string, unknown>,
	): Promise<T>;
}

/** Данные, достаточные для создания/обновления контакта в Bitrix24. */
export interface ContactData {
	name: string;
	phone?: string;
	email?: string;
	/**
	 * Явное согласие, полученное внутри сценария бота. Для контактов,
	 * созданных из произвольного сообщения оператору, должно быть false:
	 * сам факт отправки телефона/email не равен согласию на рассылку.
	 */
	consentGranted?: boolean;
	campaign?: string;
	source?: string;
	/** ClientID Яндекс.Метрики визита, с которого пришёл клиент (см.
	 * packages/bot-core/src/utils/utm.ts extractYmClientId) — сохраняется в
	 * Bitrix, если настроено поле BITRIX_YM_CLIENT_ID_FIELD, и используется для
	 * отправки офлайн-конверсии «Запись на консультацию» в Яндекс.Метрику
	 * (см. packages/bot-core/src/utils/yandex-metrika.ts). */
	ymClientId?: string;
	telegramUserId?: number;
	messenger?: string;
	/** Внешний ID чата, переданный в imconnector.send.messages (chat.id) —
	 * нужен, чтобы через USER_CODE найти диалог Bitrix и созданные по нему
	 * трекером Открытой линии контакт/сделку (см. resolveOpenLineDialog). */
	chatId?: number;
	/** Ниже — доп. данные профиля из мессенджера (bot_users), для карточки контакта. */
	username?: string;
	languageCode?: string;
	isPremium?: boolean;
	bio?: string;
}

/** Контакт плюс данные, необходимые для создания сделки. */
export interface DealData extends ContactData {
	phone: string;
	/** Дополнительный комментарий к сделке (выбор пользователя в сценарии). */
	comment?: string;
	/** Ветка сценария (см. scenario/engine.ts) — попадает в заголовок и «Продукт». */
	flow?: "consult" | "guide";
	/** Выбор в флоу гайда: кому нужна помощь. */
	audience?: "child" | "self";
	/** Выбор в флоу гайда: с чем связаны трудности. */
	issue?: "eating" | "ocd" | "other";
}
