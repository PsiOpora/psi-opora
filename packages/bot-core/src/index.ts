export {
	type AvatarUploader,
	type AvatarUploadResult,
	type BotOptions,
	createBot,
	log,
	sendTelegramScenarioMessage,
} from "./bot";
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
	DEFAULT_SCENARIO_TEXTS,
	GUIDE_FILE_NAME_KEY,
	GUIDE_FILE_S3_KEY,
	GUIDE_FILE_SIZE_KEY,
	GUIDE_FILE_URL_KEY,
	type GuideFile,
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
	type BitrixApiLike,
	type BitrixSource,
	type ContactData,
	consumeOperatorMirrorEcho,
	createBitrixContact,
	createBitrixDeal,
	type DealData,
	enqueueOperatorMirrorEcho,
	listBitrixSources,
	mirrorOperatorMessageToOpenLine,
	type OpenLineConnector,
	type OpenLineMessageData,
	type OperatorMirrorEcho,
	type OperatorReplyData,
	operatorMirrorEchoKey,
	registerBitrixSource,
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
export { withUserLock } from "./utils/lock";
export {
	type BotMessageDirection,
	type BotMessageLogEntry,
	type BotMessageSource,
	logBotMessage,
} from "./utils/message-log";
export { SITE_CODES, type SiteCodeEntry } from "./utils/site-codes";
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
	formatUtmLog,
	isValidCampaignKeyword,
	isValidStartParam,
	parseUtmParams,
	splitStartParam,
	type UtmParams,
} from "./utils/utm";
export { hasPhoneNumber, isValidEmail } from "./utils/validation";
