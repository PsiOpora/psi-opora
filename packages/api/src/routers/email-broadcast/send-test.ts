import { getEmailTemplate, renderEmailTemplate } from "@psi-opora/db/queries";
import { publicProcedure } from "../../orpc";
import { sendTestEmailSchema } from "../../schemas/broadcast";
import { getActiveEmailSender } from "./active-sender";

/** Тестовая отправка письма шаблона на один адрес — минуя список/кампанию провайдера. */
export const sendTest = publicProcedure
  .input(sendTestEmailSchema)
  .handler(async ({ input }) => {
    const template = await getEmailTemplate(input.templateId);
    if (!template) return { ok: false, error: "Шаблон не найден" };

    const sender = await getActiveEmailSender();
    if ("error" in sender) return { ok: false, error: sender.error };

    const subject = input.subject.trim();
    if (!subject) return { ok: false, error: "Тема письма пуста" };
    if (!input.email) return { ok: false, error: "У контакта нет email" };

    try {
      await sender.sendEmail({
        email: input.email,
        subject,
        body: renderEmailTemplate(template.htmlBody, {
          name: "Иван Иванов",
          email: input.email,
        }),
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
