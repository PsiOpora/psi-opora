import { publicProcedure, router } from "../orpc";
import { z } from "zod";
import {
  getAdCredentials,
  upsertAdCredentials,
  getAdStatsSummary,
  getAdStatsByDateRange,
  upsertAdDailyStats,
  type NewAdDailyStats,
} from "@psi-opora/db/queries";

export const adsRouter = router({
  getCredentials: publicProcedure.handler(async () => {
    return getAdCredentials();
  }),

  upsertCredentials: publicProcedure
    .input(
      z.object({
        yandexClientId: z.string().optional(),
        yandexClientSecret: z.string().optional(),
        yandexRefreshToken: z.string().optional(),
        vkAccessToken: z.string().optional(),
        vkAdsAccountId: z.string().optional(),
      }),
    )
    .handler(async ({ input }) => {
      await upsertAdCredentials(input);
      return { ok: true };
    }),

  stats: publicProcedure
    .input(
      z.object({
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      }),
    )
    .handler(async ({ input }) => {
      const today = new Date();
      const dateTo = input.dateTo ?? today.toISOString().split("T")[0] ?? "";
      const dateFrom =
        input.dateFrom ??
        new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0] ??
        "";

      const [summary, rows] = await Promise.all([
        getAdStatsSummary(dateFrom, dateTo),
        getAdStatsByDateRange(dateFrom, dateTo),
      ]);

      return { summary, rows };
    }),

  upsertStats: publicProcedure
    .input(
      z.object({
        rows: z.array(
          z.object({
            id: z.string(),
            platform: z.string(),
            campaignId: z.string(),
            campaignName: z.string(),
            date: z.string(),
            impressions: z.number(),
            clicks: z.number(),
            spend: z.number(),
          }),
        ),
      }),
    )
    .handler(async ({ input }) => {
      await upsertAdDailyStats(input.rows as NewAdDailyStats[]);
      return { ok: true };
    }),
});
