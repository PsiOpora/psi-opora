export {
	type AvatarUploader,
	type AvatarUploadResult,
	type BotOptions,
	createBot,
	log,
	sendTelegramScenarioMessage,
} from "./bot";
export {
	type BookPreorderDispatchDeps,
	dispatchBookPreorderOutput,
} from "./scenario/book-preorder/dispatch";
export {
	DRIP_CALLBACK_ACTIONS,
	type DripCallbackAction,
	handleBookPreorderDripCallback,
	type ParsedDripCallback,
	parseDripCallback,
} from "./scenario/book-preorder/drip-actions";
export {
	applyBookPreorderAction,
	applyBookPreorderText,
	BOOK_PREORDER_ACTIONS,
	type BookPreorderAction,
	type BookPreorderIntent,
	type BookPreorderLead,
	type BookPreorderMessage,
	type BookPreorderOutput,
	type BookPreorderState,
	type BookPreorderStep,
	bpActionLabel,
	isBookPreorderAction,
	startBookPreorder,
} from "./scenario/book-preorder/engine";
export { resumeBookPreorder } from "./scenario/book-preorder/resume";
export {
	dispatchScenarioOutput,
	type ScenarioDispatchDeps,
} from "./scenario/dispatch";
export {
	actionLabel,
	applyScenarioAction,
	applyScenarioText,
	buildReminder,
	describeLead,
	type GuideCampaignContext,
	isScenarioAction,
	type KnownContact,
	SCENARIO_ACTIONS,
	type ScenarioAction,
	type ScenarioAudience,
	type ScenarioButton,
	type ScenarioContact,
	type ScenarioFlow,
	type ScenarioIssue,
	type ScenarioLead,
	type ScenarioMessage,
	type ScenarioOutput,
	type ScenarioState,
	type ScenarioStep,
	startConsultation,
	startGuideCampaign,
	startScenario,
	stepQuestion,
	withFields,
	withName,
} from "./scenario/engine";
export {
	findGuideCampaignByText,
	type GuideCampaignStart,
	handleGuideDiagnosticRequest,
	loadGuideCampaignContext,
	looksLikeDiagnosticConsent,
	resolveGuideCampaignStart,
} from "./scenario/guide-campaign";
export {
	clearScenarioAwaiting,
	markScenarioAwaiting,
	REMINDER_DELAY_MS,
	type ReminderRunOptions,
	type ReminderRunResult,
	runScenarioReminders,
} from "./scenario/reminders";
export {
	BOOK_READY_DATE_KEY,
	DEFAULT_SCENARIO_TEXTS,
	GUIDE_FILE_NAME_KEY,
	GUIDE_FILE_S3_KEY,
	GUIDE_FILE_SIZE_KEY,
	GUIDE_FILE_URL_KEY,
	type GuideFile,
	getBookReadyDate,
	getGuideFile,
	getScenarioTexts,
	MAX_BOT_USERNAME_KEY,
	resolveGuideFile,
	SCENARIO_TEXT_DEFS,
	SCENARIO_TEXT_SECTIONS,
	type ScenarioTextDef,
	type ScenarioTextGroupInfo,
	type ScenarioTextKey,
	type ScenarioTextSection,
	type ScenarioTexts,
	TG_BOT_USERNAME_KEY,
} from "./scenario/texts";
export {
	createRedisClient,
	createRedisStorage,
	isRedisConfigured,
	type RedisClient,
	type StorageAdapter,
} from "./storage/redis";
export type { AppContext, ConsultationSession } from "./types/context";
export {
	type AdCampaign,
	type AdStatsResult,
	fetchAdStats,
	getCachedAdStats,
	getRedisOrNull,
	type YandexCampaign,
	type YandexReportRow,
} from "./utils/ads-stats";
export {
	appendDealComment,
	type BitrixApiLike,
	type BitrixSource,
	BOOK_PREORDER_CATEGORY_ID,
	BOOK_PREORDER_STAGE_IDS,
	type BookPreorderStage,
	type ContactData,
	consumeOperatorMirrorEcho,
	createBitrixContact,
	createBitrixDeal,
	type DealConsentOutboxEntry,
	type DealData,
	enqueueOperatorMirrorEcho,
	type KnownBitrixContact,
	listBitrixSources,
	mirrorOperatorMessageToOpenLine,
	moveBookPreorderDealStage,
	type OpenLineConnector,
	type OpenLineMessageData,
	type OperatorMirrorEcho,
	type OperatorReplyData,
	operatorMirrorEchoKey,
	type ProcessDealConsentOutboxResult,
	processDealConsentOutbox,
	registerBitrixSource,
	resolveKnownContact,
	sendMessageToOpenLine,
	updateMessageInOpenLine,
} from "./utils/bitrix";
export {
	type SubmitContactParams,
	type SubmitDealParams,
	submitBitrixContact,
	submitConsultationDeal,
} from "./utils/consultation-deal";
export {
	type CrmEnrichmentMessage,
	enrichCrmFromClientMessage,
} from "./utils/crm-enrichment";
export { sendGuideEmail } from "./utils/email";
export {
	FUNNEL_STEPS,
	type FunnelEventContext,
	type FunnelStep,
	funnelDayKey,
	parseFunnelField,
	setFunnelUpsert,
	trackFunnelStep,
	type UpsertFunnelFn,
} from "./utils/funnel";
export {
	buildGuideTrackingUrl,
	GUIDE_VIEW_PARAM,
	GUIDE_VIEW_SOURCE_PARAM,
	type GuideTrackingContext,
	guideOpenToken,
} from "./utils/guide-link";
export { withUserLock } from "./utils/lock";
export {
	type BotMessageDirection,
	type BotMessageLogEntry,
	type BotMessageSource,
	logBotMessage,
} from "./utils/message-log";
export {
	buildProdamusPaymentUrl,
	type ProdamusPaymentLinkParams,
	verifyProdamusSignature,
} from "./utils/prodamus";
export { SITE_CODES, type SiteCodeEntry } from "./utils/site-codes";
export {
	CONSENT_ADS_DECLINED_FIELD,
	CONSENT_ADS_FIELD,
	CONSENT_OFFER_FIELD,
	getPendingStageDeal,
	handleStageConsentClick,
	isStageConsentAction,
	parseStageConsentPayload,
	recordStageConsent,
	removePendingStageDeal,
	STAGE_CONSENT_ACTIONS,
	type StageConsentAction,
	type StageConsentClickResult,
	type StageConsentInlineButton,
	setPendingStageDeal,
	stageConsentActionLabel,
	stageConsentPayload,
	toInlineKeyboard,
} from "./utils/stage-consent";
export {
	createTelegramFetch,
	resolveTelegramApiRoot,
} from "./utils/telegram-proxy";
export { resolveMaxBotToken, resolveTelegramBotToken } from "./utils/token";
export { type TriageMessage, triageOffScriptMessage } from "./utils/triage";
export {
	type BotUserProfileInput,
	upsertBotUserProfile,
} from "./utils/user-profile";
export {
	buildMaxStartLink,
	buildStartLink,
	decodeStartParam,
	extractYmClientId,
	formatUtmLog,
	isValidCampaignKeyword,
	isValidStartParam,
	matchesBookPreorderStartParam,
	parseUtmParams,
	type StartParamWithClientId,
	splitStartParam,
	type UtmParams,
} from "./utils/utm";
export { hasPhoneNumber, isValidEmail } from "./utils/validation";
export {
	type ConsultationGoalParams,
	sendConsultationGoalToYandexMetrika,
} from "./utils/yandex-metrika";
