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
    APP_URL: z.string().default("http://localhost:3000"),

    // Public client vars
    BASE_URL: z.string().optional(),

    // Email
    RESEND_API_KEY: z.string().optional(),
    EMAIL_SANDBOX_ENABLED: z.coerce.boolean().optional().default(false),
    EMAIL_SANDBOX_HOST: z.string().default("localhost"),
    EMAIL_FROM: z
      .string()
      .default('Психологический центр "Опора" <onboarding@resend.dev>'),

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

    // Bot tokens
    MAX_BOT_TOKEN: z.string().optional(),
    BOT_TOKEN: z.string().optional(),
    TG_BOT_TOKEN: z.string().optional(),

    // Webhook URLs
    MAX_WEBHOOK_URL: z.string().optional(),
    TG_WEBHOOK_URL: z.string().optional(),

    // Redis / Upstash
    KV_REST_API_URL: z.string().optional(),
    KV_REST_API_TOKEN: z.string().optional(),

    // Bitrix
    BITRIX_WEBHOOK_TOKEN: z.string().optional(),
    BITRIX_CRM_WEBHOOK_TOKEN: z.string().optional(),
    DASHBOARD_BITRIX_CLIENT_ID: z.string().optional(),
    DASHBOARD_BITRIX_CLIENT_SECRET: z.string().optional(),
    DASHBOARD_BITRIX_WEBHOOK_URL: z.string().optional(),

    // Telegram userbot (личный номер как коннектор Открытых линий, mtcute).
    // api_id/api_hash приложения НЕ здесь — их вводит администратор в
    // настройках коннектора (свои на каждый подключаемый номер), см.
    // packages/api/src/routers/telegram-personal.
    TG_USERBOT_ENCRYPTION_KEY: z.string().optional(),
    TG_USERBOT_CONNECTOR_ID: z.string().default("psiopora_tg_personal"),

    // Admin
    ADMIN_EMAILS: z.string().optional(),

    // Cron
    CRON_SECRET: z.string().optional(),

    // Trigger.dev (фоновые задания — рассылки)
    TRIGGER_SECRET_KEY: z.string().optional(),
  },
  client: {
    NEXT_PUBLIC_APP_NAME: z.string().default('Психологический центр "Опора"'),
    NEXT_PUBLIC_APP_SHORT_NAME: z.string().default("Опора"),
    NEXT_PUBLIC_APP_URL: z.string().default("http://localhost:3000"),
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
    RESEND_API_KEY: process.env.RESEND_API_KEY,
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
    MAX_BOT_TOKEN: process.env.MAX_BOT_TOKEN,
    BOT_TOKEN: process.env.BOT_TOKEN,
    TG_BOT_TOKEN: process.env.TG_BOT_TOKEN,
    MAX_WEBHOOK_URL: process.env.MAX_WEBHOOK_URL,
    TG_WEBHOOK_URL: process.env.TG_WEBHOOK_URL,
    KV_REST_API_URL: process.env.KV_REST_API_URL,
    KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
    BITRIX_WEBHOOK_TOKEN: process.env.BITRIX_WEBHOOK_TOKEN,
    BITRIX_CRM_WEBHOOK_TOKEN: process.env.BITRIX_CRM_WEBHOOK_TOKEN,
    DASHBOARD_BITRIX_CLIENT_ID: process.env.DASHBOARD_BITRIX_CLIENT_ID,
    DASHBOARD_BITRIX_CLIENT_SECRET: process.env.DASHBOARD_BITRIX_CLIENT_SECRET,
    DASHBOARD_BITRIX_WEBHOOK_URL: process.env.DASHBOARD_BITRIX_WEBHOOK_URL,
    TG_USERBOT_ENCRYPTION_KEY: process.env.TG_USERBOT_ENCRYPTION_KEY,
    TG_USERBOT_CONNECTOR_ID: process.env.TG_USERBOT_CONNECTOR_ID,
    ADMIN_EMAILS: process.env.ADMIN_EMAILS,
    CRON_SECRET: process.env.CRON_SECRET,
    TRIGGER_SECRET_KEY: process.env.TRIGGER_SECRET_KEY,
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
    NEXT_PUBLIC_APP_SHORT_NAME: process.env.NEXT_PUBLIC_APP_SHORT_NAME,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
  skipValidation:
    !!process.env.CI || process.env.npm_lifecycle_event === "lint",
});
