import {
	markBotMessageGuideEmailSent,
	upsertBotGuideDelivery,
} from "@psi-opora/db/queries";
import type { RedisClient } from "../storage/redis";
import { appendDealComment, createBitrixTask } from "../utils/bitrix";
import {
	submitBitrixContact,
	submitConsultationDeal,
} from "../utils/consultation-deal";
import { sendGuideEmail } from "../utils/email";
import { trackFunnelStep } from "../utils/funnel";
import { buildGuideTrackingUrl } from "../utils/guide-link";
import { logBotMessage } from "../utils/message-log";
import {
	describeLead,
	type GuideCampaignContext,
	type ScenarioMessage,
	type ScenarioOutput,
} from "./engine";
import { clearScenarioAwaiting, markScenarioAwaiting } from "./reminders";
import { resolveGuideFile, type ScenarioTexts } from "./texts";

export interface ScenarioDispatchDeps {
	messenger: string;
	/** Ключ сессии в storage: chat id (TG) / user id (MAX). */
	sessionKey: string;
	/** Redis для регистрации напоминаний; без него напоминания отключены. */
	redis?: RedisClient | null;
	sendMessage: (message: ScenarioMessage) => Promise<void>;
	texts: ScenarioTexts;
	/** Имя из профиля мессенджера — попадает в сделку. */
	userName?: string;
	userId?: number;
	/** Внешний ID чата (тот же, что передаётся в imconnector.send.messages
	 * как chat.id) — нужен для привязки сделки к диалогу Открытой линии. */
	chatId?: number;
	source?: string;
	campaign?: string;
	/** Данные кампании гайда при out.state.campaignId — переопределяет тему/текст письма и фиксирует выдачу. */
	guideCampaign?: GuideCampaignContext | null;
}

/** Что именно клиент получил вместе с материалом — для комментария в сделке. */
interface GuideHandout {
	/** Тема кампании; пусто для глобального «активного» гайда. */
	title?: string;
	fileName: string;
	url: string;
	/** Ссылка ушла в чат (Telegram) — по ней и трекаются открытия. */
	linkInChat: boolean;
	email?: string;
	emailSentAt?: Date;
	emailError?: string;
}

/**
 * Комментарий о выдаче материала. Оператору важны три вещи: что выдали, ушло
 * ли письмо и есть ли у клиента ссылка (по ней потом видно открытие).
 */
function describeGuideHandout(handout: GuideHandout): string {
	const what = handout.title
		? `«${handout.title}» (${handout.fileName})`
		: handout.fileName;
	const lines = [`📄 Материал выдан: ${what}`];

	if (handout.emailSentAt) {
		lines.push(`Письмо с PDF отправлено на ${handout.email}.`);
	} else if (handout.emailError) {
		lines.push(
			`Письмо на ${handout.email} отправить не удалось: ${handout.emailError}`,
		);
	} else if (!handout.email) {
		lines.push("Email клиент не оставил — письмо не отправлялось.");
	}

	if (handout.linkInChat) {
		lines.push(`Ссылка в чате: ${handout.url}`);
	}

	return lines.join("\n");
}

/** true — материал ушёл без письма на почту (не оставил email или отправка не удалась). */
function guideHandoutNeedsEmailEscalation(handout: GuideHandout): boolean {
	return !handout.email || Boolean(handout.emailError);
}

/**
 * Заводит в Bitrix24 задачу ответственному менеджеру: бот не смог отправить
 * материал на email, значит клиенту нужно написать/позвонить и уточнить
 * адрес или прислать материал другим способом. Без этого шага о проблеме
 * узнают только случайно, при просмотре переписки (см. describeGuideHandout).
 */
async function escalateMissingGuideEmail(
	deps: ScenarioDispatchDeps,
	dealId: number,
	comment: string,
): Promise<void> {
	const client = [deps.userName, deps.userId ? `id ${deps.userId}` : undefined]
		.filter(Boolean)
		.join(", ");
	await createBitrixTask(deps.messenger, {
		title: `Уточнить email для гайда${client ? ` — ${client}` : ""}`,
		description: comment,
		dealId,
	});
}

/**
 * Исполняет результат шага сценария: отправляет сообщения, трекает воронку,
 * создаёт сделку в Bitrix и управляет очередью напоминаний.
 */
export async function dispatchScenarioOutput(
	out: ScenarioOutput,
	deps: ScenarioDispatchDeps,
): Promise<void> {
	// Кампания, в рамках которой выдаётся материал: по ней же строится id
	// выдачи (см. upsertBotGuideDelivery ниже), поэтому токен ссылки и строка
	// выдачи гарантированно сходятся.
	const campaignId =
		out.lead?.campaignId ?? out.state.campaignId ?? deps.guideCampaign?.id;

	// Факты выдачи материала для таймлайна сделки. Сделка на этот момент ещё
	// может не существовать (в обычном флоу гайда она создаётся позже, на шаге
	// телефона), поэтому комментарий формируем здесь, а отправляем ниже —
	// когда dealId известен.
	let handout: GuideHandout | null = null;

	for (const message of out.messages) {
		const guide = message.guide
			? await resolveGuideFile(message.guideId)
			: null;

		// Telegram не шлёт PDF отдельным документом (см. sendTelegramScenarioMessage) —
		// для гайда конкретной кампании (message.guideId) добавляем прямую
		// ссылку прямо в текст, иначе клиент видит только «сейчас отправим на
		// почту» и не может открыть материал сразу с телефона (см. исходное
		// ТЗ — «бот выдачи материала»). Для глобального гайда (без guideId)
		// поведение прежнее — только email, чтобы не менять давно живущий флоу.
		//
		// Ссылка персональная: с токеном просмотра, чтобы открытие материала
		// попало в bot_guide_views (кто и когда дошёл до файла). Без кампании
		// или userId привязать открытие не к чему — отдаём обычный URL.
		const guideUrl =
			guide && campaignId && deps.userId !== undefined
				? buildGuideTrackingUrl(guide.url, {
						messenger: deps.messenger,
						userId: deps.userId,
						campaignId,
					})
				: guide?.url;

		const outgoing =
			guide && guideUrl && message.guideId && deps.messenger === "telegram"
				? {
						...message,
						text: `${message.text}\n\n📄 [Открыть материал](${guideUrl})`,
					}
				: message;

		try {
			await deps.sendMessage(outgoing);
		} catch (err) {
			// Отправка не удалась (клиент заблокировал бота, чат удалён) — сам факт
			// попытки всё равно должен остаться в истории со статусом "failed",
			// иначе шаг сценария пропадает бесследно. Исключение пробрасываем
			// дальше: сессию на упавшей отправке двигать нельзя.
			await logBotMessage({
				messenger: deps.messenger,
				userId: deps.userId,
				direction: "out",
				source: "scenario",
				text: outgoing.text,
				status: "failed",
			});
			throw err;
		}
		const messageId = await logBotMessage({
			messenger: deps.messenger,
			userId: deps.userId,
			direction: "out",
			source: "scenario",
			text: outgoing.text,
		});

		if (guide) {
			handout = {
				title: deps.guideCampaign?.title,
				fileName: guide.name,
				url: guideUrl ?? guide.url,
				linkInChat: outgoing !== message,
				email: out.state.email,
			};
		}

		if (guide && out.state.email) {
			try {
				await sendGuideEmail(
					out.state.email,
					guide,
					deps.guideCampaign?.emailSubject ?? deps.texts.email_subject,
					deps.guideCampaign?.emailBody ?? deps.texts.email_body,
				);
				if (messageId) await markBotMessageGuideEmailSent(messageId);
				if (handout) handout.emailSentAt = new Date();
			} catch (err) {
				if (handout) handout.emailError = (err as Error).message;
				// Гайд уже ушёл в чат — без письма диалог не ломаем
				console.error(
					`[guide] не удалось отправить email: ${(err as Error).message}`,
				);
			}
		}
	}

	for (const step of out.track) {
		await trackFunnelStep(step, {
			messenger: deps.messenger,
			source: deps.source,
			campaign: deps.campaign,
			userId: deps.userId,
		});
	}

	if (out.lead) {
		// Имя из анкеты (флоу консультации) точнее имени из профиля мессенджера
		const name =
			out.lead.name?.trim() || deps.userName?.trim() || "Клиент из бота";
		console.log(
			`[SCENARIO] заявка flow=${out.lead.flow} name=${name} phone=${out.lead.phone}${out.lead.email ? ` email=${out.lead.email}` : ""}${out.lead.audience ? ` audience=${out.lead.audience}` : ""}${out.lead.issue ? ` issue=${out.lead.issue}` : ""} user=${deps.userId} messenger=${deps.messenger}`,
		);
		const dealId = await submitConsultationDeal({
			name,
			phone: out.lead.phone,
			email: out.lead.email,
			messenger: deps.messenger,
			userId: deps.userId,
			chatId: deps.chatId,
			source: deps.source,
			campaign: deps.campaign,
			comment: describeLead(out.lead, deps.texts, deps.guideCampaign?.title),
			flow: out.lead.flow,
			audience: out.lead.audience,
			issue: out.lead.issue,
		});
		// Мутируем state по ссылке: адаптер уже положил его в сессию,
		// и сессия сохранится после завершения обработчика
		if (dealId) out.state.dealId = dealId;

		// Снимок выдачи для follow-up-джобы (packages/jobs) — она шлёт
		// напоминание через campaign.followUpDelayDays независимо от того,
		// жива ли ещё Redis-сессия сценария к тому моменту.
		if (out.lead.campaignId && deps.userId !== undefined) {
			await upsertBotGuideDelivery({
				campaignId: out.lead.campaignId,
				messenger: deps.messenger,
				userId: String(deps.userId),
				chatId: deps.chatId !== undefined ? String(deps.chatId) : undefined,
				dealId: dealId ?? undefined,
				name,
				phone: out.lead.phone,
				email: out.lead.email,
				emailSentAt: handout?.emailSentAt,
			});
		}
	}

	// Выдача материала в таймлайне сделки: и ссылка в чате, и письмо на email.
	// Комментарий копим в состоянии сценария, если сделки ещё нет: в обычном
	// флоу гайда материал уходит на шаге email, а сделка создаётся только
	// после телефона — иначе факт выдачи в CRM не попал бы вообще.
	const handoutComment = handout ? describeGuideHandout(handout) : null;
	if (handoutComment) {
		const needsEscalation = handout
			? guideHandoutNeedsEmailEscalation(handout)
			: false;
		if (out.state.dealId) {
			await appendDealComment(deps.messenger, out.state.dealId, handoutComment);
			if (needsEscalation) {
				await escalateMissingGuideEmail(deps, out.state.dealId, handoutComment);
			}
		} else {
			out.state.pendingGuideComment = handoutComment;
			out.state.pendingGuideEmailMissing = needsEscalation;
		}
	} else if (out.state.dealId && out.state.pendingGuideComment) {
		await appendDealComment(
			deps.messenger,
			out.state.dealId,
			out.state.pendingGuideComment,
		);
		if (out.state.pendingGuideEmailMissing) {
			await escalateMissingGuideEmail(
				deps,
				out.state.dealId,
				out.state.pendingGuideComment,
			);
		}
		out.state.pendingGuideComment = undefined;
		out.state.pendingGuideEmailMissing = undefined;
	}

	if (out.contact) {
		const contactId = await submitBitrixContact({
			name: deps.userName,
			email: out.contact.email,
			messenger: deps.messenger,
			telegramUserId: deps.userId,
			chatId: deps.chatId,
			source: deps.source,
			campaign: deps.campaign,
		});
		if (contactId) {
			console.log(
				`[SCENARIO] контакт создан id=${contactId} email=${out.contact.email} user=${deps.userId} messenger=${deps.messenger}`,
			);
		}
	}

	if (out.subscribeChoice && out.state.dealId) {
		await appendDealComment(
			deps.messenger,
			out.state.dealId,
			`Согласие на рассылку: ${out.subscribeChoice === "yes" ? "да" : "нет"}`,
		);
	}

	if (deps.redis) {
		try {
			if (out.awaitingInput) {
				await markScenarioAwaiting(deps.redis, deps.messenger, deps.sessionKey);
			} else {
				await clearScenarioAwaiting(
					deps.redis,
					deps.messenger,
					deps.sessionKey,
				);
			}
		} catch (err) {
			console.error(
				`[scenario] не удалось обновить очередь напоминаний: ${(err as Error).message}`,
			);
		}
	}
}
