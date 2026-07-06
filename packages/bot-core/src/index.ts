export { createBot, log, type BotOptions } from "./bot.js";
export { createRedisStorage, createUpstashRedis, getBitrixChatInfo, type StorageAdapter, type BitrixChatInfo } from "./storage/upstash.js";
export type { ConsultationSession, AppContext, ConvContext } from "./types/context.js";
export {
  createBitrixDeal,
  registerBitrixConnector,
  registerBitrixSource,
  listBitrixSources,
  type DealData,
  type BitrixSource,
} from "./utils/bitrix.js";
export {
  FUNNEL_STEPS,
  funnelDayKey,
  parseFunnelField,
  trackFunnelStep,
  type FunnelStep,
  type FunnelEventContext,
} from "./utils/funnel.js";
export { parseUtmParams, formatUtmLog, buildStartLink, type UtmParams } from "./utils/utm.js";
export { SITE_CODES, type SiteCodeEntry } from "./utils/site-codes.js";
