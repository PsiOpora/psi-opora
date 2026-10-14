import { ORPCError } from "@orpc/server";
import {
	addEmailListContacts,
	addEmailSuppression,
	createEmailList,
	deleteEmailList,
	deleteEmailListContacts,
	getEmailList,
	hasActiveEmailCampaignForList,
	listAllEmailListContacts,
	listEmailLists,
	listEmailListContactsPage,
	listEmailSuppressionsPage,
	removeEmailSuppression,
	updateEmailList,
} from "@psi-opora/db/queries";
import { bitrixProcedure, router } from "../../orpc";
import {
	addEmailSuppressionSchema,
	emailListContactsQuerySchema,
	emailListIdSchema,
	emailSuppressionsQuerySchema,
	importEmailListContactsSchema,
	isValidEmail,
	normalizeEmail,
	removeEmailListContactsSchema,
	removeEmailSuppressionSchema,
	saveEmailListSchema,
	updateEmailListSchema,
} from "../../schemas/email-lists";

async function requireList(id: string) {
	const list = await getEmailList(id);
	if (!list) {
		throw new ORPCError("NOT_FOUND", { message: "Список не найден" });
	}
	return list;
}

export interface ImportContactsResult {
	inserted: number;
	updated: number;
	/** Строки с некорректным адресом — показываются пользователю после импорта. */
	invalid: string[];
}

export const emailListsRouter = router({
	list: bitrixProcedure.handler(() => listEmailLists()),

	get: bitrixProcedure
		.input(emailListIdSchema)
		.handler(({ input }) => requireList(input.id)),

	create: bitrixProcedure
		.input(saveEmailListSchema)
		.handler(async ({ input }) => {
			const list = await createEmailList(input);
			if (!list) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: "База данных недоступна",
				});
			}
			return list;
		}),

	update: bitrixProcedure
		.input(updateEmailListSchema)
		.handler(async ({ input }) => {
			await requireList(input.id);
			await updateEmailList(input.id, input);
			return { ok: true };
		}),

	remove: bitrixProcedure
		.input(emailListIdSchema)
		.handler(async ({ input }) => {
			if (await hasActiveEmailCampaignForList(input.id)) {
				throw new ORPCError("CONFLICT", {
					message:
						"По списку идёт рассылка — дождитесь её завершения перед удалением",
				});
			}
			await deleteEmailList(input.id);
			return { ok: true };
		}),

	contacts: bitrixProcedure
		.input(emailListContactsQuerySchema)
		.handler(({ input }) =>
			listEmailListContactsPage({
				listId: input.listId,
				search: input.search,
				filter: input.filter,
				limit: input.pageSize,
				offset: input.page * input.pageSize,
			}),
		),

	/**
	 * Добавляет пачку контактов (до EMAIL_IMPORT_BATCH_SIZE). Файл разбирается
	 * в браузере, но адреса повторно нормализуются и проверяются здесь —
	 * клиенту не доверяем.
	 */
	importContacts: bitrixProcedure
		.input(importEmailListContactsSchema)
		.handler(async ({ input }): Promise<ImportContactsResult> => {
			await requireList(input.listId);
			const valid: Array<{ email: string; name?: string }> = [];
			const invalid: string[] = [];
			for (const contact of input.contacts) {
				const email = normalizeEmail(contact.email);
				if (isValidEmail(email)) {
					valid.push({ email, name: contact.name?.trim() || undefined });
				} else {
					invalid.push(contact.email);
				}
			}
			const { inserted, updated } = await addEmailListContacts(
				input.listId,
				valid,
				input.source,
			);
			return { inserted, updated, invalid };
		}),

	removeContacts: bitrixProcedure
		.input(removeEmailListContactsSchema)
		.handler(async ({ input }) => {
			const removed = await deleteEmailListContacts(input.listId, input.ids);
			return { removed };
		}),

	/** Все контакты списка — для выгрузки в CSV на клиенте. */
	exportContacts: bitrixProcedure
		.input(emailListIdSchema)
		.handler(async ({ input }) => {
			await requireList(input.id);
			const rows = await listAllEmailListContacts(input.id);
			return rows.map((r) => ({
				email: r.email,
				name: r.name,
				createdAt: r.createdAt,
				suppressionReason: r.suppressionReason,
			}));
		}),

	suppressions: router({
		list: bitrixProcedure
			.input(emailSuppressionsQuerySchema)
			.handler(({ input }) =>
				listEmailSuppressionsPage({
					search: input.search,
					limit: input.pageSize,
					offset: input.page * input.pageSize,
				}),
			),

		add: bitrixProcedure
			.input(addEmailSuppressionSchema)
			.handler(async ({ input }) => {
				await addEmailSuppression({ email: input.email, reason: "manual" });
				return { ok: true };
			}),

		/**
		 * Убирает адрес из стоп-листа. Отписавшимся снова слать нельзя без их
		 * согласия — интерфейс предупреждает об этом перед удалением.
		 */
		remove: bitrixProcedure
			.input(removeEmailSuppressionSchema)
			.handler(async ({ input }) => {
				await removeEmailSuppression(input.email);
				return { ok: true };
			}),
	}),
});
