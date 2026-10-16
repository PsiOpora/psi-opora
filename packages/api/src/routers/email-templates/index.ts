import { ORPCError } from "@orpc/server";
import {
	deleteEmailTemplate,
	getEmailTemplate,
	hasActiveEmailCampaignForTemplate,
	listEmailTemplates,
	saveEmailTemplate,
} from "@psi-opora/db/queries";
import {
	CAMPAIGN_TEMPLATES,
	type CampaignTemplateDef,
	renderCampaignTemplate,
} from "@psi-opora/emails";
import { bitrixProcedure, router } from "../../orpc";
import {
	emailTemplateIdSchema,
	renderTemplatePreviewSchema,
	saveEmailTemplateSchema,
} from "../../schemas/email-templates";

export type CampaignTemplateSummary = Omit<CampaignTemplateDef, "component">;
export type { CampaignTemplateFieldDef } from "@psi-opora/emails";

export const emailTemplatesRouter = router({
	list: bitrixProcedure.handler(async () => {
		return listEmailTemplates();
	}),

	get: bitrixProcedure
		.input(emailTemplateIdSchema)
		.handler(async ({ input }) => {
			return getEmailTemplate(input.id);
		}),

	save: bitrixProcedure
		.input(saveEmailTemplateSchema)
		.handler(async ({ input }) => {
			const template = await saveEmailTemplate(input);
			return { template };
		}),

	remove: bitrixProcedure
		.input(emailTemplateIdSchema)
		.handler(async ({ input }) => {
			const inUse = await hasActiveEmailCampaignForTemplate(input.id);
			if (inUse) {
				throw new ORPCError("CONFLICT", {
					message:
						"Шаблон используется в незавершённой рассылке — дождитесь её завершения перед удалением",
				});
			}
			await deleteEmailTemplate(input.id);
			return { ok: true };
		}),

	/** Готовые шаблоны (галерея выбора) — без React-компонента, только метаданные полей. */
	listDefs: bitrixProcedure.handler(
		async (): Promise<CampaignTemplateSummary[]> => {
			return CAMPAIGN_TEMPLATES.map(({ component, ...def }) => def);
		},
	),

	/** Превью каждого готового шаблона на примерных значениях — для миниатюр в галерее. */
	previewDefaults: bitrixProcedure.handler(async () => {
		return Promise.all(
			CAMPAIGN_TEMPLATES.map(async (def) => ({
				key: def.key,
				html: await renderCampaignTemplate(def.key, def.defaultValues),
			})),
		);
	}),

	/** Живое превью в редакторе — без подстановки {{name}}/{{email}}, они остаются видны как есть. */
	renderPreview: bitrixProcedure
		.input(renderTemplatePreviewSchema)
		.handler(async ({ input }) => {
			const html = await renderCampaignTemplate(
				input.templateKey,
				input.fields,
			);
			return { html };
		}),
});
