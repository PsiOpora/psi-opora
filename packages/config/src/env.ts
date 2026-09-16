import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	server: {
		// Node environment
		NODE_ENV: z.enum(["development", "production", "test"]).optional(),

		// Vercel
		VERCEL_ENV: z.enum(["development", "preview", "production"]).optional(),
		VERCEL_URL: z.string().optional(),
		VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),

		// Database
		POSTGRES_URL: z.url().optional(),
		DB_DRIVER: z.enum(["node", "neon-http"]).optional(),

		// App
		APP_URL: z.string().default("https://psi-opora-dashboard.orixon.ru"),

		// Public client vars
		BASE_URL: z.string().optional(),

		// Email
		UNISENDER_API_KEY: z.string().optional(),
		EMAIL_SANDBOX_ENABLED: z.coerce.boolean().optional().default(false),
		EMAIL_SANDBOX_HOST: z.string().default("localhost"),
		EMAIL_FROM: z
			.string()
			.default('Психологический центр "Опора" <info@psi-opora.ru>'),

		// Auth
		AUTH_SECRET: z.string().optional(),
		AUTH_GOOGLE_ID: z.string().optional(),
		AUTH_GOOGLE_SECRET: z.string().optional(),

		// AWS S3
		AWS_S3_ENDPOINT: z.string().optional(),
		AWS_S3_FORCE_PATH_STYLE: z.string().optional(),
		AWS_ACCESS_KEY_ID: z.string().optional(),
		AWS_SECRET_ACCESS_KEY: z.string().optional(),
		AWS_REGION: z.string().default("us-east-1"),
		AWS_S3_BUCKET: z.string().default("acme-bucket"),

		// Webhook URLs
		MAX_WEBHOOK_URL: z.string().optional(),
		TG_WEBHOOK_URL: z.string().optional(),

		// Прокси для Bot API Telegram (apps/tg-vercel-proxy, Vercel Edge Function) —
		// на время переезда с РФ-хостинга, пока прямые запросы к api.telegram.org
		// с k3s ненадёжны. Тоггл отдельно от URL, чтобы выключить проксирование
		// без передеплоя (просто убрать переменную/поставить false).
		TG_API_PROXY_ENABLED: z
			.string()
			.optional()
			.default("false")
			.transform((val) => val === "true"),
		// Базовый URL задеплоенного apps/tg-vercel-proxy, например
		// https://tg-proxy.vercel.app — без хвостового слэша.
		TG_API_PROXY_URL: z.string().min(1).optional(),
		// Общий секрет с прокси (заголовок X-Proxy-Secret) — без него прокси,
		// будучи публичным Vercel-URL, стал бы открытым релеем к Telegram для
		// любого, кто узнает адрес.
		TG_API_PROXY_SECRET: z.string().min(1).optional(),
		// Секрет входящего вебхука Telegram (secret_token в setWebhook, сверяется
		// с заголовком X-Telegram-Bot-Api-Secret-Token) — то же значение должно
		// быть задано в env деплоя apps/tg-vercel-proxy как TG_WEBHOOK_SECRET.
		// Без него /webhook на прокси принял бы запрос от кого угодно.
		TG_WEBHOOK_SECRET: z.string().min(1).optional(),

		// Redis. REDIS_URL удобен локально; в k3s host/port/password задаются
		// раздельно, чтобы пароль не приходилось подставлять внутрь URL.
		REDIS_URL: z.string().optional(),
		REDIS_HOST: z.string().optional(),
		REDIS_PORT: z.coerce.number().int().positive().default(6379),
		REDIS_PASSWORD: z.string().optional(),

		// Bitrix
		BITRIX_WEBHOOK_TOKEN: z.string().optional(),
		BITRIX_CRM_WEBHOOK_TOKEN: z.string().optional(),
		DASHBOARD_BITRIX_CLIENT_ID: z.string().optional(),

		// Prodamus (payform.ru) — оплата предзаказа книги «Тело берёт своё».
		// Ключ подписи вебхука из личного кабинета payform: Настройки →
		// Оповещения → ключ для подписи (apps/bitrix-webhook/src/payform-webhook.ts).
		PRODAMUS_SECRET_KEY: z.string().optional(),
		DASHBOARD_BITRIX_CLIENT_SECRET: z.string().optional(),
		DASHBOARD_BITRIX_WEBHOOK_URL: z.string().optional(),
		CLIENTS_BITRIX_CLIENT_ID: z.string().optional(),
		CLIENTS_BITRIX_CLIENT_SECRET: z.string().optional(),
		// memberId портала, куда деплоятся боты (apps/tg-bot, apps/max-bot) —
		// нужен, чтобы резолвить OAuth-клиент (resolveBitrixApi) для дублирования
		// переписки в Открытые линии. Не мультитенантно — один деплой, один портал.
		BITRIX_MEMBER_ID: z.string().optional(),
		// Секрет для проверки запросов от формы «Записаться на консультацию»
		// на psi-opora.ru (см. apps/bitrix-webhook/src/site-lead-webhook.ts) —
		// серверный WordPress relay передаёт его обработчику в заголовке
		// `Authorization: Bearer <SITE_LEAD_WEBHOOK_SECRET>`.
		SITE_LEAD_WEBHOOK_SECRET: z.string().optional(),
		// Входящий вебхук с постоянными правами (создаётся под админом портала,
		// Разработчикам → Другое → Исходящий вебхук, права: calendar) — для
		// calendar.event.add/update в чужой календарь (см. consultation-reminders.ts,
		// diagnostic-scheduling.ts). OAuth-приложение "dashboard" вызывает эти
		// методы от имени того, кто его авторизовал на портале, а calendar.event.add
		// в чужой календарь требует именно у ЭТОГО пользователя прав на запись —
		// они пропадают при смене прав/увольнении сотрудника и ломают синк с
		// "Доступ запрещен". Админский вебхук от этого не зависит.
		BITRIX_CALENDAR_WEBHOOK_URL: z.string().optional(),

		// Telegram userbot (личный номер как коннектор Открытых линий, mtcute).
		// api_id/api_hash приложения НЕ здесь — их вводит администратор в
		// настройках коннектора (свои на каждый подключаемый номер), см.
		// packages/api/src/routers/telegram-personal.
		TG_USERBOT_ENCRYPTION_KEY: z.string().optional(),
		// Префикс для ID коннекторов Открытых линий — на каждый подключаемый
		// номер генерируется свой уникальный ID вида `${prefix}_${slug}`
		// (imconnector.register per-account), чтобы несколько номеров можно
		// было активировать на одной линии одновременно.
		TG_USERBOT_CONNECTOR_ID: z.string().default("psiopora_tg_personal"),
		// Прокси для MTProto-соединений mtcute (личные номера Telegram) — сервер
		// сейчас расположен в РФ, и прямые подключения к DC Telegram оттуда
		// ненадёжны/блокируются, прокси нужен всегда, а не только для кода
		// подтверждения (в отличие от TG_API_PROXY_* выше, который проксирует
		// только HTTPS Bot API). Формат — то, что понимает mtcute
		// `proxyTransportFromUrl`: socks5://user:pass@host:port,
		// http(s)://user:pass@host:port или https://t.me/proxy?server=...&secret=...
		TG_USERBOT_PROXY: z.string().optional(),

		// Личный номер MAX через неофициальный reverse-engineered протокол.
		MAX_USERBOT_CONNECTOR_ID: z.string().default("psiopora_max_personal"),
		// MAX отклоняет авторизацию устаревших Android-клиентов. Значения можно
		// оперативно обновить без правки протокольного кода при следующем релизе.
		MAX_USERBOT_APP_VERSION: z.string().default("26.25.0"),
		MAX_USERBOT_BUILD_NUMBER: z.coerce.number().int().positive().default(6790),

		// WhatsApp userbot (личный номер как коннектор Открытых линий, WAHA).
		// Постоянное соединение держит контейнер WAHA. В Docker Compose и k3s
		// приложения обращаются к нему по внутреннему адресу
		// `http://waha:3000`; вне кластера нужен публичный URL/NodePort.
		// WAHA_WEBHOOK_SECRET — HMAC-ключ вебхука входящих
		// (WAHA → apps/bitrix-webhook/api/waha-webhook) и он же задаётся при
		// создании сессии; WAHA_WEBHOOK_URL — публичный адрес этого роута.
		WAHA_URL: z.string().optional(),
		WAHA_API_KEY: z.string().optional(),
		WAHA_WEBHOOK_URL: z.string().optional(),
		WAHA_WEBHOOK_SECRET: z.string().optional(),
		// Прокси для самого WhatsApp-соединения (не для нашего HTTP до контейнера
		// WAHA) — сервер в РФ, задаётся per-session в config.proxy при создании
		// сессии (см. wahaCreateSession в packages/waha). Формат — то, что
		// понимает WAHA (ProxyConfig её OpenAPI-схемы): server — "host:port"
		// или "socks5://host:port" без креденшлов, они отдельно в username/password.
		WAHA_PROXY_SERVER: z.string().optional(),
		WAHA_PROXY_USERNAME: z.string().optional(),
		WAHA_PROXY_PASSWORD: z.string().optional(),
		// Префикс ID коннектора — см. комментарий у TG_USERBOT_CONNECTOR_ID.
		WA_PERSONAL_CONNECTOR_ID: z.string().default("psiopora_wa_personal"),

		// Admin
		ADMIN_EMAILS: z.string().optional(),

		// Cron
		CRON_SECRET: z.string().optional(),

		// Hatchet (фоновые задания и cron-задачи)
		HATCHET_CLIENT_TOKEN: z.string().optional(),
		HATCHET_CLIENT_HOST_PORT: z.string().optional(),
		HATCHET_CLIENT_API_URL: z.string().optional(),
		HATCHET_CLIENT_TLS_STRATEGY: z.enum(["tls", "mtls", "none"]).optional(),

		// OpenRouter (LLM-подстраховка на шаге «имя» в сценарии бота — см.
		// packages/bot-core/src/utils/llm-extract.ts). Без ключа шаг работает
		// как раньше, без LLM.
		OPENROUTER_API_KEY: z.string().optional(),
		OPENROUTER_MODEL: z
			.string()
			.default("nvidia/nemotron-3-ultra-550b-a55b:free"),

		// Яндекс.Метрика (счётчик, OAuth-токен, цель, поле ClientID в Bitrix)
		// настраивается администратором в дашборде (/settings/metrika, таблица
		// yandex_metrika_settings) — см. packages/bot-core/src/utils/yandex-metrika.ts.
	},
	client: {
		NEXT_PUBLIC_APP_NAME: z.string().default('Психологический центр "Опора"'),
		NEXT_PUBLIC_APP_SHORT_NAME: z.string().default("Опора"),
		NEXT_PUBLIC_APP_URL: z
			.string()
			.default("https://psi-opora-dashboard.orixon.ru"),
		// Полный адрес обработчика apps/bitrix-webhook (с путём /api/bitrix-webhook) —
		// дашборд использует его в браузере (b24.actions.v2.call.make("event.bind", ...)),
		// чтобы при регистрации коннектора сразу подписаться на OnImConnectorMessageAdd
		// и т.п., см. apps/dashboard/src/lib/bitrix/connector-events.ts.
		NEXT_PUBLIC_BITRIX_WEBHOOK_APP_URL: z.string().optional(),
	},
	clientPrefix: "NEXT_PUBLIC_",
	runtimeEnv: {
		NODE_ENV: process.env.NODE_ENV,
		VERCEL_ENV: process.env.VERCEL_ENV,
		VERCEL_URL: process.env.VERCEL_URL,
		VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
		POSTGRES_URL: process.env.POSTGRES_URL,
		DB_DRIVER: process.env.DB_DRIVER,
		APP_URL: process.env.APP_URL,
		BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
		UNISENDER_API_KEY: process.env.UNISENDER_API_KEY,
		EMAIL_SANDBOX_ENABLED: process.env.EMAIL_SANDBOX_ENABLED === "true",
		EMAIL_SANDBOX_HOST: process.env.EMAIL_SANDBOX_HOST,
		EMAIL_FROM: process.env.EMAIL_FROM,
		AUTH_SECRET: process.env.AUTH_SECRET,
		AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID,
		AUTH_GOOGLE_SECRET: process.env.AUTH_GOOGLE_SECRET,
		AWS_S3_ENDPOINT: process.env.AWS_S3_ENDPOINT,
		AWS_S3_FORCE_PATH_STYLE: process.env.AWS_S3_FORCE_PATH_STYLE,
		AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
		AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
		AWS_REGION: process.env.AWS_REGION,
		AWS_S3_BUCKET: process.env.AWS_S3_BUCKET,
		MAX_WEBHOOK_URL: process.env.MAX_WEBHOOK_URL,
		TG_WEBHOOK_URL: process.env.TG_WEBHOOK_URL,
		TG_API_PROXY_ENABLED: process.env.TG_API_PROXY_ENABLED,
		TG_API_PROXY_URL: process.env.TG_API_PROXY_URL,
		TG_API_PROXY_SECRET: process.env.TG_API_PROXY_SECRET,
		TG_WEBHOOK_SECRET: process.env.TG_WEBHOOK_SECRET,
		REDIS_URL: process.env.REDIS_URL,
		REDIS_HOST: process.env.REDIS_HOST,
		REDIS_PORT: process.env.REDIS_PORT,
		REDIS_PASSWORD: process.env.REDIS_PASSWORD,
		BITRIX_WEBHOOK_TOKEN: process.env.BITRIX_WEBHOOK_TOKEN,
		BITRIX_CRM_WEBHOOK_TOKEN: process.env.BITRIX_CRM_WEBHOOK_TOKEN,
		DASHBOARD_BITRIX_CLIENT_ID: process.env.DASHBOARD_BITRIX_CLIENT_ID,
		PRODAMUS_SECRET_KEY: process.env.PRODAMUS_SECRET_KEY,
		DASHBOARD_BITRIX_CLIENT_SECRET: process.env.DASHBOARD_BITRIX_CLIENT_SECRET,
		DASHBOARD_BITRIX_WEBHOOK_URL: process.env.DASHBOARD_BITRIX_WEBHOOK_URL,
		CLIENTS_BITRIX_CLIENT_ID: process.env.CLIENTS_BITRIX_CLIENT_ID,
		CLIENTS_BITRIX_CLIENT_SECRET: process.env.CLIENTS_BITRIX_CLIENT_SECRET,
		BITRIX_MEMBER_ID: process.env.BITRIX_MEMBER_ID,
		SITE_LEAD_WEBHOOK_SECRET: process.env.SITE_LEAD_WEBHOOK_SECRET,
		BITRIX_CALENDAR_WEBHOOK_URL: process.env.BITRIX_CALENDAR_WEBHOOK_URL,
		TG_USERBOT_ENCRYPTION_KEY: process.env.TG_USERBOT_ENCRYPTION_KEY,
		TG_USERBOT_CONNECTOR_ID: process.env.TG_USERBOT_CONNECTOR_ID,
		TG_USERBOT_PROXY: process.env.TG_USERBOT_PROXY,
		MAX_USERBOT_CONNECTOR_ID: process.env.MAX_USERBOT_CONNECTOR_ID,
		MAX_USERBOT_APP_VERSION: process.env.MAX_USERBOT_APP_VERSION,
		MAX_USERBOT_BUILD_NUMBER: process.env.MAX_USERBOT_BUILD_NUMBER,
		WAHA_URL: process.env.WAHA_URL,
		WAHA_API_KEY: process.env.WAHA_API_KEY,
		WAHA_WEBHOOK_URL: process.env.WAHA_WEBHOOK_URL,
		WAHA_WEBHOOK_SECRET: process.env.WAHA_WEBHOOK_SECRET,
		WAHA_PROXY_SERVER: process.env.WAHA_PROXY_SERVER,
		WAHA_PROXY_USERNAME: process.env.WAHA_PROXY_USERNAME,
		WAHA_PROXY_PASSWORD: process.env.WAHA_PROXY_PASSWORD,
		WA_PERSONAL_CONNECTOR_ID: process.env.WA_PERSONAL_CONNECTOR_ID,
		ADMIN_EMAILS: process.env.ADMIN_EMAILS,
		CRON_SECRET: process.env.CRON_SECRET,
		HATCHET_CLIENT_TOKEN: process.env.HATCHET_CLIENT_TOKEN,
		HATCHET_CLIENT_HOST_PORT: process.env.HATCHET_CLIENT_HOST_PORT,
		HATCHET_CLIENT_API_URL: process.env.HATCHET_CLIENT_API_URL,
		HATCHET_CLIENT_TLS_STRATEGY: process.env.HATCHET_CLIENT_TLS_STRATEGY,
		OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
		OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
		NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
		NEXT_PUBLIC_APP_SHORT_NAME: process.env.NEXT_PUBLIC_APP_SHORT_NAME,
		NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
		NEXT_PUBLIC_BITRIX_WEBHOOK_APP_URL:
			process.env.NEXT_PUBLIC_BITRIX_WEBHOOK_APP_URL,
	},
	skipValidation:
		!!process.env.CI || process.env.npm_lifecycle_event === "lint",
});
