import type { InferRouterInputs, InferRouterOutputs } from "@orpc/server";

import type { AppRouter } from "./routers";

/**
 * Inference helpers for input types.
 *
 * @example
 *   type CreatePostInput = RouterInputs['post']['create']
 *   //   ^? { title: string; content: string }
 */
type RouterInputs = InferRouterInputs<AppRouter>;

/**
 * Inference helpers for output types.
 *
 * @example
 *   type PostListOutput = RouterOutputs['post']['list']
 *   //   ^? { id: string; title: string; ... }[]
 */
type RouterOutputs = InferRouterOutputs<AppRouter>;

export { createORPCContext } from "./orpc";
export type { CostEntry } from "./costs-store";
export {
  type GuideUploadResult,
  MAX_GUIDE_SIZE,
  getGuidePdfStream,
  handleGuideUpload,
} from "./guide-storage";
export type {
  BroadcastChannel,
  BroadcastRecipient,
  BroadcastReport,
} from "./broadcast-send";
export type {
  EmailRecipient,
  EmailRecipientsReport,
} from "./email-campaign-collect";
export type {
  BroadcastActionResult,
  RecentBroadcastInfo,
} from "./routers/broadcast";
export type {
  EmailCampaignActionResult,
  RecentEmailCampaignInfo,
} from "./routers/email-broadcast";
export type { BotConnectorView } from "./routers/bot-connector";
export type { TelegramPersonalAccountView } from "./routers/telegram-personal";
export type {
  WidgetEntity,
  WidgetHistoryItem,
  WidgetRecipient,
} from "./routers/widget-message";
export {
  type AdCampaign,
  type AdStatsResult,
  fetchAdStats,
  getCachedAdStats,
} from "./ads-stats";
export { type AppRouter, appRouter } from "./routers";
export {
  type AdCredentialsInput,
  adCredentialsSchema,
} from "./schemas/ads";
export type { RouterInputs, RouterOutputs };
