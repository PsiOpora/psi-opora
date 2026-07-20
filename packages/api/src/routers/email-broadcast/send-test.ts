import { publicProcedure } from "../../orpc";
import { sendTestEmailSchema } from "../../schemas/broadcast";
import { getUnisenderContext } from "./unisender-context";

/** Тестовая отправка письма шаблона на один адрес — минуя список/кампанию Unisender. */
export const sendTest = publicProcedure
  .input(sendTestEmailSchema)
  .handler(async ({ input }) => {
    const ctx = await getUnisenderContext();
    if (!ctx) return { ok: false, error: "Unisender не настроен" };
    if (!ctx.settings.senderEmail) {
      return {
        ok: false,
        error: "Не задан email отправителя — см. /settings/email",
      };
    }
    const subject = input.subject.trim();
    if (!subject) return { ok: false, error: "Тема письма пуста" };
    if (!input.email) return { ok: false, error: "У контакта нет email" };

    try {
      const template = await ctx.client.getTemplate(input.templateId);
      await ctx.client.sendEmail({
        email: input.email,
        senderName: ctx.settings.senderName ?? "",
        senderEmail: ctx.settings.senderEmail,
        subject,
        body: template.body,
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });
