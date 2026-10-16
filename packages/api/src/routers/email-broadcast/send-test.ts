import { getEmailTemplate, renderEmailTemplate } from "@psi-opora/db/queries";
import { renderCampaignTemplate } from "@psi-opora/emails";
import { bitrixProcedure } from "../../orpc";
import { isValidEmail, normalizeEmail } from "../../schemas/email-lists";
import { sendTestEmailSchema } from "../../schemas/broadcast";
import { getActiveEmailSender } from "./active-sender";

/** Тестовая отправка письма шаблона на один адрес — минуя список/кампанию провайдера. */
export const sendTest = bitrixProcedure
	.input(sendTestEmailSchema)
	.handler(async ({ input }) => {
		const template = await getEmailTemplate(input.templateId);
		if (!template) return { ok: false, error: "Шаблон не найден" };

		const sender = await getActiveEmailSender();
		if ("error" in sender) return { ok: false, error: sender.error };

		const subject = input.subject.trim();
		if (!subject) return { ok: false, error: "Тема письма пуста" };
		const email = normalizeEmail(input.email);
		if (!email) return { ok: false, error: "У контакта нет email" };
		if (!isValidEmail(email)) return { ok: false, error: "Некорректный email" };

		const html = await renderCampaignTemplate(
			template.templateKey,
			template.fields,
		);
		if (!html) return { ok: false, error: "Неизвестный тип шаблона" };

		try {
			await sender.sendEmail({
				email,
				subject,
				body: renderEmailTemplate(html, {
					name: "Иван Иванов",
					email,
					// sendEmail Unisender отклоняет письмо без ссылки отписки и
					// подставляет только свой тег; у Rusender в тесте ссылка — заглушка.
					unsubscribeUrl:
						sender.provider === "unisender" ? "{{UnsubscribeUrl}}" : null,
				}),
			});
			return { ok: true };
		} catch (err) {
			return { ok: false, error: (err as Error).message };
		}
	});
