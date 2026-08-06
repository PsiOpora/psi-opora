import {
  deleteEmailTemplate,
  getEmailTemplate,
  listEmailTemplates,
  saveEmailTemplate,
} from "@psi-opora/db/queries";
import { publicProcedure, router } from "../../orpc";
import {
  emailTemplateIdSchema,
  saveEmailTemplateSchema,
} from "../../schemas/email-templates";

export const emailTemplatesRouter = router({
  list: publicProcedure.handler(async () => {
    return listEmailTemplates();
  }),

  get: publicProcedure
    .input(emailTemplateIdSchema)
    .handler(async ({ input }) => {
      return getEmailTemplate(input.id);
    }),

  save: publicProcedure
    .input(saveEmailTemplateSchema)
    .handler(async ({ input }) => {
      const template = await saveEmailTemplate(input);
      return { template };
    }),

  remove: publicProcedure
    .input(emailTemplateIdSchema)
    .handler(async ({ input }) => {
      await deleteEmailTemplate(input.id);
      return { ok: true };
    }),
});
