import { publicProcedure } from "../../orpc";
import { sendTestEmailSchema } from "../../schemas/broadcast";
import { getActiveEmailSender } from "./active-sender";
import { getUnisenderContext } from "./unisender-context";

/** Тестовая отправка письма шаблона на один адрес — минуя список/кампанию провайдера. */
export const sendTest = publicProcedure
  .input(sendTestEmailSchema)
  .handler(async ({ input }) => {
    const templateCtx = await getUnisenderContext();
    if (!templateCtx) {
      return {
        ok: false,
        error: "Unisender не настроен — шаблоны берутся оттуда, см. /settings/email",
      };
    }
    const sender = await getActiveEmailSender();
    if ("error" in sender) return { ok: false, error: sender.error };

    const subject = input.subject.trim();
    if (!subject) return { ok: false, error: "Тема письма пуста" };
    if (!input.email) return { ok: false, error: "У контакта нет email" };

    try {
      const template = await templateCtx.client.getTemplate(input.templateId);
      await sender.sendEmail({
        email: input.email,
        subject,
        body: template.body,
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
