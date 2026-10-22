import { ORPCError } from "@orpc/server";
import {
	createOutreachCampaign,
	finishOutreachCampaign,
	getEmailList,
	getEmailSuppressions,
	getEmailTemplate,
	insertOutreachRecipients,
	listAllEmailListContacts,
	type OutreachAccounts,
	type OutreachSettings,
} from "@psi-opora/db/queries";
import { enqueueOutreach } from "@psi-opora/jobs";
import { bitrixProcedure } from "../../orpc";
import { publicOriginFromHeaders } from "../../public-origin";
import { sendOutreachSchema } from "../../schemas/outreach";
import { getActiveEmailSender } from "../email-broadcast/active-sender";
import {
	loadAccountOptions,
	loadBotOptions,
	recentlyContactedChecker,
	requireMember,
} from "./shared";

const CHANNEL_LABELS = {
	max: "MAX",
	telegram: "Telegram",
	whatsapp: "WhatsApp",
} as const;

export const sendOutreach = bitrixProcedure
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
		const accounts: OutreachAccounts = {
			max: null,
			telegram: null,
			whatsapp: null,
		};
		for (const ref of input.channels) {
			const account = options[ref.channel].find(
				(a) =>
					a.connectorId === ref.connectorId && a.openLineId === ref.openLineId,
			);
			if (account?.status !== "connected") {
				throw new ORPCError("BAD_REQUEST", {
					message: `Личный номер ${CHANNEL_LABELS[ref.channel]} не подключён — выберите другой или выключите канал`,
				});
			}
			accounts[ref.channel] = {
				openLineId: account.openLineId,
				connectorId: account.connectorId,
				phone: account.phone,
			};
		}
		const bots = await loadBotOptions();
		const useBots = input.useBots && (bots.max || bots.telegram);
		if (!useBots && input.channels.length === 0 && !input.email) {
			throw new ORPCError("BAD_REQUEST", {
				message: "Включите хотя бы один канал",
			});
		}
		const settings: OutreachSettings = {
			useBots,
			bots,
			channels: input.channels.map((c) => ({
				channel: c.channel,
				minIntervalSec: c.minIntervalSec,
				maxIntervalSec: c.maxIntervalSec,
				dailyLimit: c.dailyLimit,
				batchSize: c.batchSize,
				batchPauseMin: c.batchPauseMin,
			})),
			onDailyLimit: input.onDailyLimit,
			window: input.window,
			dedupDays: input.dedupDays,
		};

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
		const wasContacted = await recentlyContactedChecker(
			contacts,
			input.dedupDays,
		);

		const campaignId = crypto.randomUUID();
		await createOutreachCampaign({
			id: campaignId,
			listId: list.id,
			listName: list.name,
			memberId,
			message: input.message,
			accounts,
			settings,
			intervalSec: input.channels[0]?.minIntervalSec ?? 0,
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
				// в отчёт как пропущенного, а не в очереди каскада.
				const skipReason = wasContacted(c)
					? `Уже получал рассылку за последние ${input.dedupDays} дн.`
					: emailSuppressed && !c.phone
						? "Нет телефона, а email в стоп-листе (отписался или недоступен)"
						: null;
				return {
					id: crypto.randomUUID(),
					campaignId,
					listContactId: c.id,
					name: c.name,
					phone: c.phone,
					email: emailSuppressed ? null : c.email,
					status: skipReason ? "skipped" : "pending",
					error: skipReason,
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
	});
