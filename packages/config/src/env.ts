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
    DASHBOARD_BITRIX_CLIENT_SECRET: z.string().optional(),
    DASHBOARD_BITRIX_WEBHOOK_URL: z.string().optional(),
    CLIENTS_BITRIX_CLIENT_ID: z.string().optional(),
    CLIENTS_BITRIX_CLIENT_SECRET: z.string().optional(),
    // memberId портала, куда деплоятся боты (apps/tg-bot, apps/max-bot) —
    // нужен, чтобы резолвить OAuth-клиент (resolveBitrixApi) для дублирования
    // переписки в Открытые линии. Не мультитенантно — один деплой, один портал.
    BITRIX_MEMBER_ID: z.string().optional(),
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
    HATCHET_CLIENT_TLS_STRATEGY: z
      .enum(["tls", "mtls", "none"])
      .optional(),

    // OpenRouter (LLM-подстраховка на шаге «имя» в сценарии бота — см.
    // packages/bot-core/src/utils/llm-extract.ts). Без ключа шаг работает
    // как раньше, без LLM.
    OPENROUTER_API_KEY: z.string().optional(),
    OPENROUTER_MODEL: z
      .string()
      .default("nvidia/nemotron-3-ultra-550b-a55b:free"),
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
    REDIS_URL: process.env.REDIS_URL,
    REDIS_HOST: process.env.REDIS_HOST,
    REDIS_PORT: process.env.REDIS_PORT,
    REDIS_PASSWORD: process.env.REDIS_PASSWORD,
    BITRIX_WEBHOOK_TOKEN: process.env.BITRIX_WEBHOOK_TOKEN,
    BITRIX_CRM_WEBHOOK_TOKEN: process.env.BITRIX_CRM_WEBHOOK_TOKEN,
    DASHBOARD_BITRIX_CLIENT_ID: process.env.DASHBOARD_BITRIX_CLIENT_ID,
    DASHBOARD_BITRIX_CLIENT_SECRET: process.env.DASHBOARD_BITRIX_CLIENT_SECRET,
    DASHBOARD_BITRIX_WEBHOOK_URL: process.env.DASHBOARD_BITRIX_WEBHOOK_URL,
    CLIENTS_BITRIX_CLIENT_ID: process.env.CLIENTS_BITRIX_CLIENT_ID,
    CLIENTS_BITRIX_CLIENT_SECRET: process.env.CLIENTS_BITRIX_CLIENT_SECRET,
    BITRIX_MEMBER_ID: process.env.BITRIX_MEMBER_ID,
    BITRIX_CALENDAR_WEBHOOK_URL: process.env.BITRIX_CALENDAR_WEBHOOK_URL,
    TG_USERBOT_ENCRYPTION_KEY: process.env.TG_USERBOT_ENCRYPTION_KEY,
    TG_USERBOT_CONNECTOR_ID: process.env.TG_USERBOT_CONNECTOR_ID,
    MAX_USERBOT_CONNECTOR_ID: process.env.MAX_USERBOT_CONNECTOR_ID,
    MAX_USERBOT_APP_VERSION: process.env.MAX_USERBOT_APP_VERSION,
    MAX_USERBOT_BUILD_NUMBER: process.env.MAX_USERBOT_BUILD_NUMBER,
    WAHA_URL: process.env.WAHA_URL,
    WAHA_API_KEY: process.env.WAHA_API_KEY,
    WAHA_WEBHOOK_URL: process.env.WAHA_WEBHOOK_URL,
    WAHA_WEBHOOK_SECRET: process.env.WAHA_WEBHOOK_SECRET,
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
