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

export {
  type AdCampaign,
  type AdStatsResult,
  fetchAdStats,
  getCachedAdStats,
} from "./ads-stats";
export type {
  BroadcastChannel,
  BroadcastRecipient,
  BroadcastReport,
} from "./broadcast-send";
export { getAvatarStream } from "./avatar-storage";
export type { CostEntry } from "./costs-store";
export type {
  EmailRecipient,
  EmailRecipientsReport,
} from "./email-campaign-collect";
export {
  type GuideUploadResult,
  getGuidePdfStream,
  handleGuideUpload,
  MAX_GUIDE_SIZE,
} from "./guide-storage";
export { createORPCContext } from "./orpc";
export { type AppRouter, appRouter } from "./routers";
export type { BotConnectorView } from "./routers/bot-connector";
export type {
  BroadcastActionResult,
  RecentBroadcastInfo,
} from "./routers/broadcast";
export type {
  EmailCampaignActionResult,
  RecentEmailCampaignInfo,
} from "./routers/email-broadcast";
export type {
  CampaignTemplateFieldDef,
  CampaignTemplateSummary,
} from "./routers/email-templates";
export type {
  ClientGuideItem,
  ClientListItem,
  ClientMessageItem,
  ClientNoteItem,
  ClientProfile,
  CrmContactLink,
  CrmDealLink,
  CrmLeadLink,
  CrmLinksResult,
  InboxMessenger,
  MessageDeliveryStatus,
  QuickReplyItem,
} from "./routers/messages";
export type { TelegramPersonalAccountView } from "./routers/telegram-personal";
export type { MaxPersonalAccountView } from "./routers/max-personal";
export type { WhatsappPersonalAccountView } from "./routers/whatsapp-personal";
export type {
  WidgetChannel,
  WidgetEntity,
  WidgetHistoryItem,
  WidgetRecipient,
} from "./routers/widget-message";
export { type AdCredentialsInput, adCredentialsSchema } from "./schemas/ads";
export type { RouterInputs, RouterOutputs };
