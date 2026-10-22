import { ORPCError } from "@orpc/server";
import {
	cancelOutreachCampaign,
	getEmailList,
	getOutreachCampaign,
	getOutreachStats,
	listAllEmailListContacts,
	listAllOutreachRecipients,
	listOutreachCampaigns,
	listOutreachRecipientsPage,
} from "@psi-opora/db/queries";
import { enqueueOutreach } from "@psi-opora/jobs";
import { bitrixProcedure, router } from "../../orpc";
import {
	outreachIdSchema,
	outreachPreviewSchema,
	outreachRecipientsQuerySchema,
} from "../../schemas/outreach";
import { getActiveEmailSender } from "../email-broadcast/active-sender";
import { sendOutreach } from "./send";
import {
	loadAccountOptions,
	loadBotOptions,
	type OutreachAccountOption,
	type OutreachBotOptions,
	recentlyContactedChecker,
	requireMember,
} from "./shared";

export type { OutreachAccountOption, OutreachBotOptions };

export interface OutreachOptions {
	/** Боты — первый этап: пишут тем, чей номер уже писал боту. */
	bots: OutreachBotOptions;
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
	/** Уже получали рассылку за dedupDays — будут пропущены. */
	recentlyContacted: number;
	/** С телефоном и не отсеяны повтором — столько сообщений пойдёт в мессенджеры. */
	messengerCandidates: number;
}

export const outreachRouter = router({
	/** Подключённые боты, личные номера и состояние email — для формы рассылки. */
	options: bitrixProcedure.handler(
		async ({ context }): Promise<OutreachOptions> => {
			const memberId = requireMember(context.memberId);
			const [accounts, bots, sender] = await Promise.all([
				loadAccountOptions(memberId),
				loadBotOptions(),
				getActiveEmailSender(),
			]);
			return {
				bots,
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
			const wasContacted = await recentlyContactedChecker(
				contacts,
				input.dedupDays,
			);
			const recent = contacts.filter(wasContacted);
			return {
				total: contacts.length,
				withPhone: contacts.filter((c) => c.phone).length,
				emailOnly: contacts.filter((c) => c.email && !c.phone).length,
				withEmail: contacts.filter((c) => c.email).length,
				suppressed: contacts.filter((c) => c.suppressionReason).length,
				recentlyContacted: recent.length,
				messengerCandidates:
					contacts.filter((c) => c.phone).length -
					recent.filter((c) => c.phone).length,
			};
		}),

	send: sendOutreach,

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
		const campaign = await getOutreachCampaign(input.id);
		const cancelled = await cancelOutreachCampaign(input.id);
		if (!cancelled) {
			throw new ORPCError("CONFLICT", { message: "Рассылка уже завершена" });
		}
		// Рассылка ждала отложенного запуска (ночь, лимит) — будим задачу
		// сейчас, чтобы письма тем, кому мессенджеры не дошли, ушли сразу.
		if (campaign?.resumeAt && campaign.resumeAt > new Date()) {
			await enqueueOutreach({ campaignId: input.id }).catch((err: unknown) => {
				console.error(
					`[outreach] не удалось запустить задачу после отмены: ${(err as Error).message}`,
				);
			});
		}
		return { ok: true };
	}),
});
