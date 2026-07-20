import { z } from "zod";

/**
 * Схема ключей рекламных кабинетов (Яндекс Директ + VK Реклама).
 *
 * Используется и на сервере (input процедуры `ads.upsertCredentials`),
 * и на клиенте (resolver формы настроек) — единый источник валидации.
 */
export const adCredentialsSchema = z.object({
  yandexClientId: z.string().trim().optional(),
  yandexClientSecret: z.string().trim().optional(),
  yandexRefreshToken: z.string().trim().optional(),
  vkAccessToken: z.string().trim().optional(),
  vkAdsAccountId: z.string().trim().optional(),
});

export type AdCredentialsInput = z.infer<typeof adCredentialsSchema>;
