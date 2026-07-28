export {
  type AvatarUploadResult,
  type AvatarUploader,
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
  isScenarioAction,
  SCENARIO_ACTIONS,
  type ScenarioAction,
  type ScenarioAudience,
  type ScenarioButton,
  type ScenarioContact,
  type ScenarioIssue,
  type ScenarioLead,
  type ScenarioMessage,
  type ScenarioOutput,
  type ScenarioFlow,
  type ScenarioState,
  type ScenarioStep,
  startConsultation,
  startScenario,
  stepQuestion,
} from "./scenario/engine";
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
  getGuideFile,
  getScenarioTexts,
  GUIDE_FILE_NAME_KEY,
  GUIDE_FILE_S3_KEY,
  GUIDE_FILE_SIZE_KEY,
  GUIDE_FILE_URL_KEY,
  type GuideFile,
  SCENARIO_TEXT_DEFS,
  type ScenarioTextDef,
  type ScenarioTextKey,
  type ScenarioTexts,
} from "./scenario/texts";
export {
  createRedisStorage,
  createUpstashRedis,
  type StorageAdapter,
} from "./storage/upstash";
export type { AppContext, ConsultationSession } from "./types/context";
export {
  type BitrixApiLike,
  type BitrixSource,
  createBitrixContact,
  createBitrixDeal,
  type ContactData,
  type DealData,
  listBitrixSources,
  mirrorOperatorMessageToOpenLine,
  type OpenLineConnector,
  type OpenLineMessageData,
  type OperatorReplyData,
  registerBitrixSource,
  sendMessageToOpenLine,
  updateMessageInOpenLine,
} from "./utils/bitrix";
export {
  type SubmitDealParams,
  type SubmitContactParams,
  submitBitrixContact,
  submitConsultationDeal,
} from "./utils/consultation-deal";
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
  type BotMessageDirection,
  type BotMessageLogEntry,
  type BotMessageSource,
  logBotMessage,
} from "./utils/message-log";
export { SITE_CODES, type SiteCodeEntry } from "./utils/site-codes";
export { resolveMaxBotToken, resolveTelegramBotToken } from "./utils/token";
export {
  type BotUserProfileInput,
  upsertBotUserProfile,
} from "./utils/user-profile";
export {
  buildStartLink,
  formatUtmLog,
  parseUtmParams,
  type UtmParams,
} from "./utils/utm";
export { hasPhoneNumber, isValidEmail } from "./utils/validation";
export { sendGuideEmail } from "./utils/email";
export { withUserLock } from "./utils/lock";
export {
  triageOffScriptMessage,
  type TriageMessage,
} from "./utils/triage";
