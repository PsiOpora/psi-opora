import { logger } from "@psi-opora/config";
import type { Api, StorageAdapter } from "grammy";
import { Bot, InlineKeyboard, session } from "grammy";
import { dispatchBookPreorderOutput } from "./scenario/book-preorder/dispatch";
import {
	handleBookPreorderDripCallback,
	parseDripCallback,
} from "./scenario/book-preorder/drip-actions";
import {
	applyBookPreorderAction,
	applyBookPreorderText,
	type BookPreorderOutput,
	bpActionLabel,
	isBookPreorderAction,
	startBookPreorder,
} from "./scenario/book-preorder/engine";
import { resumeBookPreorder } from "./scenario/book-preorder/resume";
import { dispatchScenarioOutput } from "./scenario/dispatch";
import {
	actionLabel,
	applyScenarioAction,
	applyScenarioText,
	type GuideCampaignContext,
	isScenarioAction,
	type ScenarioMessage,
	type ScenarioOutput,
	startConsultation,
	startGuideCampaign,
	startScenario,
} from "./scenario/engine";
import {
	handleGuideDiagnosticRequest,
	loadGuideCampaignContext,
	looksLikeDiagnosticConsent,
	resolveGuideCampaignStart,
} from "./scenario/guide-campaign";
import { getScenarioTexts, type ScenarioTexts } from "./scenario/texts";
import type { RedisClient } from "./storage/redis";
import type { AppContext, ConsultationSession } from "./types/context";
import {
	type BitrixApiLike,
	resolveKnownContact,
	sendMessageToOpenLine,
	updateMessageInOpenLine,
} from "./utils/bitrix";
import { enrichCrmFromClientMessage } from "./utils/crm-enrichment";
import { withUserLock } from "./utils/lock";
import { logBotMessage } from "./utils/message-log";
import {
	handleStageConsentClick,
	parseStageConsentPayload,
	stageConsentActionLabel,
	toInlineKeyboard as toStageConsentInlineKeyboard,
} from "./utils/stage-consent";
import {
	createTelegramFetch,
	resolveTelegramApiRoot,
} from "./utils/telegram-proxy";
import { logSlowUpdate, withTimeout } from "./utils/timeout";
import { triageOffScriptMessage } from "./utils/triage";
import { upsertBotUserProfile } from "./utils/user-profile";
import {
	decodeStartParam,
	extractYmClientId,
	formatUtmLog,
	matchesBookPreorderStartParam,
	parseUtmParams,
} from "./utils/utm";

export const log = (msg: string) => {
	console.log(`${new Date().toISOString()} ${msg}`);
};

// Вычисляются один раз при загрузке модуля — TG_API_PROXY_* не меняются на
// лету, только через переменные окружения и передеплой (см. utils/telegram-proxy).
const telegramApiRoot = resolveTelegramApiRoot();
const telegramFetch = createTelegramFetch();

function createInitialSession(): ConsultationSession {
	return { step: "name" };
}

/**
 * Результат перезаливки аватара пользователя в собственное хранилище —
 * возвращается инжектируемым uploadAvatar (см. BotOptions), т.к. bot-core
 * должен оставаться совместимым с Edge Runtime (см. avatarUploader ниже)
 * и не может напрямую тянуть S3-клиент/node-postgres.
 */
export interface AvatarUploadResult {
	avatarS3Key: string;
}

/**
 * Скачивает и перезаливает аватар пользователя в наше хранилище — инжектируется
 * извне (apps/tg-bot), т.к. требует S3-клиента и getBackupCredentials
 * (node-postgres), которые нельзя тянуть в bot-core: этот пакет собирается и в
 * Edge Runtime (max-bot), где node-postgres не работает.
 */
export type AvatarUploader = (params: {
	bytes: Uint8Array;
	contentType: string;
	messenger: "telegram";
	userId: number;
}) => Promise<AvatarUploadResult>;

/**
 * Перезаливка голосового/аудио-вложения в собственное S3 — та же причина
 * инжекции извне (apps/tg-bot), что и у AvatarUploader: bot-core не может
 * напрямую тянуть S3-клиент, т.к. должен оставаться совместимым с Edge
 * Runtime (max-bot). Возвращает только ключ S3 — публичный mediaUrl
 * строится на лету по id сообщения (см. packages/api/routers/messages).
 */
export type MediaUploader = (params: {
	bytes: Uint8Array;
	contentType: string;
	messenger: "telegram";
	fileId: string;
}) => Promise<{ mediaS3Key: string }>;

/**
 * Сохраняет профиль клиента в bot_users: поля из апдейта (всегда доступны)
 * плюс bio/фото из getChat (может не сработать из-за приватности — не критично).
 */
async function collectTelegramProfile(
	ctx: AppContext,
	source: string | undefined,
	campaign: string | undefined,
	token: string,
	uploadAvatar: AvatarUploader | undefined,
): Promise<void> {
	const from = ctx.from;
	if (!from) return;

	let bio: string | undefined;
	let photoFileId: string | undefined;
	let rawProfile: unknown;
	try {
		const chat = await ctx.api.getChat(from.id);
		rawProfile = chat;
		if (chat.type === "private") {
			bio = chat.bio;
			photoFileId = chat.photo?.big_file_id;
		}
	} catch (err) {
		console.error(
			`[profile] не удалось получить getChat для user=${from.id}: ${(err as Error).message}`,
		);
	}

	let avatarS3Key: string | undefined;
	if (photoFileId && uploadAvatar) {
		try {
			const urls = await resolveTelegramFileUrl(ctx.api, token, photoFileId);
			if (urls) {
				const res = await telegramFetch(urls.downloadUrl, {
					signal: AbortSignal.timeout(FILE_DOWNLOAD_TIMEOUT_MS),
				});
				if (res.ok) {
					const bytes = new Uint8Array(await res.arrayBuffer());
					const contentType = res.headers.get("content-type") || "image/jpeg";
					const uploaded = await withTimeout(
						uploadAvatar({
							bytes,
							contentType,
							messenger: "telegram",
							userId: from.id,
						}),
						UPLOAD_TIMEOUT_MS,
						"avatar upload",
					);
					avatarS3Key = uploaded.avatarS3Key;
				}
			}
		} catch (err) {
			console.error(
				`[profile] не удалось скачать аватар для user=${from.id}: ${(err as Error).message}`,
			);
		}
	}

	await upsertBotUserProfile({
		messenger: "telegram",
		userId: from.id,
		firstName: from.first_name,
		lastName: from.last_name,
		username: from.username,
		languageCode: from.language_code,
		isPremium: from.is_premium,
		isBot: from.is_bot,
		bio,
		photoFileId,
		avatarS3Key,
		source,
		campaign,
		rawProfile,
	});
}

export interface BotOptions {
	storage?: StorageAdapter<ConsultationSession>;
	/** Redis для очереди напоминаний; без него напоминания отключены. */
	redis?: RedisClient;
	client?: ConstructorParameters<typeof Bot>[1]["client"];
	/** OAuth-клиент Bitrix24 (resolveBitrixApi из @psi-opora/bitrix-client) —
	 * для дублирования переписки в Открытую линию. Без него дублирование
	 * отключено (см. sendMessageToOpenLine). */
	bitrixApi?: BitrixApiLike;
	/** Токен бота — достаётся из БД (resolveTelegramBotToken в utils/token.ts)
	 * раньше вызова createBot; без него бот не создать. */
	token?: string;
	/** Перезаливка аватара клиента в наше S3 (см. AvatarUploader). Без неё
	 * аватар Telegram не сохраняется — только временный photoFileId. */
	uploadAvatar?: AvatarUploader;
	/** Перезаливка голосового/аудио-вложения в наше S3 (см. MediaUploader).
	 * Без неё голосовые пересылаются в Открытую линию Bitrix как раньше, но
	 * в bot_messages/инбоксе «Клиенты» остаются текстом-заглушкой. */
	uploadMedia?: MediaUploader;
	/** Подмена CRM-обогащения в интеграционных тестах бота. */
	enrichCrm?: typeof enrichCrmFromClientMessage;
}

interface TelegramScenarioMessage extends Omit<ScenarioMessage, "buttons"> {
	buttons?: Array<Array<{ label: string; action: string }>>;
}

function toTelegramInlineKeyboard(
	message: TelegramScenarioMessage,
): InlineKeyboard | undefined {
	if (!message.buttons?.length) return undefined;
	const keyboard = new InlineKeyboard();
	message.buttons.forEach((row, index) => {
		if (index > 0) keyboard.row();
		for (const button of row) keyboard.text(button.label, button.action);
	});
	return keyboard;
}

/**
 * Отправка сообщения сценария в Telegram. Markdown из дашборда может быть
 * невалидным — при ошибке парсинга отправляем как обычный текст.
 */
export async function sendTelegramScenarioMessage(
	api: Api,
	chatId: number,
	message: TelegramScenarioMessage,
): Promise<void> {
	const keyboard = toTelegramInlineKeyboard(message);
	const options = {
		reply_markup: keyboard,
		link_preview_options: { is_disabled: true },
	};
	try {
		try {
			await api.sendMessage(chatId, message.text, {
				...options,
				parse_mode: "Markdown",
			});
		} catch {
			await api.sendMessage(chatId, message.text, options);
		}
		logger.info("bot.scenario_message.sent", { messenger: "telegram", chatId });
	} catch (err) {
		logger.error("bot.scenario_message.failed", err, {
			messenger: "telegram",
			chatId,
		});
		throw err;
	}
	// PDF-гайд в Telegram отдельным документом не шлём — он уходит вложением
	// на email (см. dispatchScenarioOutput/sendGuideEmail)
}

interface TelegramFileUrls {
	/**
	 * Прямой (временный) URL api.telegram.org — для пересылки вложения в
	 * Открытую линию (message.files в imconnector.send.messages): Bitrix24 не
	 * может ходить через наш прокси (нет x-proxy-secret заголовка).
	 */
	bitrixUrl: string;
	/**
	 * URL для скачивания самим ботом — через прокси, если он включён: прямые
	 * запросы к Telegram из k3s ненадёжны, и скачивание по bitrixUrl висело
	 * до TCP-таймаута (минуты).
	 */
	downloadUrl: string;
}

const FILE_DOWNLOAD_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 20_000;

async function resolveTelegramFileUrl(
	api: Api,
	token: string,
	fileId: string,
): Promise<TelegramFileUrls | null> {
	try {
		const file = await api.getFile(fileId);
		if (!file.file_path) return null;
		const path = `/file/bot${token}/${file.file_path}`;
		return {
			bitrixUrl: `https://api.telegram.org${path}`,
			downloadUrl: `${telegramApiRoot}${path}`,
		};
	} catch (err) {
		console.error(
			`[bitrix] не удалось получить ссылку на файл Telegram: ${(err as Error).message}`,
		);
		return null;
	}
}

/** Создаёт Telegram-бота и подключает обработчики сценариев и сообщений. */
export function createBot({
	storage,
	redis,
	client,
	bitrixApi,
	token,
	uploadAvatar,
	uploadMedia,
	enrichCrm = enrichCrmFromClientMessage,
}: BotOptions = {}) {
	const resolvedToken = token || "";
	const bot = new Bot<AppContext>(resolvedToken, {
		client: {
			apiRoot: telegramApiRoot,
			fetch: telegramFetch,
			// Дефолт grammY — 500 с: зависший запрос к Bot API держал бы
			// обработку апдейта (и лок чата) больше 8 минут.
			timeoutSeconds: 15,
			...client,
		},
	});

	// Сериализуем обработку апдейтов одного чата (см. utils/lock.ts) — без
	// этого чтение и запись сессии двумя раздельными Redis-вызовами гонятся
	// при двух почти одновременных апдейтах (двойной тап по кнопке, ретрай
	// вебхука) и дают зацикливание шагов сценария/задвоенные заявки. Лок
	// стоит перед session(), чтобы под ним оказалось и чтение, и запись сессии.
	bot.use(async (ctx, next) => {
		const chatId = ctx.chat?.id;
		if (chatId === undefined) return next();
		const startedAt = Date.now();
		try {
			await withUserLock(redis, `telegram:${chatId}`, next);
		} finally {
			logSlowUpdate(
				"telegram",
				`update=${ctx.update.update_id} chat=${chatId}`,
				startedAt,
			);
		}
	});

	bot.use(
		session({
			initial: createInitialSession,
			storage,
		}),
	);

	// Профиль (getChat, скачивание аватара, S3, bot_users) клиенту не нужен
	// для ответа — собираем в фоне, вне лока чата, чтобы приветствие уходило
	// сразу, а медленная сеть/БД не задерживала ни его, ни следующие апдейты.
	const collectProfileInBackground = (ctx: AppContext) => {
		void collectTelegramProfile(
			ctx,
			ctx.session.source,
			ctx.session.campaign,
			resolvedToken,
			uploadAvatar,
		).catch((err) => {
			console.error(
				`[profile] не удалось собрать профиль user=${ctx.from?.id}: ${(err as Error).message}`,
			);
		});
	};

	const dispatch = async (
		ctx: AppContext,
		out: ScenarioOutput,
		texts: ScenarioTexts,
		guideCampaign?: GuideCampaignContext | null,
	) => {
		const chatId = ctx.chatId;
		if (!chatId) return;
		ctx.session.scenario = out.state;
		// Основной сценарий явно (пере)запущен — снимаем зависший сценарий
		// предзаказа книги, иначе он не отпустит чат: bot.on("message:text")
		// отдаёт ему приоритет, пока его step не "done", а шаги "reserved" и
		// "awaiting_payment" таковыми сами по себе никогда не становятся (см.
		// applyBookPreorderText в scenario/book-preorder/engine.ts). Без сброса
		// клиент, ранее заходивший в бронь книги по TELO-ссылке, не смог бы
		// ответить текстом на шаге имени/телефона/email при записи на
		// консультацию — каждое его сообщение продолжало бы уходить в движок
		// книги вместо основного сценария.
		ctx.session.bookPreorder = undefined;
		await dispatchScenarioOutput(out, {
			messenger: "telegram",
			sessionKey: String(chatId),
			chatId,
			redis,
			texts,
			sendMessage: (message) =>
				sendTelegramScenarioMessage(ctx.api, chatId, message),
			userName: [ctx.from?.first_name, ctx.from?.last_name]
				.filter(Boolean)
				.join(" "),
			userId: ctx.from?.id,
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
		const chatId = ctx.chatId;
		if (!chatId) return;
		ctx.session.bookPreorder = out.state;
		await dispatchBookPreorderOutput(out, {
			messenger: "telegram",
			chatId,
			texts,
			sendMessage: (message) =>
				sendTelegramScenarioMessage(ctx.api, chatId, message),
			userName: [ctx.from?.first_name, ctx.from?.last_name]
				.filter(Boolean)
				.join(" "),
			userId: ctx.from?.id,
			source: ctx.session.source,
			campaign: ctx.session.campaign,
			ymClientId: ctx.session.ymClientId,
		});
	};

	/** Обрабатывает /start, включая возобновление активного предзаказа книги. */
	bot.command("start", async (ctx) => {
		const rawParam = typeof ctx.match === "string" ? ctx.match : undefined;

		// Не ждём запись в журнал: время сообщения фиксируется в момент вызова,
		// так что порядок в истории сохранится, а ответ не ждёт БД.
		void logBotMessage({
			messenger: "telegram",
			userId: ctx.from?.id,
			direction: "in",
			source: "scenario",
			text: rawParam ? `/start ${rawParam}` : "/start",
		});

		// Диплинк вида t.me/bot?start=ШКОЛА или t.me/bot?start=SCHOOL_VK
		// (кодовое слово + источник рекламы, см. splitStartParam) — кодовое
		// слово кампании гайда в параметре /start, а не введённое текстом в
		// чате (см. также ветку keyword в bot.on("message:text") ниже).
		// Приоритет отдаём кампании: UTM-коды в SITE_CODES короткие служебные
		// метки, коллизия с кодовым словом кампании маловероятна, а кампания
		// конкретнее. Декодируем до сравнения: кириллица в ссылке приходит
		// percent-encoded.
		// ClientID Яндекс.Метрики сайт приклеивает суффиксом `_ymNNN` к обычной
		// ссылке (см. extractYmClientId) — отрезаем его до разбора кампании/UTM,
		// чтобы SITE_CODES и splitStartParam видели параметр как раньше.
		const {
			code: startParam,
			ymClientId,
			yclid,
		} = extractYmClientId(decodeStartParam(rawParam));
		if (ymClientId) ctx.session.ymClientId = ymClientId;
		if (yclid) ctx.session.yclid = yclid;

		// Диплинк с лендинга предзаказа книги (t.me/bot?start=TELOPAY|TELOBOOK,
		// опционально с источником через `_`, см.
		// matchesBookPreorderStartParam) — отдельный сценарий
		// (scenario/book-preorder/), проверяем до кампаний гайда, т.к. это
		// фиксированные кодовые слова, не требующие похода в БД.
		const bookPreorder = matchesBookPreorderStartParam(startParam);
		if (bookPreorder) {
			if (bookPreorder.source) ctx.session.source = bookPreorder.source;
			log(
				`[START] user=${ctx.from?.id} chat=${ctx.chat?.id} book_preorder${bookPreorder.intent ? ` intent=${bookPreorder.intent}` : ""}${bookPreorder.source ? ` source=${bookPreorder.source}` : ""} messenger=telegram`,
			);
			collectProfileInBackground(ctx);
			const texts = await getScenarioTexts();
			// Повторный переход по этой же диплинк-кнопке (клиент передумал/
			// вернулся) — при уже начатой сессии не начинаем сценарий с нуля
			// (это заново спросило бы имя/телефон), а резюмируем текущий шаг
			// (см. resumeBookPreorder в scenario/book-preorder/engine.ts).
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

		// Голый /start (без ключевого слова книги) — если оставалась
		// незавершённая сессия книги, она устарела: показываем обычное меню и
		// стираем её, иначе следующий текст пользователя молча уйдёт в
		// обработчик книги поверх уже показанного общего меню (см.
		// apps/max-bot/src/bot.test.ts: "MAX-бот: сброс предзаказа книги").
		if (ctx.session.bookPreorder) {
			ctx.session.bookPreorder = undefined;
		}

		const resolved = startParam
			? await resolveGuideCampaignStart(startParam)
			: null;
		if (resolved) {
			const { campaign, source } = resolved;
			log(
				`[START] user=${ctx.from?.id} chat=${ctx.chat?.id} guide_campaign=${campaign.id}${source ? ` source=${source}` : ""} messenger=telegram`,
			);
			ctx.session.campaign = campaign.keyword;
			if (source) ctx.session.source = source;
			collectProfileInBackground(ctx);
			const texts = await getScenarioTexts();
			await dispatch(ctx, startGuideCampaign(campaign, texts), texts, campaign);
			return;
		}

		const utm = parseUtmParams(startParam);
		if (utm.campaign) {
			ctx.session.campaign = utm.campaign;
		}
		if (utm.source) {
			ctx.session.source = utm.source;
		}

		log(
			`[START] user=${ctx.from?.id} chat=${ctx.chat?.id} ${formatUtmLog(utm)} messenger=telegram`,
		);
		collectProfileInBackground(ctx);

		const texts = await getScenarioTexts();
		await dispatch(ctx, startScenario(texts), texts);
	});

	bot.on("callback_query:data", async (ctx) => {
		const action = ctx.callbackQuery.data;
		const stageConsent = parseStageConsentPayload(action);
		await ctx.answerCallbackQuery();

		// Кнопка из напоминания о предзаказе книги (Б1–Б6, packages/jobs) — не
		// привязана к сессии, адресуется напрямую по номеру заказа (см.
		// scenario/book-preorder/drip-actions.ts).
		const dripCallback = parseDripCallback(action);
		if (dripCallback) {
			await ctx
				.editMessageReplyMarkup({ reply_markup: undefined })
				.catch(() => {});
			if (!ctx.chatId || !ctx.from) return;
			const texts = await getScenarioTexts();
			const reply = await handleBookPreorderDripCallback(
				"telegram",
				ctx.from.id,
				ctx.chatId,
				dripCallback,
				texts,
			);
			if (!reply) return;
			if (ctx.from) {
				await logBotMessage({
					messenger: "telegram",
					userId: ctx.from.id,
					direction: "in",
					source: "scenario",
					text: `[напоминание о предзаказе] ${dripCallback.action}`,
				});
			}
			await sendTelegramScenarioMessage(ctx.api, ctx.chatId, reply);
			await logBotMessage({
				messenger: "telegram",
				userId: ctx.from?.id,
				direction: "out",
				source: "scenario",
				text: reply.text,
			});
			return;
		}

		// Кнопка из follow-up-сообщения кампании гайда (packages/jobs) — не
		// часть машины состояний сценария, обрабатывается отдельно.
		if (action === "sc_guide_diagnostic") {
			await ctx
				.editMessageReplyMarkup({ reply_markup: undefined })
				.catch(() => {});
			if (!ctx.from || !ctx.chatId) return;
			await logBotMessage({
				messenger: "telegram",
				userId: ctx.from.id,
				direction: "in",
				source: "scenario",
				text: "Согласен/согласна на диагностику",
			});
			const texts = await getScenarioTexts();
			const reply = await handleGuideDiagnosticRequest(
				"telegram",
				String(ctx.from.id),
				texts,
			);
			if (!reply) return;
			await sendTelegramScenarioMessage(ctx.api, ctx.chatId, { text: reply });
			await logBotMessage({
				messenger: "telegram",
				userId: ctx.from.id,
				direction: "out",
				source: "scenario",
				text: reply,
			});
			return;
		}

		// Согласия на стадии «Б/п консультация» (см. utils/stage-consent.ts) —
		// не часть машины состояний сценария, сделка адресуется через Redis, а не
		// через ctx.session.scenario.
		if (stageConsent && redis && ctx.from && ctx.chatId) {
			const texts = await getScenarioTexts();
			const result = await handleStageConsentClick(
				redis,
				"telegram",
				ctx.from.id,
				stageConsent.dealId,
				stageConsent.action,
				texts,
			);
			if (!result) return;
			await ctx
				.editMessageReplyMarkup({ reply_markup: undefined })
				.catch(() => {});
			await logBotMessage({
				messenger: "telegram",
				userId: ctx.from.id,
				direction: "in",
				source: "scenario",
				text: stageConsentActionLabel(stageConsent.action, texts),
			});
			await sendTelegramScenarioMessage(ctx.api, ctx.chatId, {
				text: result.replyText,
			});
			await logBotMessage({
				messenger: "telegram",
				userId: ctx.from.id,
				direction: "out",
				source: "scenario",
				text: result.replyText,
			});
			if (result.resendAdsQuestion) {
				await sendTelegramScenarioMessage(ctx.api, ctx.chatId, {
					text: texts.stage_consent_ads_text,
					buttons: toStageConsentInlineKeyboard(
						["stage_ads_agree", "stage_ads_decline"],
						stageConsent.dealId,
						texts,
					),
				});
				await logBotMessage({
					messenger: "telegram",
					userId: ctx.from.id,
					direction: "out",
					source: "scenario",
					text: texts.stage_consent_ads_text,
				});
			}
			return;
		}

		const texts = await getScenarioTexts();
		let out: ScenarioOutput | null = null;
		let guideCampaign: GuideCampaignContext | null = null;

		if (isBookPreorderAction(action)) {
			const bpState = ctx.session.bookPreorder;
			const bpOut = bpState
				? applyBookPreorderAction(bpState, action, texts)
				: null;
			if (!bpOut) return;
			await ctx
				.editMessageReplyMarkup({ reply_markup: undefined })
				.catch(() => {});
			log(
				`[BOOK_PREORDER] user=${ctx.from?.id} action=${action} messenger=telegram`,
			);
			await logBotMessage({
				messenger: "telegram",
				userId: ctx.from?.id,
				direction: "in",
				source: "scenario",
				text: bpActionLabel(action, texts),
			});
			await dispatchBookPreorder(ctx, bpOut, texts);
			return;
		}

		if (action === "sc_book") {
			// Кнопка «Заказать книгу» в общем меню (entryQuestion) — тот же вход
			// в сценарий предзаказа, что и по диплинку с лендинга (см. book_preorder
			// в bot.command("start") выше), но без source/intent — сюда приходят не
			// с конкретной страницы книги.
			await ctx
				.editMessageReplyMarkup({ reply_markup: undefined })
				.catch(() => {});
			log(
				`[BOOK_PREORDER] user=${ctx.from?.id} action=sc_book messenger=telegram`,
			);
			await logBotMessage({
				messenger: "telegram",
				userId: ctx.from?.id,
				direction: "in",
				source: "scenario",
				text: texts.btn_book,
			});
			const existingBookPreorder = ctx.session.bookPreorder;
			const resumed = existingBookPreorder
				? resumeBookPreorder(existingBookPreorder, texts)
				: null;
			// Снимаем зависший общий сценарий (консультация/гайд) — иначе после
			// завершения предзаказа (dispatchBookPreorder трогает только
			// bookPreorder) следующий текст снова попадёт в старый шаг
			// консультации/гайда, см. dispatch() выше про обратный случай.
			ctx.session.scenario = undefined;
			await dispatchBookPreorder(
				ctx,
				resumed ?? startBookPreorder(texts),
				texts,
			);
			return;
		}

		if (action === "start_consultation") {
			// Кнопка «Записаться» из сообщений старого бота — сразу в флоу записи
			out = startConsultation(texts);
		} else if (isScenarioAction(action)) {
			const state = ctx.session.scenario;
			guideCampaign = state?.campaignId
				? await loadGuideCampaignContext(state.campaignId)
				: null;
			// Ищем клиента в CRM только на шаге согласия флоу консультации —
			// там его данные (если найдутся) подставятся вместо повторных
			// вопросов об имени/телефоне/email (см. scenario/engine.ts).
			const knownContact =
				action === "consent_agree" &&
				state?.flow === "consult" &&
				state.step === "consent" &&
				ctx.from &&
				ctx.chatId
					? await resolveKnownContact({
							messenger: "telegram",
							userId: ctx.from.id,
							chatId: ctx.chatId,
						})
					: null;
			out = state
				? applyScenarioAction(state, action, texts, guideCampaign, knownContact)
				: null;
			// Согласие из старого сообщения без активного сценария —
			// начинаем запись заново (показываем актуальное согласие)
			if (!out && action === "consent_agree") {
				out = startConsultation(texts);
			}
		}

		// null — кнопка от прошлого шага (устаревшее сообщение), игнорируем
		if (!out) return;

		// Убираем кнопки с нажатого сообщения, чтобы не нажали повторно
		await ctx
			.editMessageReplyMarkup({ reply_markup: undefined })
			.catch(() => {});

		log(`[SCENARIO] user=${ctx.from?.id} action=${action} messenger=telegram`);
		await logBotMessage({
			messenger: "telegram",
			userId: ctx.from?.id,
			direction: "in",
			source: "scenario",
			text: isScenarioAction(action)
				? actionLabel(action, texts)
				: texts.btn_consult,
		});
		await dispatch(ctx, out, texts, guideCampaign);
	});

	bot.on("message:text", async (ctx) => {
		const text = ctx.message.text.trim();
		if (!text || text.startsWith("/")) return;

		// В журнал попадают все входящие — даже вне сценария
		await logBotMessage({
			messenger: "telegram",
			userId: ctx.from?.id,
			direction: "in",
			source: "scenario",
			text,
		});

		// Дублируем в Открытую линию Bitrix24 — вся переписка видна оператору,
		// и он может ответить прямо оттуда (см. sendMessageToOpenLine).
		if (ctx.chatId && ctx.from) {
			await sendMessageToOpenLine(bitrixApi, {
				messenger: "telegram",
				userId: ctx.from.id,
				chatId: ctx.chatId,
				text,
				messageId: ctx.message.message_id,
				name: [ctx.from.first_name, ctx.from.last_name]
					.filter(Boolean)
					.join(" "),
			});
		}

		const crmEnrichment = ctx.from
			? enrichCrm({
					messenger: "telegram",
					userId: String(ctx.from.id),
					text,
					name: [ctx.from.first_name, ctx.from.last_name]
						.filter(Boolean)
						.join(" "),
					chatId: ctx.chatId,
					source: ctx.session.source,
					campaign: ctx.session.campaign,
				})
			: Promise.resolve();

		// Активный сценарий предзаказа книги — раньше основного движка, чтобы
		// текст на его шагах не путался с веткой консультации/гайда (см.
		// scenario/book-preorder/engine.ts).
		const bookPreorderState = ctx.session.bookPreorder;
		if (bookPreorderState && bookPreorderState.step !== "done") {
			const texts = await getScenarioTexts();
			const bpOut = await applyBookPreorderText(bookPreorderState, text, texts);
			if (!bpOut) {
				await Promise.all([
					crmEnrichment,
					ctx.from
						? triageOffScriptMessage({
								messenger: "telegram",
								userId: String(ctx.from.id),
								text,
							})
						: Promise.resolve(),
				]);
				return;
			}
			await dispatchBookPreorder(ctx, bpOut, texts);
			await crmEnrichment;
			return;
		}

		const state = ctx.session.scenario;
		if (!state) {
			// Кодовое слово кампании гайда, вводится текстом (см. bot_guide_campaigns)
			// — можно и с источником рекламы через `_` (SCHOOL_VK), как в /start.
			const resolved = await resolveGuideCampaignStart(text);
			if (resolved) {
				const { campaign, source } = resolved;
				log(
					`[GUIDE] user=${ctx.from?.id} keyword="${text}" campaign=${campaign.id}${source ? ` source=${source}` : ""} messenger=telegram`,
				);
				ctx.session.campaign = ctx.session.campaign ?? campaign.keyword;
				if (source) ctx.session.source = ctx.session.source ?? source;
				const texts = await getScenarioTexts();
				await dispatch(
					ctx,
					startGuideCampaign(campaign, texts),
					texts,
					campaign,
				);
				await crmEnrichment;
				return;
			}

			// Согласие на диагностику текстом (follow-up просит написать фразу
			// словами, а не только кнопкой) — только если для пользователя есть
			// ожидающая выдача гайда, иначе это обычное офф-скрипт сообщение.
			if (looksLikeDiagnosticConsent(text) && ctx.from && ctx.chatId) {
				const texts = await getScenarioTexts();
				const reply = await handleGuideDiagnosticRequest(
					"telegram",
					String(ctx.from.id),
					texts,
				);
				if (reply) {
					await sendTelegramScenarioMessage(ctx.api, ctx.chatId, {
						text: reply,
					});
					await logBotMessage({
						messenger: "telegram",
						userId: ctx.from.id,
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
				ctx.from
					? triageOffScriptMessage({
							messenger: "telegram",
							userId: String(ctx.from.id),
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
				ctx.from
					? triageOffScriptMessage({
							messenger: "telegram",
							userId: String(ctx.from.id),
							text,
						})
					: Promise.resolve(),
			]);
			return;
		}

		await dispatch(ctx, out, texts, guideCampaign);
		await crmEnrichment;
	});

	// Клиент отредактировал уже отправленное сообщение — пересылаем правку
	// в Открытую линию (см. updateMessageInOpenLine), чтобы оператор видел
	// актуальный текст, а не устаревший. Telegram Bot API не сообщает об
	// удалении сообщений клиентом — такие правки в Открытую линию попасть
	// не могут, это ограничение платформы, а не пробел в реализации.
	bot.on("edited_message:text", async (ctx) => {
		const text = ctx.editedMessage.text.trim();
		if (!text || !ctx.chatId || !ctx.from) return;

		await updateMessageInOpenLine(bitrixApi, {
			messenger: "telegram",
			userId: ctx.from.id,
			chatId: ctx.chatId,
			text,
			messageId: ctx.editedMessage.message_id,
			name: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" "),
		});
	});

	// Фото/документы/голосовые/видео — пересылаем как вложение в Открытую
	// линию (message.files), в сценарий бота эти сообщения не попадают:
	// все шаги сценария текстовые, вложения тут не ожидаются.
	bot.on(
		[
			"message:photo",
			"message:document",
			"message:voice",
			"message:video",
			"message:audio",
		],
		async (ctx) => {
			if (!ctx.chatId || !ctx.from) return;
			const caption = ctx.message.caption?.trim() ?? "";

			let fileId: string | undefined;
			let fileName = "file";
			let mimeType: string | undefined;
			let durationSec: number | undefined;
			/** voice/audio — плеер (как раньше); photo — фото; document/video —
			 * файл (видео в отдельный тип плеера не выделяем — только звук). */
			let kind: "voice" | "image" | "file" = "file";
			if (ctx.message.photo) {
				fileId = ctx.message.photo[ctx.message.photo.length - 1]?.file_id;
				fileName = "photo.jpg";
				mimeType = "image/jpeg";
				kind = "image";
			} else if (ctx.message.document) {
				fileId = ctx.message.document.file_id;
				fileName = ctx.message.document.file_name ?? "document";
				mimeType = ctx.message.document.mime_type;
			} else if (ctx.message.voice) {
				fileId = ctx.message.voice.file_id;
				fileName = "voice.ogg";
				mimeType = ctx.message.voice.mime_type;
				durationSec = ctx.message.voice.duration;
				kind = "voice";
			} else if (ctx.message.video) {
				fileId = ctx.message.video.file_id;
				fileName = "video.mp4";
				mimeType = ctx.message.video.mime_type;
			} else if (ctx.message.audio) {
				fileId = ctx.message.audio.file_id;
				fileName = ctx.message.audio.file_name ?? "audio.mp3";
				mimeType = ctx.message.audio.mime_type;
				durationSec = ctx.message.audio.duration;
				kind = "voice";
			}
			if (!fileId) return;

			const urls = await resolveTelegramFileUrl(ctx.api, resolvedToken, fileId);
			const isVoice = kind === "voice";

			// Перезаливаем вложение в наше S3 — чтобы инбокс «Клиенты» показывал
			// плеер/превью/ссылку на скачивание, а не заглушку `[file.ext]`.
			let mediaS3Key: string | undefined;
			if (uploadMedia && urls) {
				try {
					const res = await telegramFetch(urls.downloadUrl, {
						signal: AbortSignal.timeout(FILE_DOWNLOAD_TIMEOUT_MS),
					});
					if (res.ok) {
						const bytes = new Uint8Array(await res.arrayBuffer());
						const uploaded = await withTimeout(
							uploadMedia({
								bytes,
								contentType: mimeType || "application/octet-stream",
								messenger: "telegram",
								fileId,
							}),
							UPLOAD_TIMEOUT_MS,
							"media upload",
						);
						mediaS3Key = uploaded.mediaS3Key;
					}
				} catch (err) {
					console.error(
						`[media] не удалось перезалить вложение user=${ctx.from.id}: ${(err as Error).message}`,
					);
				}
			}

			await logBotMessage({
				messenger: "telegram",
				userId: ctx.from.id,
				direction: "in",
				source: "scenario",
				text: caption || (isVoice ? "Голосовое сообщение" : `[${fileName}]`),
				...(mediaS3Key
					? {
							kind,
							mediaS3Key,
							mediaMimeType: mimeType,
							mediaDurationSec: durationSec,
							mediaFileName: kind === "file" ? fileName : undefined,
						}
					: {}),
			});

			if (!urls) return;

			await sendMessageToOpenLine(bitrixApi, {
				messenger: "telegram",
				userId: ctx.from.id,
				chatId: ctx.chatId,
				text: caption,
				messageId: ctx.message.message_id,
				files: [{ url: urls.bitrixUrl, name: fileName }],
				name: [ctx.from.first_name, ctx.from.last_name]
					.filter(Boolean)
					.join(" "),
			});
		},
	);

	bot.catch((err) => {
		const ctx = err.ctx as AppContext;
		log(`[ERROR] update_id=${ctx.update.update_id} ${err.error}`);
		const text =
			"⚠️ Что-то пошло не так. Попробуйте ещё раз или напишите /start.";
		// Клиент это сообщение видит, значит оно должно быть и в истории диалога —
		// иначе оператор не понимает, почему клиент пишет «у вас ошибка».
		void ctx
			.reply(text)
			.then(() =>
				logBotMessage({
					messenger: "telegram",
					userId: ctx.from?.id,
					direction: "out",
					source: "scenario",
					text,
				}),
			)
			.catch(() => {});
	});

	return bot;
}
