export {
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
  applyScenarioAction,
  applyScenarioText,
  buildReminder,
  describeLead,
  isScenarioAction,
  SCENARIO_ACTIONS,
  type ScenarioAction,
  type ScenarioAudience,
  type ScenarioButton,
  type ScenarioIssue,
  type ScenarioLead,
  type ScenarioMessage,
  type ScenarioOutput,
  type ScenarioState,
  type ScenarioStep,
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
  getScenarioTexts,
  SCENARIO_TEXT_DEFS,
  type ScenarioTextDef,
  type ScenarioTextKey,
  type ScenarioTexts,
} from "./scenario/texts";
export {
  type BitrixChatInfo,
  createRedisStorage,
  createUpstashRedis,
  getBitrixChatInfo,
  type StorageAdapter,
} from "./storage/upstash";
export type { AppContext, ConsultationSession } from "./types/context";
export {
  type BitrixSource,
  createBitrixDeal,
  type DealData,
  listBitrixSources,
  registerBitrixConnector,
  registerBitrixSource,
} from "./utils/bitrix";
export {
  type SubmitDealParams,
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
export { SITE_CODES, type SiteCodeEntry } from "./utils/site-codes";
export {
  buildStartLink,
  formatUtmLog,
  parseUtmParams,
  type UtmParams,
} from "./utils/utm";
export { hasPhoneNumber, isValidEmail } from "./utils/validation";
