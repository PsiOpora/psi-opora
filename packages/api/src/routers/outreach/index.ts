import { ORPCError } from "@orpc/server";
import {
	cancelOutreachCampaign,
	createOutreachCampaign,
	finishOutreachCampaign,
	getEmailList,
	getEmailSuppressions,
	getEmailTemplate,
	getOutreachCampaign,
	getOutreachStats,
	insertOutreachRecipients,
	listAllEmailListContacts,
	listAllOutreachRecipients,
	listMaxPersonalAccounts,
	listOutreachCampaigns,
	listOutreachRecipientsPage,
	listTelegramPersonalAccounts,
	listWhatsappPersonalAccounts,
	type OutreachAccountRef,
	type OutreachAccounts,
} from "@psi-opora/db/queries";
import { enqueueOutreach } from "@psi-opora/jobs";
import { bitrixProcedure, router } from "../../orpc";
import { publicOriginFromHeaders } from "../../public-origin";
import {
	outreachIdSchema,
	outreachPreviewSchema,
	outreachRecipientsQuerySchema,
	sendOutreachSchema,
} from "../../schemas/outreach";
import { getActiveEmailSender } from "../email-broadcast/active-sender";

/** Личный номер, доступный для рассылки, — для выбора в форме. */
export interface OutreachAccountOption {
	openLineId: string;
	connectorId: string;
	phone: string;
	/** connected — можно выбирать; остальные показываются неактивными. */
	status: string;
}

export interface OutreachOptions {
	max: OutreachAccountOption[];
	telegram: OutreachAccountOption[];
	whatsapp: OutreachAccountOption[];
	/** Активный email-провайдер или причина, почему письма отправить нельзя. */
	email: { provider: string; senderEmail: string } | { error: string };
}

export interface OutreachPreview {
	total: number;
	/** С телефоном — по ним идёт каскад мессенджеров. */
	withPhone: number;
	/** Только email — им сразу уходит письмо (если email включён). */
	emailOnly: number;
	withEmail: number;
	/** Адреса в стоп-листе: письмо им не уйдёт. */
	suppressed: number;
}

function requireMember(memberId: string | null): string {
	if (!memberId) {
		throw new ORPCError("UNAUTHORIZED", {
			message: "Нет сессии Битрикс24 — обновите страницу",
		});
	}
	return memberId;
}

async function loadAccountOptions(memberId: string) {
	const [max, telegram, whatsapp] = await Promise.all([
		listMaxPersonalAccounts(memberId),
		listTelegramPersonalAccounts(memberId),
		listWhatsappPersonalAccounts(memberId),
	]);
	const toOption = (row: {
		openLineId: string;
		connectorId: string;
		phone: string;
		status: string;
	}): OutreachAccountOption => ({
		openLineId: row.openLineId,
		connectorId: row.connectorId,
		phone: row.phone,
		status: row.status,
	});
	return {
		max: max.map(toOption),
		telegram: telegram.map(toOption),
		whatsapp: whatsapp.map(toOption),
	};
}

export const outreachRouter = router({
	/** Подключённые личные номера и состояние email — для формы рассылки. */
	options: bitrixProcedure.handler(
		async ({ context }): Promise<OutreachOptions> => {
			const memberId = requireMember(context.memberId);
			const accounts = await loadAccountOptions(memberId);
			const sender = await getActiveEmailSender();
			return {
				...accounts,
				email:
					"error" in sender
						? { error: sender.error }
						: { provider: sender.provider, senderEmail: sender.senderEmail },
			};
		},
	),

	preview: bitrixProcedure
		.input(outreachPreviewSchema)
		.handler(async ({ input }): Promise<OutreachPreview> => {
			const list = await getEmailList(input.listId);
			if (!list) {
				throw new ORPCError("NOT_FOUND", { message: "Список не найден" });
			}
			const contacts = await listAllEmailListContacts(list.id);
			return {
				total: contacts.length,
				withPhone: contacts.filter((c) => c.phone).length,
				emailOnly: contacts.filter((c) => c.email && !c.phone).length,
				withEmail: contacts.filter((c) => c.email).length,
				suppressed: contacts.filter((c) => c.suppressionReason).length,
			};
		}),

	send: bitrixProcedure
		.input(sendOutreachSchema)
		.handler(async ({ input, context }) => {
			const memberId = requireMember(context.memberId);
			const list = await getEmailList(input.listId);
			if (!list) {
				throw new ORPCError("NOT_FOUND", { message: "Список не найден" });
			}

			// Номера сверяем с БД: из браузера приходят только их ID, а
			// подключён ли номер и принадлежит ли он порталу — решает сервер.
			const options = await loadAccountOptions(memberId);
			const pick = (
				channel: "max" | "telegram" | "whatsapp",
				label: string,
			): OutreachAccountRef | null => {
				const ref = input.accounts[channel];
				if (!ref) return null;
				const account = options[channel].find(
					(a) =>
						a.connectorId === ref.connectorId &&
						a.openLineId === ref.openLineId,
				);
				if (account?.status !== "connected") {
					throw new ORPCError("BAD_REQUEST", {
						message: `Личный номер ${label} не подключён — выберите другой или выключите канал`,
					});
				}
				return {
					openLineId: account.openLineId,
					connectorId: account.connectorId,
					phone: account.phone,
				};
			};
			const accounts: OutreachAccounts = {
				max: pick("max", "MAX"),
				telegram: pick("telegram", "Telegram"),
				whatsapp: pick("whatsapp", "WhatsApp"),
			};
			if (
				!accounts.max &&
				!accounts.telegram &&
				!accounts.whatsapp &&
				!input.email
			) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Включите хотя бы один канал",
				});
			}

			let email: {
				templateId: string;
				templateName: string | null;
				subject: string;
				senderEmail: string;
				senderName: string | null;
				provider: string;
			} | null = null;
			if (input.email) {
				const template = await getEmailTemplate(input.email.templateId);
				if (!template) {
					throw new ORPCError("BAD_REQUEST", {
						message: "Шаблон письма не найден",
					});
				}
				const sender = await getActiveEmailSender();
				if ("error" in sender) {
					throw new ORPCError("BAD_REQUEST", { message: sender.error });
				}
				email = {
					templateId: template.id,
					templateName: input.email.templateName ?? template.title,
					subject: input.email.subject,
					senderEmail: sender.senderEmail,
					senderName: sender.senderName ?? null,
					provider: sender.provider,
				};
			}

			const contacts = await listAllEmailListContacts(list.id);
			if (contacts.length !== input.expectedRecipients) {
				throw new ORPCError("CONFLICT", {
					message: `Состав списка изменился с момента предпросмотра (было ${input.expectedRecipients}, стало ${contacts.length}). Обновите предпросмотр.`,
				});
			}
			if (contacts.length === 0) {
				throw new ORPCError("BAD_REQUEST", { message: "Список пуст" });
			}

			// Адрес из стоп-листа не используем как email-фолбэк — отписавшимся
			// письма не шлём. Повторная проверка будет и в самой email-задаче.
			const suppressed = await getEmailSuppressions(
				contacts.map((c) => c.email).filter((e): e is string => !!e),
			);

			const campaignId = crypto.randomUUID();
			await createOutreachCampaign({
				id: campaignId,
				listId: list.id,
				listName: list.name,
				memberId,
				message: input.message,
				accounts,
				intervalSec: input.intervalSec,
				emailTemplateId: email?.templateId ?? null,
				emailTemplateName: email?.templateName ?? null,
				emailSubject: email?.subject ?? null,
				emailSenderEmail: email?.senderEmail ?? null,
				emailSenderName: email?.senderName ?? null,
				emailProvider: email?.provider ?? null,
				publicBaseUrl: publicOriginFromHeaders(context.headers),
				recipientsCount: contacts.length,
			});
			await insertOutreachRecipients(
				contacts.map((c) => {
					const emailSuppressed = c.email ? suppressed.has(c.email) : false;
					// Без телефона и с адресом из стоп-листа писать некуда — сразу
					// в отчёт как пропущенного, а не в очередь каскада.
					const unreachable = emailSuppressed && !c.phone;
					return {
						id: crypto.randomUUID(),
						campaignId,
						listContactId: c.id,
						name: c.name,
						phone: c.phone,
						email: emailSuppressed ? null : c.email,
						status: unreachable ? "skipped" : "pending",
						error: unreachable
							? "Нет телефона, а email в стоп-листе (отписался или недоступен)"
							: null,
					};
				}),
			);

			try {
				await enqueueOutreach({ campaignId });
			} catch (err) {
				await finishOutreachCampaign(campaignId, {
					status: "error",
					error: `Не удалось запустить фоновую задачу: ${(err as Error).message}`,
				});
				throw new ORPCError("INTERNAL_SERVER_ERROR", {
					message: `Рассылка не запущена: ${(err as Error).message}. Проверьте подключение Hatchet (HATCHET_CLIENT_TOKEN).`,
				});
			}
			return { campaignId, queued: contacts.length };
		}),

	list: bitrixProcedure.handler(() => listOutreachCampaigns()),

	get: bitrixProcedure.input(outreachIdSchema).handler(async ({ input }) => {
		const campaign = await getOutreachCampaign(input.id);
		if (!campaign) {
			throw new ORPCError("NOT_FOUND", { message: "Рассылка не найдена" });
		}
		return { ...campaign, stats: await getOutreachStats(campaign.id) };
	}),

	recipients: bitrixProcedure
		.input(outreachRecipientsQuerySchema)
		.handler(({ input }) =>
			listOutreachRecipientsPage({
				campaignId: input.id,
				filter: input.filter,
				search: input.search,
				limit: input.pageSize,
				offset: input.page * input.pageSize,
			}),
		),

	/** Все получатели — для выгрузки отчёта «кому что ушло» в CSV. */
	exportRecipients: bitrixProcedure
		.input(outreachIdSchema)
		.handler(({ input }) => listAllOutreachRecipients(input.id)),

	cancel: bitrixProcedure.input(outreachIdSchema).handler(async ({ input }) => {
		const cancelled = await cancelOutreachCampaign(input.id);
		if (!cancelled) {
			throw new ORPCError("CONFLICT", { message: "Рассылка уже завершена" });
		}
		return { ok: true };
	}),
});
