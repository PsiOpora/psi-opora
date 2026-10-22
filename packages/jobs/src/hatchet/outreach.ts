import {
	ConcurrencyLimitStrategy,
	CreateTaskWorkflow,
} from "@hatchet-dev/typescript-sdk/v1";
import { sleep } from "../messenger";
import {
	ChannelBreaker,
	type MessengerChannel,
	type OutreachSender,
	personalizeMessage,
	runCascade,
} from "../outreach/cascade";
import {
	ChannelPacer,
	moscowDayStart,
	resolveOutreachPlan,
} from "../outreach/pacing";
import { createPacingGate, createWaiter } from "../outreach/scheduler";
import {
	createMaxSender,
	createTelegramSender,
	createWhatsappSender,
	type PersonalAccountRef,
} from "../outreach/senders";
import { getHatchetClient } from "./client";
import { startEmailFallback } from "./outreach-email";

export type DeliverOutreachPayload = {
	campaignId: string;
};

/**
 * Сколько задача работает до передачи эстафеты следующему запуску. Паузы
 * между сообщениями личных номеров — десятки секунд, список в тысячу
 * контактов идёт часами; вместо одного многочасового запуска задача
 * перезапускает сама себя (обрабатываются только pending — продолжение,
 * а не повтор). Ожидания длиннее бюджета (окно отправки, дневной лимит)
 * становятся отложенным запуском.
 */
const RUN_BUDGET_MS = 50 * 60 * 1000;
const BATCH_SIZE = 100;
const WORKFLOW_NAME = "outreach-deliver";

/** Журнал bot_messages: под этими messenger лежат диалоги личных номеров. */
const JOURNAL_MESSENGER: Record<MessengerChannel, string> = {
	max: "max-personal",
	telegram: "telegram-personal",
	whatsapp: "whatsapp-personal",
};

const SENDER_FACTORY: Record<
	MessengerChannel,
	(account: PersonalAccountRef) => OutreachSender
> = {
	max: createMaxSender,
	telegram: createTelegramSender,
	whatsapp: createWhatsappSender,
};

/**
 * Рассылка по списку контактов через личные номера: каждому получателю
 * сообщение пробуется по каналам в заданном порядке (см. outreach/cascade.ts)
 * с соблюдением темпа каждого номера (outreach/pacing.ts), а тех, до кого
 * не дошло ни одно, в конце передаём в обычную email-кампанию — так письма
 * получают отписку, стоп-лист и статистику открытий/доставки email-рассылок.
 */
export const deliverOutreach = CreateTaskWorkflow({
	name: WORKFLOW_NAME,
	retries: 0,
	executionTimeout: "1h",
	scheduleTimeout: "24h",
	// Одна рассылка за раз: личные номера общие для всех рассылок, параллельные
	// запуски удвоили бы темп и риск бана номера.
	concurrency: {
		expression: "'outreach-deliver'",
		maxRuns: 1,
		limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
	},
	fn: async (payload: DeliverOutreachPayload) => {
		// Ленивый импорт — см. комментарий в hatchet/broadcast.ts.
		const {
			finishOutreachCampaign,
			getOutreachAccountUsage,
			getOutreachCampaign,
			insertBotMessage,
			listOutreachRecipientsByStatus,
			markInterruptedOutreachRecipients,
			markOutreachCampaignRunning,
			setOutreachCampaignPause,
			updateOutreachRecipient,
		} = await import("@psi-opora/db/queries");

		const campaign = await getOutreachCampaign(payload.campaignId);
		if (!campaign) {
			throw new Error(`Рассылка ${payload.campaignId} не найдена`);
		}
		if (campaign.status === "cancelled") {
			// Отменили до запуска или между перезапусками — письма тем, кому
			// мессенджеры уже не дошли, всё равно уходят.
			const emailed = await startEmailFallback(campaign.id);
			return { cancelled: true, emailed };
		}
		if (campaign.status !== "queued" && campaign.status !== "running") {
			return { skipped: campaign.status };
		}

		const startedAt = Date.now();
		const runEnd = startedAt + RUN_BUDGET_MS;
		await markOutreachCampaignRunning(campaign.id);
		await markInterruptedOutreachRecipients(campaign.id);

		const { accounts, memberId } = campaign;
		const plan = resolveOutreachPlan(campaign);
		const senders = plan.channels.flatMap((c) => {
			const account = accounts[c.channel];
			return account
				? [SENDER_FACTORY[c.channel]({ memberId, ...account })]
				: [];
		});
		// Темп номера — с учётом сегодняшних отправок всех рассылок.
		const usage = await getOutreachAccountUsage(moscowDayStart(new Date()));
		const pacers = new Map<MessengerChannel, ChannelPacer>();
		for (const pacing of plan.channels) {
			const connectorId = accounts[pacing.channel]?.connectorId;
			const used = usage.find(
				(u) => u.channel === pacing.channel && u.connectorId === connectorId,
			);
			pacers.set(
				pacing.channel,
				new ChannelPacer(pacing, {
					attemptsToday: used?.attempts ?? 0,
					lastAt: used?.lastAt ?? null,
					now: new Date(),
				}),
			);
		}
		const emailEnabled = Boolean(campaign.emailTemplateId);
		const breaker = new ChannelBreaker();

		const isCancelled = async () =>
			(await getOutreachCampaign(campaign.id))?.status === "cancelled";
		const waitUntil = createWaiter({
			runEnd,
			isCancelled,
			setPause: (pause) => setOutreachCampaignPause(campaign.id, pause),
			sleep,
		});
		// Email-фазу пробуем один раз за запуск: если она сама упала, повтор
		// из catch создал бы ещё одну пустую email-кампанию.
		let emailPhaseStarted = false;
		const runEmailPhase = () => {
			emailPhaseStarted = true;
			return startEmailFallback(campaign.id);
		};
		/** Продолжение — отложенным запуском (или сразу, если отложить не вышло). */
		const continueLater = async (until: Date, reason: string) => {
			try {
				await getHatchetClient().scheduled.create(WORKFLOW_NAME, {
					triggerAt: until,
					input: payload,
				});
				await setOutreachCampaignPause(campaign.id, {
					resumeAt: until,
					reason,
				});
			} catch (err) {
				console.error(
					`[outreach] не удалось отложить запуск, продолжаем сразу: ${(err as Error).message}`,
				);
				await getHatchetClient().runNoWait(deliverOutreach, payload);
			}
		};

		try {
			let processed = 0;
			for (;;) {
				const batch = await listOutreachRecipientsByStatus(
					campaign.id,
					"pending",
					BATCH_SIZE,
				);
				if (batch.length === 0) break;

				for (const recipient of batch) {
					if (Date.now() > runEnd) {
						await getHatchetClient().runNoWait(deliverOutreach, payload);
						return { processed, continued: true };
					}
					if (await isCancelled()) {
						const emailed = await runEmailPhase();
						return { processed, cancelled: true, emailed };
					}

					const text = personalizeMessage(campaign.message, recipient.name);
					const pacing = createPacingGate({
						plan,
						pacers,
						waitUntil,
						onSend: (attempts) =>
							updateOutreachRecipient(recipient.id, {
								status: "sending",
								attempts,
							}),
					});
					const result = await runCascade({
						phone: recipient.phone,
						email: recipient.email,
						text,
						senders,
						breaker,
						emailEnabled,
						previousAttempts: recipient.attempts,
						gate: pacing.gate,
					});

					if (result.status === "interrupted") {
						const stop = pacing.takeStopReason();
						if (stop?.kind === "handoff") {
							// Получатель продолжит с того канала, на котором остановились.
							await updateOutreachRecipient(recipient.id, {
								status: "pending",
								attempts: result.attempts,
							});
							await continueLater(stop.until, stop.reason);
							return {
								processed,
								continued: true,
								resumeAt: stop.until.toISOString(),
							};
						}
						await updateOutreachRecipient(recipient.id, {
							status: "skipped",
							attempts: result.attempts,
							error: "Рассылка отменена",
						});
						const emailed = await runEmailPhase();
						return { processed, cancelled: true, emailed };
					}

					if (result.status === "sent") {
						await updateOutreachRecipient(recipient.id, {
							status: "sent",
							channel: result.channel,
							attempts: result.attempts,
							externalId: result.externalId ?? null,
							error: null,
							sentAt: new Date(),
						});
						// Журнал сообщений — рассылка видна в истории диалога в инбоксе.
						const account = accounts[result.channel];
						await insertBotMessage({
							messenger: JOURNAL_MESSENGER[result.channel],
							userId: result.userId,
							direction: "out",
							source: "broadcast",
							text,
							status: "sent",
							externalId: result.externalId,
							connectorId: account?.connectorId,
						}).catch((err: unknown) => {
							console.error(
								`[outreach] не удалось записать сообщение в журнал: ${(err as Error).message}`,
							);
						});
					} else if (result.status === "email_pending") {
						await updateOutreachRecipient(recipient.id, {
							status: "email_pending",
							attempts: result.attempts,
							error: null,
						});
					} else {
						await updateOutreachRecipient(recipient.id, {
							status: result.status,
							attempts: result.attempts,
							error: result.error,
						});
					}
					processed++;
				}
			}

			const emailed = await runEmailPhase();
			await finishOutreachCampaign(campaign.id, { status: "done" });
			return { processed, emailed };
		} catch (err) {
			// Рассылка упала посреди списка — тем, кому мессенджеры уже не дошли,
			// письма всё равно отправляем: иначе они не получат ничего.
			let emailError = "";
			if (!emailPhaseStarted) {
				await runEmailPhase().catch((fallbackErr: unknown) => {
					emailError = `; письма тоже не отправлены: ${(fallbackErr as Error).message}`;
				});
			}
			await finishOutreachCampaign(campaign.id, {
				status: "error",
				error: `${(err as Error).message}${emailError}`,
			});
			throw err;
		}
	},
});
