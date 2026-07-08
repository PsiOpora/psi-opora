export { createBot, log, type BotOptions } from "./bot";
export {
  createRedisStorage,
  createUpstashRedis,
  getBitrixChatInfo,
  type StorageAdapter,
  type BitrixChatInfo,
} from "./storage/upstash";
export type {
  ConsultationSession,
  AppContext,
  ConvContext,
} from "./types/context";
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
  successReply,
  WELCOME_TEXT,
  CONSENT_TEXT,
  CONSENT_DECLINED_TEXT,
} from "./utils/messages";
export {
  submitConsultationDeal,
  type SubmitDealParams,
} from "./utils/consultation-deal";
