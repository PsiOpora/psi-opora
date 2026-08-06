import { z } from "zod";

export const emailTemplateIdSchema = z.object({ id: z.string() });

export const saveEmailTemplateSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  subject: z.string().min(1),
  htmlBody: z.string().min(1),
});
export type SaveEmailTemplateInput = z.infer<typeof saveEmailTemplateSchema>;
