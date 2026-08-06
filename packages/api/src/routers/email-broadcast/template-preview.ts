import { getEmailTemplate } from "@psi-opora/db/queries";
import { renderEmailTemplate } from "../../email-template-render";
import { publicProcedure } from "../../orpc";
import { templatePreviewSchema } from "../../schemas/broadcast";

export const templatePreview = publicProcedure
  .input(templatePreviewSchema)
  .handler(async ({ input }) => {
    const template = await getEmailTemplate(input.templateId);
    if (!template) return { error: "Шаблон не найден" };
    const body = renderEmailTemplate(template.htmlBody, {
      name: "Иван Иванов",
      email: "ivan@example.com",
    });
    return { subject: template.subject, body };
  });
