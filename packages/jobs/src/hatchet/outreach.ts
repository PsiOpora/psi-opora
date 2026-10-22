import {
	ConcurrencyLimitStrategy,
	CreateTaskWorkflow,
} from "@hatchet-dev/typescript-sdk/v1";
import { sleep } from "../messenger";
import { createBotSender } from "../outreach/bot-sender";
import { createBotTargetLookup } from "../outreach/bot-targets";
import {
	ChannelBreaker,
	isBotChannel,
	type MessengerChannel,
	type OutreachSender,
	type PersonalChannel,
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
const CONTINUATION_RETRY_MS = 60_000;
/**
 * Пауза после каждого контакта с телефоном, если включены боты: на каждый
 * номер — поиск в CRM (2–3 запроса), а лимит Bitrix24 — ~2 запроса в секунду.
 * Паузы личных номеров считает их темп (pacing.ts), эта — только для CRM.
 */
const BOT_LOOKUP_PAUSE_MS = 1000;

/** Журнал bot_messages: под этими messenger лежат диалоги ботов и личных номеров. */
const JOURNAL_MESSENGER: Record<MessengerChannel, string> = {
	max_bot: "max",
	telegram_bot: "telegram",
	max: "max-personal",
	telegram: "telegram-personal",
	whatsapp: "whatsapp-personal",
};

const SENDER_FACTORY: Record<
	PersonalChannel,
	(account: PersonalAccountRef) => OutreachSender
> = {
	max: createMaxSender,
	telegram: createTelegramSender,
	whatsapp: createWhatsappSender,
};

/**
 * Рассылка по списку контактов: каждому получателю сообщение пробуется
 * сначала через ботов MAX → Telegram (если этот телефон уже писал боту, см.
 * outreach/bot-targets.ts), затем с личных номеров в заданном порядке (см.
 * outreach/cascade.ts) с соблюдением темпа каждого номера
 * (outreach/pacing.ts), а тех, до кого
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
		const senders: OutreachSender[] = [];
		if (plan.useBots) {
			// Бот пишет только тем, кто сам открывал с ним диалог, и не рискует
			// баном личного номера — поэтому всегда первым. Поиск по телефону
			// общий для обоих ботов.
			const findTargets = await createBotTargetLookup(memberId);
			senders.push(createBotSender("max_bot", findTargets));
			senders.push(createBotSender("telegram_bot", findTargets));
		}
		for (const c of plan.channels) {
			const account = accounts[c.channel];
			if (account)
				senders.push(SENDER_FACTORY[c.channel]({ memberId, ...account }));
		}
		// Темп номера — с учётом сегодняшних отправок всех рассылок.
		const usage = await getOutreachAccountUsage(moscowDayStart(new Date()));
		const pacers = new Map<PersonalChannel, ChannelPacer>();
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
		/** Продолжение — отложенным запуском, при сбое планировщика — после паузы. */
		const continueLater = async (until: Date, reason: string) => {
			try {
				await getHatchetClient().scheduled.create(WORKFLOW_NAME, {
					triggerAt: until,
					input: payload,
				});
			} catch (err) {
				console.error(
					`[outreach] не удалось отложить запуск, повторим после паузы: ${(err as Error).message}`,
				);
				// Долгое ожидание превысит тайм-аут задачи; следующий запуск
				// снова проверит окно отправки и лимиты перед доставкой.
				await sleep(
					Math.min(
						CONTINUATION_RETRY_MS,
						Math.max(0, until.getTime() - Date.now()),
					),
				);
				await getHatchetClient().runNoWait(deliverOutreach, payload);
				return;
			}
			try {
				await setOutreachCampaignPause(campaign.id, {
					resumeAt: until,
					reason,
				});
			} catch (err) {
				console.error(
					`[outreach] запуск отложен, но не удалось записать паузу: ${(err as Error).message}`,
				);
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
						const account = isBotChannel(result.channel)
							? null
							: accounts[result.channel];
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
					if (plan.useBots && recipient.phone) {
						await sleep(BOT_LOOKUP_PAUSE_MS);
					}
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
