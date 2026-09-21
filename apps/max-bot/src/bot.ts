import { Bot, Context, Keyboard, type MiddlewareFn } from "@maxhub/max-bot-api";
import type { RedisClient } from "@psi-opora/bot-core";
import {
	actionLabel,
	applyBookPreorderAction,
	applyBookPreorderText,
	applyScenarioAction,
	applyScenarioText,
	type BitrixApiLike,
	BOOK_PREORDER_ACTIONS,
	type BookPreorderOutput,
	bpActionLabel,
	type ConsultationSession,
	decodeStartParam,
	dispatchBookPreorderOutput,
	dispatchScenarioOutput,
	enrichCrmFromClientMessage,
	extractYmClientId,
	formatUtmLog,
	type GuideCampaignContext,
	getScenarioTexts,
	handleBookPreorderDripCallback,
	handleGuideDiagnosticRequest,
	handleStageConsentClick,
	loadGuideCampaignContext,
	logBotMessage,
	looksLikeDiagnosticConsent,
	matchesBookPreorderStartParam,
	parseDripCallback,
	parseStageConsentPayload,
	parseUtmParams,
	resolveGuideCampaignStart,
	resolveGuideFile,
	resumeBookPreorder,
	SCENARIO_ACTIONS,
	type ScenarioMessage,
	type ScenarioOutput,
	type ScenarioTexts,
	STAGE_CONSENT_ACTIONS,
	type StorageAdapter,
	sendMessageToOpenLine,
	setFunnelUpsert,
	stageConsentActionLabel,
	startBookPreorder,
	startConsultation,
	startGuideCampaign,
	startScenario,
	toInlineKeyboard as toStageConsentInlineKeyboard,
	triageOffScriptMessage,
	upsertBotUserProfile,
	withUserLock,
} from "@psi-opora/bot-core";
import { logger } from "@psi-opora/config";
import { upsertBotFunnelEvent } from "@psi-opora/db/queries";
import { uploadMaxAvatar, uploadMaxMedia } from "./avatar-storage";

// MAX-бот работает в Node.js-поде k3s и подключается к обычному PostgreSQL.
setFunnelUpsert(upsertBotFunnelEvent);

export const log = (msg: string) => {
	console.log(`${new Date().toISOString()} ${msg}`);
};

function describeError(err: unknown): string {
	if (!(err instanceof Error)) return String(err);
	const cause = (err as { cause?: unknown }).cause;
	return cause
		? `${err.message} (cause: ${describeError(cause)})`
		: err.message;
}

function isChatNotFoundError(err: unknown): boolean {
	return (err as { status?: number } | null)?.status === 404;
}

// Отправка через user_id с повторами: сразу после bot_started диалог
// в MAX иногда ещё не успевает создаться на их стороне — 404 в первую
// попытку, но появляется через секунду-другую.
async function sendToUserWithRetry(
	ctx: AppContext,
	userId: number,
	text: string,
	options?: Parameters<AppContext["reply"]>[1],
): Promise<void> {
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			await ctx.api.sendMessageToUser(userId, text, options);
			return;
		} catch (err) {
			if (!isChatNotFoundError(err) || attempt === 3) throw err;
			await sleep(1000 * attempt);
		}
	}
}

// Общий хелпер: отправка ответа с fallback на user_id,
// если чат не существует (404) — например, пользователь удалил
// переписку с ботом или это устаревший апдейт.
async function replyWithFallback(
	ctx: AppContext,
	text: string,
	options?: Parameters<AppContext["reply"]>[1],
): Promise<void> {
	const userId = ctx.user?.user_id;
	if (!ctx.chatId && userId) {
		await sendToUserWithRetry(ctx, userId, text, options);
		return;
	}
	try {
		await ctx.reply(text, options);
	} catch (err) {
		if (isChatNotFoundError(err) && userId) {
			await sendToUserWithRetry(ctx, userId, text, options);
			return;
		}
		throw err;
	}
}

/**
 * Сообщение об ошибке из bot.catch клиент видит в чате, значит оно должно быть
 * и в истории диалога — иначе оператор не понимает, почему клиент пишет
 * «у вас что-то сломалось». Логируем только фактически отправленное.
 */
async function notifyClientAboutFailure(
	ctx: AppContext,
	text: string,
): Promise<void> {
	await replyWithFallback(ctx, text);
	await logBotMessage({
		messenger: "max",
		userId: ctx.user?.user_id,
		direction: "out",
		source: "scenario",
		text,
	});
}

export class AppContext extends Context {
	session!: ConsultationSession;
}

export interface MaxBotOptions {
	storage?: StorageAdapter<ConsultationSession>;
	/** Redis для очереди напоминаний; без него напоминания отключены. */
	redis?: RedisClient;
	/** OAuth-клиент Bitrix24 (resolveBitrixApi из @psi-opora/bitrix-client) —
	 * для дублирования переписки в Открытую линию. Без него дублирование
	 * отключено (см. sendMessageToOpenLine). */
	bitrixApi?: BitrixApiLike;
	/** Токен бота — достаётся из БД (resolveMaxBotToken из @psi-opora/bot-core)
	 * раньше вызова createMaxBot; без него бот не создать. */
	token?: string;
}

function createInitialSession(): ConsultationSession {
	return { step: "name" };
}

function sessionKeyOf(ctx: AppContext): string {
	return String(ctx.user?.user_id ?? ctx.chatId ?? "anon");
}

/**
 * Скачивает аватар клиента с CDN MAX и перезаливает в наше S3 (см.
 * ./avatar-storage.ts) — max-bot работает как обычный Node.js-сервер в k3s,
 * никаких Edge-ограничений тут нет. При любой ошибке возвращает undefined —
 * исходный hotlink на CDN MAX в bot_users не сохраняется.
 */
async function syncMaxAvatar(
	userId: number,
	sourceUrl: string,
): Promise<{ avatarS3Key: string } | undefined> {
	try {
		const res = await fetch(sourceUrl);
		if (!res.ok) throw new Error(`источник недоступен: HTTP ${res.status}`);
		const bytes = new Uint8Array(await res.arrayBuffer());
		const contentType = res.headers.get("content-type") || "image/jpeg";
		return await uploadMaxAvatar({ bytes, contentType, userId });
	} catch (err) {
		log(
			`[profile] не удалось перезалить аватар для user=${userId}: ${describeError(err)}`,
		);
		return undefined;
	}
}

/**
 * Сохраняет профиль клиента в bot_users: поля из апдейта (всегда доступны)
 * плюс аватар через getChat — bot работает только в диалогах 1:1, групповых
 * чатов нет, поэтому getChatMembers не используем (MAX всё равно отдаёт для
 * него 400 "Method is not available for dialogs"). Поле icon для диалога —
 * это фото собеседника, а не иконка чата.
 */
async function collectMaxProfile(
	ctx: AppContext,
	source: string | undefined,
	campaign: string | undefined,
): Promise<void> {
	const user = ctx.user;
	if (!user) return;

	const userLocale = (ctx.update as { user_locale?: unknown }).user_locale;

	let sourceAvatarUrl: string | undefined;
	let avatarS3Key: string | undefined;
	const rawProfile: unknown = user;

	if (ctx.chatId) {
		try {
			const chat = await ctx.getChat(ctx.chatId);
			if (chat.icon?.url) sourceAvatarUrl = chat.icon.url;
		} catch (err) {
			log(
				`[profile] не удалось получить getChat для user=${user.user_id}: ${describeError(err)}`,
			);
		}
	}

	if (sourceAvatarUrl) {
		const uploaded = await syncMaxAvatar(user.user_id, sourceAvatarUrl);
		if (uploaded) {
			avatarS3Key = uploaded.avatarS3Key;
		}
	}

	await upsertBotUserProfile({
		messenger: "max",
		userId: user.user_id,
		name: user.name,
		username: user.username ?? undefined,
		isBot: user.is_bot,
		languageCode: typeof userLocale === "string" ? userLocale : undefined,
		avatarS3Key,
		source,
		campaign,
		rawProfile,
	});
}

function sessionMiddleware(
	storage: StorageAdapter<ConsultationSession> | undefined,
): MiddlewareFn<AppContext> {
	const memory = new Map<string, ConsultationSession>();
	return async (ctx, next) => {
		const key = sessionKeyOf(ctx);
		const existing = storage ? await storage.read(key) : memory.get(key);
		ctx.session = existing ?? createInitialSession();
		await next();
		if (storage) await storage.write(key, ctx.session);
		else memory.set(key, ctx.session);
	};
}

function toMaxKeyboard(message: ScenarioMessage) {
	if (!message.buttons?.length) return undefined;
	return Keyboard.inlineKeyboard(
		message.buttons.map((row) =>
			row.map((button) =>
				Keyboard.button.callback(button.label, button.action),
			),
		),
	);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Отправка PDF-гайда в MAX: скачиваем файл с дашборда, загружаем через
 * uploads API и отправляем вложением. Свежезагруженное вложение может быть
 * ещё не готово («attachment not ready») — повторяем отправку с паузой.
 */
async function sendMaxGuideFile(
	ctx: AppContext,
	guide: { url: string; name: string },
): Promise<void> {
	const fileRes = await fetch(guide.url);
	if (!fileRes.ok) throw new Error(`гайд недоступен: HTTP ${fileRes.status}`);
	const bytes = await fileRes.arrayBuffer();

	const upload = await ctx.api.raw.uploads.getUploadUrl({ type: "file" });
	const form = new FormData();
	form.append(
		"data",
		new Blob([bytes], { type: "application/pdf" }),
		guide.name,
	);
	const uploadRes = await fetch(upload.url, { method: "POST", body: form });
	if (!uploadRes.ok) {
		throw new Error(`загрузка в MAX не удалась: HTTP ${uploadRes.status}`);
	}
	const uploaded = (await uploadRes.json().catch(() => null)) as {
		token?: string;
	} | null;
	const token = uploaded?.token ?? upload.token;
	if (!token) throw new Error("MAX не вернул token вложения");

	const attachments = [{ type: "file" as const, payload: { token } }];
	const caption = `📎 ${guide.name}`;
	let lastError: unknown;
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			await replyWithFallback(ctx, caption, { attachments });
			// Файл гайда — такое же сообщение клиенту, как текст сценария, и
			// должен быть виден в истории диалога (само вложение в журнал не
			// кладём: bot_messages хранит медиа только для голосовых).
			await logBotMessage({
				messenger: "max",
				userId: ctx.user?.user_id,
				direction: "out",
				source: "scenario",
				text: caption,
			});
			return;
		} catch (err) {
			lastError = err;
			await sleep(1500);
		}
	}
	// Текст шага клиент уже получил, а файл — нет: помечаем в истории как
	// недоставленный, иначе пропажа гайда видна только в логах пода.
	await logBotMessage({
		messenger: "max",
		userId: ctx.user?.user_id,
		direction: "out",
		source: "scenario",
		text: caption,
		status: "failed",
	});
	throw lastError;
}

export type MaxBot = Bot<AppContext>;

/** Создаёт MAX-бота и подключает обработчики сценариев и сообщений. */
export function createMaxBot({
	storage,
	redis,
	bitrixApi,
	token,
}: MaxBotOptions = {}): MaxBot {
	const resolvedToken = token || "";
	const bot = new Bot<AppContext>(resolvedToken, { contextType: AppContext });

	// Сериализуем обработку апдейтов одного пользователя (см.
	// @psi-opora/bot-core/utils/lock.ts) — без этого чтение и запись сессии
	// двумя раздельными Redis-вызовами (sessionMiddleware ниже) гонятся при
	// двух почти одновременных апдейтах (двойной тап по кнопке, повторная
	// доставка вебхука) и дают зацикливание шагов сценария/задвоенные заявки.
	bot.use(async (ctx, next) => {
		await withUserLock(redis, `max:${sessionKeyOf(ctx)}`, next);
	});

	bot.use(sessionMiddleware(storage));

	const replyScenarioMessage = async (
		ctx: AppContext,
		message: ScenarioMessage,
	) => {
		const keyboard = toMaxKeyboard(message);
		const attachments = keyboard ? [keyboard] : undefined;
		const userId = ctx.user?.user_id;
		try {
			try {
				await replyWithFallback(ctx, message.text, {
					format: "markdown",
					attachments,
				});
			} catch {
				await replyWithFallback(ctx, message.text, { attachments });
			}
			logger.info("bot.scenario_message.sent", { messenger: "max", userId });
		} catch (err) {
			logger.error("bot.scenario_message.failed", err, {
				messenger: "max",
				userId,
			});
			throw err;
		}

		if (message.guide) {
			try {
				const guide = await resolveGuideFile(message.guideId);
				if (guide) await sendMaxGuideFile(ctx, guide);
			} catch (err) {
				// Текст гайда уже отправлен — без файла диалог не ломаем
				log(`[guide] не удалось отправить PDF в MAX: ${describeError(err)}`);
			}
		}
	};

	const dispatch = async (
		ctx: AppContext,
		out: ScenarioOutput,
		texts: ScenarioTexts,
		guideCampaign?: GuideCampaignContext | null,
	) => {
		ctx.session.scenario = out.state;
		// Сброс зависшего сценария предзаказа книги — см. тот же фикс и
		// комментарий в packages/bot-core/src/bot.ts.
		ctx.session.bookPreorder = undefined;
		await dispatchScenarioOutput(out, {
			messenger: "max",
			sessionKey: sessionKeyOf(ctx),
			// Bitrix-коннектор получает в качестве chat.id именно user_id (см.
			// комментарий у sendMessageToOpenLine ниже) — тот же ID используем
			// здесь для поиска диалога через USER_CODE.
			chatId: ctx.user?.user_id,
			redis,
			texts,
			sendMessage: (message) => replyScenarioMessage(ctx, message),
			userName: ctx.user?.name,
			userId: ctx.user?.user_id,
			source: ctx.session.source,
			campaign: ctx.session.campaign,
			ymClientId: ctx.session.ymClientId,
			yclid: ctx.session.yclid,
			guideCampaign,
		});
	};

	const dispatchBookPreorder = async (
		ctx: AppContext,
		out: BookPreorderOutput,
		texts: ScenarioTexts,
	) => {
		ctx.session.bookPreorder = out.state;
		await dispatchBookPreorderOutput(out, {
			messenger: "max",
			chatId: ctx.user?.user_id,
			texts,
			// BookPreorderMessage — тот же {text, buttons?}, что и ScenarioMessage,
			// но с более узким литеральным типом action у кнопок; toMaxKeyboard
			// использует его только как строку в Keyboard.button.callback.
			sendMessage: (message) =>
				replyScenarioMessage(ctx, message as ScenarioMessage),
			userName: ctx.user?.name,
			userId: ctx.user?.user_id,
			source: ctx.session.source,
			campaign: ctx.session.campaign,
			ymClientId: ctx.session.ymClientId,
		});
	};

	/** Обрабатывает /start, включая возобновление активного предзаказа книги. */
	async function handleStart(
		ctx: AppContext,
		startPayload: string | undefined,
	) {
		await logBotMessage({
			messenger: "max",
			userId: ctx.user?.user_id,
			direction: "in",
			source: "scenario",
			text: startPayload ? `/start ${startPayload}` : "/start",
		});

		// Диплинк с кодовым словом кампании гайда в /start-параметре — можно и
		// с источником рекламы через `_` (SCHOOL_VK, см. splitStartParam). См.
		// такую же ветку в bot.command("start") у TG-бота (packages/bot-core/src/bot.ts).
		// Декодируем до сравнения: кириллица в ссылке приходит percent-encoded.
		// ClientID Яндекс.Метрики сайт приклеивает суффиксом `_ymNNN` (см.
		// extractYmClientId) — отрезаем его до разбора кампании/UTM, чтобы
		// SITE_CODES и splitStartParam видели параметр как раньше.
		const {
			code: startParam,
			ymClientId,
			yclid,
		} = extractYmClientId(decodeStartParam(startPayload));
		if (ymClientId) ctx.session.ymClientId = ymClientId;
		if (yclid) ctx.session.yclid = yclid;

		// Диплинк с лендинга предзаказа книги (см. такую же ветку в
		// packages/bot-core/src/bot.ts, matchesBookPreorderStartParam).
		const bookPreorder = matchesBookPreorderStartParam(startParam);
		if (bookPreorder) {
			if (bookPreorder.source) ctx.session.source = bookPreorder.source;
			log(
				`[START] user=${ctx.user?.user_id} chat=${ctx.chatId} book_preorder${bookPreorder.intent ? ` intent=${bookPreorder.intent}` : ""}${bookPreorder.source ? ` source=${bookPreorder.source}` : ""} messenger=max`,
			);
			await collectMaxProfile(ctx, ctx.session.source, ctx.session.campaign);
			const texts = await getScenarioTexts();
			// Резюме уже начатой сессии вместо сброса — см. такую же ветку в
			// packages/bot-core/src/bot.ts.
			const existingBookPreorder = ctx.session.bookPreorder;
			const resumed = existingBookPreorder
				? resumeBookPreorder(existingBookPreorder, texts)
				: null;
			await dispatchBookPreorder(
				ctx,
				resumed ??
					startBookPreorder(texts, bookPreorder.source, bookPreorder.intent),
				texts,
			);
			return;
		}

		// Голый /start (без ключевого слова книги) — см. такую же ветку в
		// packages/bot-core/src/bot.ts.
		if (ctx.session.bookPreorder) {
			ctx.session.bookPreorder = undefined;
		}

		const resolved = startParam
			? await resolveGuideCampaignStart(startParam)
			: null;
		if (resolved) {
			const { campaign, source } = resolved;
			log(
				`[START] user=${ctx.user?.user_id} chat=${ctx.chatId} guide_campaign=${campaign.id}${source ? ` source=${source}` : ""} messenger=max`,
			);
			ctx.session.campaign = campaign.keyword;
			if (source) ctx.session.source = source;
			await collectMaxProfile(ctx, ctx.session.source, ctx.session.campaign);
			const texts = await getScenarioTexts();
			await dispatch(ctx, startGuideCampaign(campaign, texts), texts, campaign);
			return;
		}

		const utm = parseUtmParams(startParam);
		if (utm.campaign) ctx.session.campaign = utm.campaign;
		if (utm.source) ctx.session.source = utm.source;

		log(
			`[START] user=${ctx.user?.user_id} chat=${ctx.chatId} ${formatUtmLog(utm)} messenger=max`,
		);
		await collectMaxProfile(ctx, ctx.session.source, ctx.session.campaign);

		const texts = await getScenarioTexts();
		await dispatch(ctx, startScenario(texts), texts);
	}

	bot.on("bot_started", (ctx) =>
		handleStart(
			ctx as AppContext,
			(ctx as unknown as { startPayload?: string | null }).startPayload ??
				undefined,
		),
	);
	bot.command("start", (ctx) => handleStart(ctx as AppContext, undefined));

	// Кнопка «Записаться» из сообщений старого бота — сразу в флоу записи
	bot.action("start_consultation", async (ctx) => {
		const appCtx = ctx as AppContext;
		await appCtx.answerOnCallback({}).catch(() => {});
		const texts = await getScenarioTexts();
		await logBotMessage({
			messenger: "max",
			userId: appCtx.user?.user_id,
			direction: "in",
			source: "scenario",
			text: texts.btn_consult,
		});
		await dispatch(appCtx, startConsultation(texts), texts);
	});

	// Кнопка из follow-up-сообщения кампании гайда (packages/jobs) — не часть
	// машины состояний сценария, обрабатывается отдельно.
	bot.action("sc_guide_diagnostic", async (ctx) => {
		const appCtx = ctx as AppContext;
		await appCtx.answerOnCallback({}).catch(() => {});
		const userId = appCtx.user?.user_id;
		if (!userId) return;
		await logBotMessage({
			messenger: "max",
			userId,
			direction: "in",
			source: "scenario",
			text: "Согласен/согласна на диагностику",
		});
		const texts = await getScenarioTexts();
		const reply = await handleGuideDiagnosticRequest(
			"max",
			String(userId),
			texts,
		);
		if (!reply) return;
		await replyWithFallback(appCtx, reply);
		await logBotMessage({
			messenger: "max",
			userId,
			direction: "out",
			source: "scenario",
			text: reply,
		});
	});

	// Согласия на стадии «Б/п консультация» (см. utils/stage-consent.ts) — не
	// часть машины состояний сценария, сделка адресуется через Redis, а не
	// через ctx.session.scenario.
	for (const action of STAGE_CONSENT_ACTIONS) {
		bot.action(new RegExp(`^${action}:\\d+$`), async (ctx) => {
			const appCtx = ctx as AppContext;
			await appCtx.answerOnCallback({}).catch(() => {});
			const userId = appCtx.user?.user_id;
			if (!userId || !redis) return;
			const stageConsent = parseStageConsentPayload(appCtx.match?.[0] ?? "");
			if (!stageConsent) return;
			const texts = await getScenarioTexts();
			const result = await handleStageConsentClick(
				redis,
				"max",
				userId,
				stageConsent.dealId,
				stageConsent.action,
				texts,
			);
			if (!result) return;
			await logBotMessage({
				messenger: "max",
				userId,
				direction: "in",
				source: "scenario",
				text: stageConsentActionLabel(stageConsent.action, texts),
			});
			await replyWithFallback(appCtx, result.replyText);
			await logBotMessage({
				messenger: "max",
				userId,
				direction: "out",
				source: "scenario",
				text: result.replyText,
			});
			if (result.resendAdsQuestion) {
				const buttons = toStageConsentInlineKeyboard(
					["stage_ads_agree", "stage_ads_decline"],
					stageConsent.dealId,
					texts,
				);
				const retryKeyboard = Keyboard.inlineKeyboard([
					...buttons.map((row) =>
						row.map((button) =>
							Keyboard.button.callback(button.label, button.action),
						),
					),
				]);
				await replyWithFallback(appCtx, texts.stage_consent_ads_text, {
					format: "markdown",
					attachments: [retryKeyboard],
				});
				await logBotMessage({
					messenger: "max",
					userId,
					direction: "out",
					source: "scenario",
					text: texts.stage_consent_ads_text,
				});
			}
		});
	}

	// Кнопка из напоминания о предзаказе книги (Б1–Б6, packages/jobs) — не
	// привязана к сессии, адресуется напрямую по номеру заказа (см.
	// scenario/book-preorder/drip-actions.ts).
	bot.action(
		/^bpd_(pay|defer|cancel|buy2480|notify_ebook|stop):\d+$/,
		async (ctx) => {
			const appCtx = ctx as AppContext;
			await appCtx.answerOnCallback({}).catch(() => {});
			const raw = appCtx.match?.[0];
			if (!raw) return;
			const dripCallback = parseDripCallback(raw);
			if (!dripCallback) return;
			const userId = appCtx.user?.user_id;
			if (!userId) return;
			const texts = await getScenarioTexts();
			const reply = await handleBookPreorderDripCallback(
				"max",
				userId,
				userId,
				dripCallback,
				texts,
			);
			if (!reply) return;
			if (userId) {
				await logBotMessage({
					messenger: "max",
					userId,
					direction: "in",
					source: "scenario",
					text: `[напоминание о предзаказе] ${dripCallback.action}`,
				});
			}
			await replyWithFallback(appCtx, reply.text, { format: "markdown" });
			await logBotMessage({
				messenger: "max",
				userId,
				direction: "out",
				source: "scenario",
				text: reply.text,
			});
		},
	);

	for (const action of BOOK_PREORDER_ACTIONS) {
		bot.action(action, async (ctx) => {
			const appCtx = ctx as AppContext;
			await appCtx.answerOnCallback({}).catch(() => {});

			const texts = await getScenarioTexts();
			const bpState = appCtx.session.bookPreorder;
			const bpOut = bpState
				? applyBookPreorderAction(bpState, action, texts)
				: null;
			if (!bpOut) return;

			log(
				`[BOOK_PREORDER] user=${appCtx.user?.user_id} action=${action} messenger=max`,
			);
			await logBotMessage({
				messenger: "max",
				userId: appCtx.user?.user_id,
				direction: "in",
				source: "scenario",
				text: bpActionLabel(action, texts),
			});
			await dispatchBookPreorder(appCtx, bpOut, texts);
		});
	}

	// Кнопка «Заказать книгу» в общем меню (entryQuestion) — тот же вход в
	// сценарий предзаказа, что и по диплинку с лендинга (см. handleStart
	// выше), но без source/intent — сюда приходят не с конкретной страницы
	// книги. Не часть SCENARIO_ACTIONS-цикла ниже — отдельная машина состояний
	// (см. такую же ветку в packages/bot-core/src/bot.ts).
	bot.action("sc_book", async (ctx) => {
		const appCtx = ctx as AppContext;
		await appCtx.answerOnCallback({}).catch(() => {});

		const texts = await getScenarioTexts();
		log(
			`[BOOK_PREORDER] user=${appCtx.user?.user_id} action=sc_book messenger=max`,
		);
		await logBotMessage({
			messenger: "max",
			userId: appCtx.user?.user_id,
			direction: "in",
			source: "scenario",
			text: texts.btn_book,
		});
		const existingBookPreorder = appCtx.session.bookPreorder;
		const resumed = existingBookPreorder
			? resumeBookPreorder(existingBookPreorder, texts)
			: null;
		await dispatchBookPreorder(appCtx, resumed ?? startBookPreorder(texts), texts);
	});

	for (const action of SCENARIO_ACTIONS) {
		if (action === "sc_book") continue;
		bot.action(action, async (ctx) => {
			const appCtx = ctx as AppContext;
			await appCtx.answerOnCallback({}).catch(() => {});

			const texts = await getScenarioTexts();
			const state = appCtx.session.scenario;
			const guideCampaign = state?.campaignId
				? await loadGuideCampaignContext(state.campaignId)
				: null;
			let out = state
				? applyScenarioAction(state, action, texts, guideCampaign)
				: null;
			// Согласие из старого сообщения без активного сценария —
			// начинаем запись заново (показываем актуальное согласие)
			if (!out && action === "consent_agree") {
				out = startConsultation(texts);
			}
			// null — кнопка от прошлого шага (устаревшее сообщение), игнорируем
			if (!out) return;

			log(
				`[SCENARIO] user=${appCtx.user?.user_id} action=${action} messenger=max`,
			);
			await logBotMessage({
				messenger: "max",
				userId: appCtx.user?.user_id,
				direction: "in",
				source: "scenario",
				text: actionLabel(action, texts),
			});
			await dispatch(appCtx, out, texts, guideCampaign);
		});
	}

	bot.on("message_created", async (ctx) => {
		const appCtx = ctx as unknown as AppContext;
		const text = appCtx.message?.body.text?.trim() ?? "";
		// Реальные поля вложений MAX (см. @maxhub/max-bot-api
		// core/network/api/types/attachment.d.ts, не экспортируется наружу
		// пакетом — типизируем вручную): payload.url/token общие для всех
		// медиа-типов, filename — только у file, отдельным полем, не в payload.
		const attachments = appCtx.message?.body.attachments as
			| Array<{
					type: string;
					payload: { url?: string; token?: string };
					filename?: string;
			  }>
			| null
			| undefined;
		const audioAttachment = attachments?.find((a) => a.type === "audio") as
			| { type: "audio"; payload: { url: string; token: string } }
			| undefined;
		// image — фото, остальное некрасноречивое (file/video/sticker/...) —
		// общий kind="file" со ссылкой на скачивание.
		const mediaAttachment = attachments?.find(
			(a) => a.type === "image" || a.type === "file" || a.type === "video",
		) as
			| {
					type: "image" | "file" | "video";
					payload: { url?: string; token?: string };
					filename?: string;
			  }
			| undefined;
		if (!text && !audioAttachment && !mediaAttachment) return;
		if (!audioAttachment && !mediaAttachment && text.startsWith("/")) return;

		// В журнал попадают все входящие — даже вне сценария
		const userId = appCtx.user?.user_id ?? appCtx.message?.sender?.user_id;

		// Голосовое/фото/файл — перезаливаем в наше S3, чтобы инбокс «Клиенты»
		// показывал плеер/превью/ссылку на скачивание, а не молчал (без
		// вложения пустой text раньше отбрасывался ранним return выше).
		let mediaS3Key: string | undefined;
		let mediaMimeType: string | undefined;
		let mediaKind: "voice" | "image" | "file" | undefined;
		let mediaFileName: string | undefined;
		const attachment = audioAttachment ?? mediaAttachment;
		if (attachment?.payload.url) {
			try {
				const res = await fetch(attachment.payload.url);
				if (res.ok) {
					const bytes = new Uint8Array(await res.arrayBuffer());
					mediaKind = audioAttachment
						? "voice"
						: mediaAttachment?.type === "image"
							? "image"
							: "file";
					mediaMimeType =
						res.headers.get("content-type") ||
						(mediaKind === "voice" ? "audio/mp4" : "application/octet-stream");
					mediaFileName =
						mediaKind === "file"
							? (mediaAttachment?.filename ?? "file")
							: undefined;
					const uploaded = await uploadMaxMedia({
						bytes,
						contentType: mediaMimeType,
						attachmentId: String(appCtx.message?.body.mid ?? Date.now()),
						fileName: mediaFileName,
					});
					mediaS3Key = uploaded.mediaS3Key;
				}
			} catch (err) {
				console.error(
					`[media] не удалось перезалить вложение user=${userId}: ${(err as Error).message}`,
				);
			}
		}

		await logBotMessage({
			messenger: "max",
			userId,
			direction: "in",
			source: "scenario",
			text:
				text ||
				(audioAttachment
					? "Голосовое сообщение"
					: mediaAttachment
						? `[${mediaFileName ?? mediaAttachment.type}]`
						: ""),
			...(mediaS3Key && mediaKind
				? { kind: mediaKind, mediaS3Key, mediaMimeType, mediaFileName }
				: {}),
		});

		// Дублируем в Открытую линию Bitrix24 — вся переписка видна оператору,
		// и он может ответить прямо оттуда (см. sendMessageToOpenLine). В качестве
		// внешнего chat.id передаём user_id, а не MAX chat_id: обратная отправка
		// (sendMessengerMessage → MAX API messages.send) адресуется по user_id,
		// так что для маршрутизации ответа назад нужен именно он.
		if (userId) {
			await sendMessageToOpenLine(bitrixApi, {
				messenger: "max",
				userId,
				chatId: userId,
				text,
				name: appCtx.user?.name,
				...(attachment?.payload.url
					? {
							files: [
								{ url: attachment.payload.url, name: mediaKind ?? "file" },
							],
						}
					: {}),
			});
		}

		if (!text) return;

		const crmEnrichment = userId
			? enrichCrmFromClientMessage({
					messenger: "max",
					userId: String(userId),
					text,
					name: appCtx.user?.name,
					chatId: userId,
					source: appCtx.session.source,
					campaign: appCtx.session.campaign,
				})
			: Promise.resolve();

		// Активный сценарий предзаказа книги — раньше основного движка (см.
		// такую же ветку в packages/bot-core/src/bot.ts).
		const bookPreorderState = appCtx.session.bookPreorder;
		if (bookPreorderState && bookPreorderState.step !== "done") {
			const texts = await getScenarioTexts();
			const bpOut = await applyBookPreorderText(bookPreorderState, text, texts);
			if (!bpOut) {
				await Promise.all([
					crmEnrichment,
					userId
						? triageOffScriptMessage({
								messenger: "max",
								userId: String(userId),
								text,
							})
						: Promise.resolve(),
				]);
				return;
			}
			await dispatchBookPreorder(appCtx, bpOut, texts);
			await crmEnrichment;
			return;
		}

		const state = appCtx.session.scenario;
		if (!state) {
			// Кодовое слово кампании гайда, вводится текстом (см. bot_guide_campaigns)
			// — можно и с источником рекламы через `_` (SCHOOL_VK), как в /start.
			const resolved = await resolveGuideCampaignStart(text);
			if (resolved) {
				const { campaign, source } = resolved;
				log(
					`[GUIDE] user=${userId} keyword="${text}" campaign=${campaign.id}${source ? ` source=${source}` : ""} messenger=max`,
				);
				appCtx.session.campaign = appCtx.session.campaign ?? campaign.keyword;
				if (source) appCtx.session.source = appCtx.session.source ?? source;
				const texts = await getScenarioTexts();
				await dispatch(
					appCtx,
					startGuideCampaign(campaign, texts),
					texts,
					campaign,
				);
				await crmEnrichment;
				return;
			}

			// Согласие на диагностику текстом (follow-up просит написать фразу
			// словами, а не только кнопкой).
			if (looksLikeDiagnosticConsent(text) && userId) {
				const texts = await getScenarioTexts();
				const reply = await handleGuideDiagnosticRequest(
					"max",
					String(userId),
					texts,
				);
				if (reply) {
					await replyWithFallback(appCtx, reply);
					await logBotMessage({
						messenger: "max",
						userId,
						direction: "out",
						source: "scenario",
						text: reply,
					});
					await crmEnrichment;
					return;
				}
			}

			await Promise.all([
				crmEnrichment,
				userId
					? triageOffScriptMessage({
							messenger: "max",
							userId: String(userId),
							text,
						})
					: Promise.resolve(),
			]);
			return;
		}

		const texts = await getScenarioTexts();
		const guideCampaign = state.campaignId
			? await loadGuideCampaignContext(state.campaignId)
			: null;
		const out = await applyScenarioText(state, text, texts, guideCampaign);
		if (!out) {
			// Сообщение не подошло ни под один ожидаемый на этом шаге ввод (клиент
			// пишет что-то своё, а не то, что просит сценарий) — бот здесь не
			// пытается сам помочь/ответить, только тихо решает, стоит ли передать
			// его оператору с пометкой (см. triageOffScriptMessage).
			await Promise.all([
				crmEnrichment,
				userId
					? triageOffScriptMessage({
							messenger: "max",
							userId: String(userId),
							text,
						})
					: Promise.resolve(),
			]);
			return;
		}

		await dispatch(appCtx, out, texts, guideCampaign);
		await crmEnrichment;
	});

	bot.catch((err, ctx) => {
		log(`[ERROR] update=${ctx.updateType} ${describeError(err)}`);
		notifyClientAboutFailure(
			ctx as AppContext,
			"⚠️ Что-то пошло не так. Попробуйте ещё раз или напишите /start.",
		).catch(() => {});
	});

	return bot;
}

/**
 * Обработка webhook-апдейта через внутренний метод Bot.
 * handleUpdate приватный, но доступен через (bot as any).handleUpdate.
 * Это корректнее ручного создания контекста, т.к. использует
 * ту же логику, что и при long-polling.
 */
export async function processUpdate(
	bot: MaxBot,
	update: unknown,
): Promise<void> {
	await (
		bot as unknown as { handleUpdate(update: unknown): Promise<void> }
	).handleUpdate(update);
}
