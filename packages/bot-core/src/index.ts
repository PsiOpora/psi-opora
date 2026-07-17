export {
  createBot,
  log,
  sendTelegramScenarioMessage,
  type BotOptions,
} from "./bot";
export {
  dispatchScenarioOutput,
  type ScenarioDispatchDeps,
} from "./scenario/dispatch";
export {
  applyScenarioAction,
  applyScenarioText,
  buildReminder,
  describeLead,
  isScenarioAction,
  SCENARIO_ACTIONS,
  startScenario,
  stepQuestion,
  type ScenarioAction,
  type ScenarioAudience,
  type ScenarioButton,
  type ScenarioIssue,
  type ScenarioLead,
  type ScenarioMessage,
  type ScenarioOutput,
  type ScenarioState,
  type ScenarioStep,
} from "./scenario/engine";
export {
  clearScenarioAwaiting,
  markScenarioAwaiting,
  REMINDER_DELAY_MS,
  runScenarioReminders,
  type ReminderRunOptions,
  type ReminderRunResult,
} from "./scenario/reminders";
export {
  DEFAULT_SCENARIO_TEXTS,
  getScenarioTexts,
  SCENARIO_TEXT_DEFS,
  type ScenarioTextDef,
  type ScenarioTextKey,
  type ScenarioTexts,
} from "./scenario/texts";
export {
  createRedisStorage,
  createUpstashRedis,
  getBitrixChatInfo,
  type StorageAdapter,
  type BitrixChatInfo,
} from "./storage/upstash";
export type { ConsultationSession, AppContext } from "./types/context";
export {
  createBitrixDeal,
  registerBitrixConnector,
  registerBitrixSource,
  listBitrixSources,
  type DealData,
  type BitrixSource,
} from "./utils/bitrix";
export {
  FUNNEL_STEPS,
  funnelDayKey,
  parseFunnelField,
  trackFunnelStep,
  setFunnelUpsert,
  type FunnelStep,
  type FunnelEventContext,
  type UpsertFunnelFn,
} from "./utils/funnel";
export {
  parseUtmParams,
  formatUtmLog,
  buildStartLink,
  type UtmParams,
} from "./utils/utm";
export { SITE_CODES, type SiteCodeEntry } from "./utils/site-codes";
export { hasPhoneNumber, isValidEmail } from "./utils/validation";
export {
  submitConsultationDeal,
  type SubmitDealParams,
} from "./utils/consultation-deal";
