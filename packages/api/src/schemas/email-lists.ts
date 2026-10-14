import { z } from "zod";

/** Максимум контактов в одном запросе импорта — клиент режет файл на пачки. */
export const EMAIL_IMPORT_BATCH_SIZE = 1000;

/** Нормализованный вид адреса: по нему дедупликация и стоп-лист. */
export function normalizeEmail(raw: string): string {
	return raw.trim().toLowerCase();
}

/**
 * Прагматичная проверка адреса: одна "@", непустая локальная часть, домен
 * с точкой и TLD из букв, без пробелов и двойных точек. RFC 5322 допускает
 * больше, но такие адреса на практике — опечатки, а отправка на них портит
 * репутацию домена отказами.
 */
const EMAIL_RE =
	/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[a-z0-9а-яё](?:[a-z0-9а-яё-]{0,61}[a-z0-9а-яё])?\.)+[a-zа-яё]{2,}$/i;

export function isValidEmail(email: string): boolean {
	if (email.length > 254 || email.includes("..")) return false;
	const local = email.split("@")[0] ?? "";
	if (local.length > 64 || local.startsWith(".") || local.endsWith("."))
		return false;
	return EMAIL_RE.test(email);
}

export const emailListIdSchema = z.object({ id: z.string().min(1) });

export const saveEmailListSchema = z.object({
	name: z.string().trim().min(1, "Введите название списка").max(200),
	description: z.string().trim().max(1000).optional(),
});
export type SaveEmailListInput = z.infer<typeof saveEmailListSchema>;

export const updateEmailListSchema = saveEmailListSchema.extend({
	id: z.string().min(1),
});

export const emailListContactsQuerySchema = z.object({
	listId: z.string().min(1),
	search: z.string().max(200).optional(),
	filter: z.enum(["all", "active", "suppressed"]).default("all"),
	page: z.number().int().min(0).default(0),
	pageSize: z.number().int().min(1).max(200).default(50),
});

export const importEmailListContactsSchema = z.object({
	listId: z.string().min(1),
	source: z.enum(["csv", "manual"]),
	contacts: z
		.array(
			z.object({
				email: z.string().max(320),
				name: z.string().max(300).optional(),
			}),
		)
		.min(1)
		.max(EMAIL_IMPORT_BATCH_SIZE),
});
export type ImportEmailListContactsInput = z.infer<
	typeof importEmailListContactsSchema
>;

export const removeEmailListContactsSchema = z.object({
	listId: z.string().min(1),
	ids: z.array(z.string().min(1)).min(1).max(1000),
});

export const emailSuppressionsQuerySchema = z.object({
	search: z.string().max(200).optional(),
	page: z.number().int().min(0).default(0),
	pageSize: z.number().int().min(1).max(200).default(50),
});

export const addEmailSuppressionSchema = z.object({
	email: z
		.string()
		.transform(normalizeEmail)
		.refine(isValidEmail, "Некорректный email"),
});

export const removeEmailSuppressionSchema = z.object({
	email: z.string().min(1),
});

export const emailCampaignIdSchema = z.object({ id: z.string().min(1) });

export const EMAIL_RECIPIENT_FILTER_VALUES = [
	"all",
	"sent",
	"delivered",
	"opened",
	"clicked",
	"not_opened",
	"bounced",
	"complained",
	"unsubscribed",
	"error",
	"skipped",
	"pending",
] as const;

export const emailCampaignRecipientsQuerySchema = z.object({
	id: z.string().min(1),
	filter: z.enum(EMAIL_RECIPIENT_FILTER_VALUES).default("all"),
	search: z.string().max(200).optional(),
	page: z.number().int().min(0).default(0),
	pageSize: z.number().int().min(1).max(200).default(50),
});

export const emailRecipientIdSchema = z.object({
	recipientId: z.string().min(1),
});
