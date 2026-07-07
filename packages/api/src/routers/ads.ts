import { publicProcedure, router } from "../orpc";
import { getAdStatsSummary, getAdStatsByDateRange } from "@psi-opora/db/queries";

export const adsRouter = router({
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
});
