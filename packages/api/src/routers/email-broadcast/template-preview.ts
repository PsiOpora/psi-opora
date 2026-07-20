import { publicProcedure } from "../../orpc";
import { templatePreviewSchema } from "../../schemas/broadcast";
import { getUnisenderContext } from "./unisender-context";

export const templatePreview = publicProcedure
  .input(templatePreviewSchema)
  .handler(async ({ input }) => {
    const ctx = await getUnisenderContext();
    if (!ctx) return { error: "Unisender не настроен — см. /settings/email" };
    try {
      const details = await ctx.client.getTemplate(input.templateId);
      return { subject: details.subject, body: details.body };
    } catch (err) {
      return { error: (err as Error).message };
    }
  });
