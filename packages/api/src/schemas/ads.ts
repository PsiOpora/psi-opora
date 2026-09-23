import { z } from "zod";

/**
 * Схема ключей рекламных кабинетов (Яндекс Директ).
 *
 * Используется и на сервере (input процедуры `ads.upsertCredentials`),
 * и на клиенте (resolver формы настроек) — единый источник валидации.
 */
export const adCredentialsSchema = z.object({
	yandexClientId: z.string().trim().optional(),
	yandexClientSecret: z.string().trim().optional(),
	yandexRefreshToken: z.string().trim().optional(),
	/** Client-Login клиентского кабинета — заполняется, только если токен выдан представителем/агентством. */
	yandexClientLogin: z.string().trim().optional(),
});

export type AdCredentialsInput = z.infer<typeof adCredentialsSchema>;

/**
 * Ручная привязка UTM-кампании к актуальному ID кампании в рекламном
 * кабинете — см. packages/db/src/schema/ads/index.ts (ad_campaign_id_overrides).
 */
export const adCampaignIdOverrideSchema = z.object({
	utmCampaign: z.string().trim().min(1),
	adCampaignId: z.string().trim().min(1),
});

export type AdCampaignIdOverrideInput = z.infer<
	typeof adCampaignIdOverrideSchema
>;
