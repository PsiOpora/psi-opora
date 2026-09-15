import { getEmailTemplate, renderEmailTemplate } from "@psi-opora/db/queries";
import { renderCampaignTemplate } from "@psi-opora/emails";
import { publicProcedure } from "../../orpc";
import { templatePreviewSchema } from "../../schemas/broadcast";

export const templatePreview = publicProcedure
	.input(templatePreviewSchema)
	.handler(async ({ input }) => {
		const template = await getEmailTemplate(input.templateId);
		if (!template) return { error: "Шаблон не найден" };
		const html = await renderCampaignTemplate(
			template.templateKey,
			template.fields,
		);
		if (!html) return { error: "Неизвестный тип шаблона" };
		const body = renderEmailTemplate(html, {
			name: "Иван Иванов",
			email: "ivan@example.com",
		});
		return { subject: template.subject, body };
	});
