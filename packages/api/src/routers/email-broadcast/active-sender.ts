import { getEmailProvider } from "@psi-opora/db/queries";
import { getRusenderContext } from "./rusender-context";
import { getUnisenderContext } from "./unisender-context";

export type ActiveEmailSender = {
  provider: "unisender" | "rusender";
  senderEmail: string;
  senderName?: string;
  sendEmail(params: {
    email: string;
    subject: string;
    body: string;
  }): Promise<void>;
};

/**
 * Настройки и клиент отправки для текущего активного провайдера
 * (переключается на /settings/email, по умолчанию Rusender).
 * Шаблоны (getTemplates/getTemplate) остаются только у Unisender — см.
 * unisender-context.ts — независимо от того, кто реально отправляет письма.
 */
export async function getActiveEmailSender(): Promise<
  ActiveEmailSender | { error: string }
> {
  const provider = await getEmailProvider();

  if (provider === "rusender") {
    const ctx = await getRusenderContext();
    if (!ctx) return { error: "Rusender не настроен — см. /settings/email" };
    if (!ctx.settings.senderEmail) {
      return { error: "Не задан email отправителя — см. /settings/email" };
    }
    return {
      provider,
      senderEmail: ctx.settings.senderEmail,
      senderName: ctx.settings.senderName ?? undefined,
      sendEmail: async ({ email, subject, body }) => {
        await ctx.client.sendEmail({
          email,
          senderName: ctx.settings.senderName ?? "",
          senderEmail: ctx.settings.senderEmail as string,
          subject,
          body,
        });
      },
    };
  }

  const ctx = await getUnisenderContext();
  if (!ctx) return { error: "Unisender не настроен — см. /settings/email" };
  if (!ctx.settings.senderEmail) {
    return { error: "Не задан email отправителя — см. /settings/email" };
  }
  return {
    provider,
    senderEmail: ctx.settings.senderEmail,
    senderName: ctx.settings.senderName ?? undefined,
    sendEmail: async ({ email, subject, body }) => {
      await ctx.client.sendEmail({
        email,
        senderName: ctx.settings.senderName ?? "",
        senderEmail: ctx.settings.senderEmail as string,
        subject,
        body,
      });
    },
  };
}
