import { publicProcedure, router } from "../orpc";
import { emailProviderSchema, rusenderSettingsSchema } from "../schemas/rusender";
import { unisenderSettingsSchema } from "../schemas/unisender";
import { smtpBzSettingsSchema } from "../schemas/smtp-bz";
import { resendSettingsSchema } from "../schemas/resend";
import {
  getEmailProvider,
  getResendSettings,
  getRusenderSettings,
  getSmtpBzSettings,
  getUnisenderSettings,
  setEmailProvider,
  upsertResendSettings,
  upsertRusenderSettings,
  upsertSmtpBzSettings,
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

  getRusenderSettings: publicProcedure.handler(async () => {
    return getRusenderSettings();
  }),

  upsertRusenderSettings: publicProcedure
    .input(rusenderSettingsSchema)
    .handler(async ({ input }) => {
      await upsertRusenderSettings(input);
      return { ok: true };
    }),

  getSmtpBzSettings: publicProcedure.handler(async () => {
    return getSmtpBzSettings();
  }),

  upsertSmtpBzSettings: publicProcedure
    .input(smtpBzSettingsSchema)
    .handler(async ({ input }) => {
      await upsertSmtpBzSettings(input);
      return { ok: true };
    }),

  getResendSettings: publicProcedure.handler(async () => {
    return getResendSettings();
  }),

  upsertResendSettings: publicProcedure
    .input(resendSettingsSchema)
    .handler(async ({ input }) => {
      await upsertResendSettings(input);
      return { ok: true };
    }),

  getProvider: publicProcedure.handler(async () => {
    return { provider: await getEmailProvider() };
  }),

  setProvider: publicProcedure
    .input(emailProviderSchema)
    .handler(async ({ input }) => {
      await setEmailProvider(input.provider);
      return { ok: true };
    }),
});
