import { publicProcedure, router } from "../orpc";
import { unisenderSettingsSchema } from "../schemas/unisender";
import {
  getUnisenderSettings,
  upsertUnisenderSettings,
} from "@psi-opora/db/queries";

export const emailRouter = router({
  getSettings: publicProcedure.handler(async () => {
    return getUnisenderSettings();
  }),

  upsertSettings: publicProcedure
    .input(unisenderSettingsSchema)
    .handler(async ({ input }) => {
      await upsertUnisenderSettings(input);
      return { ok: true };
    }),
});
