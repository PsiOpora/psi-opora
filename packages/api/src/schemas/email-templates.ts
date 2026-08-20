import { z } from "zod";

export const emailTemplateIdSchema = z.object({ id: z.string() });

export const saveEmailTemplateSchema = z.object({
	id: z.string().optional(),
	title: z.string().min(1),
	subject: z.string().min(1),
	templateKey: z.string().min(1),
	fields: z.record(z.string(), z.string()),
});
export type SaveEmailTemplateInput = z.infer<typeof saveEmailTemplateSchema>;

export const renderTemplatePreviewSchema = z.object({
	templateKey: z.string().min(1),
	fields: z.record(z.string(), z.string()),
});
