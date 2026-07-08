import { publicProcedure, router } from "../orpc";
import { getAdCredentials, upsertAdCredentials, getAdStatsSummary, getAdStatsByDateRange, upsertAdDailyStats, type NewAdDailyStats } from "@psi-opora/db/queries";

export const adsRouter = router({
  getCredentials: publicProcedure.handler(async () => {
    return getAdCredentials();
  }),

  upsertCredentials: publicProcedure
    .input({
      yandexClientId: { type: "string", optional: true },
      yandexClientSecret: { type: "string", optional: true },
      yandexRefreshToken: { type: "string", optional: true },
      vkAccessToken: { type: "string", optional: true },
      vkAdsAccountId: { type: "string", optional: true },
    })
    .handler(async ({ input }) => {
      await upsertAdCredentials(input);
      return { ok: true };
    }),

  stats: publicProcedure
    .input(
      {
        dateFrom: { type: "string", optional: true },
        dateTo: { type: "string", optional: true },
      },
    )
    .handler(async ({ input }) => {
      const today = new Date();
      const dateTo = input.dateTo ?? today.toISOString().split("T")[0]!;
      const dateFrom =
        input.dateFrom ??
        new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0]!;

      const [summary, rows] = await Promise.all([
        getAdStatsSummary(dateFrom, dateTo),
        getAdStatsByDateRange(dateFrom, dateTo),
      ]);

      return { summary, rows };
    }),

  upsertStats: publicProcedure
    .input({ rows: { type: "array", items: {} } })
    .handler(async ({ input }) => {
      await upsertAdDailyStats(input.rows as NewAdDailyStats[]);
      return { ok: true };
    }),
});
