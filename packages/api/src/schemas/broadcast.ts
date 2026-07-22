import { z } from "zod";

/** Лимит текста: у MAX 4000 символов, у Telegram 4096 — берём меньший. */
export const MESSAGE_MAX_LENGTH = 4000;

/** Порог «большой аудитории» — дальше показываем усиленное предупреждение. */
export const LARGE_AUDIENCE_THRESHOLD = 300;

const messengerSchema = z.enum(["telegram", "max"]);
const broadcastChannelSchema = z.enum(["auto", "telegram", "max"]);
/** Шире messengerSchema — только для виджета «Мессенджер» в CRM, где
 * дополнительно доступен личный номер Telegram (packages/tg-userbot). */
const widgetMessengerSchema = z.enum(["telegram", "max", "telegram-personal"]);

export const sendTestMessageSchema = z.object({
  messenger: messengerSchema,
  userId: z.string(),
  message: z.string(),
});
export type SendTestMessageInput = z.infer<typeof sendTestMessageSchema>;

export const sendBroadcastSchema = z.object({
  stageId: z.string(),
  stageName: z.string().optional(),
  channel: broadcastChannelSchema,
  message: z.string(),
  dryRun: z.boolean(),
  /**
   * Число получателей из предпросмотра. Для реальной отправки обязательно:
   * если состав изменился с момента предпросмотра — рассылка не запускается.
   */
  expectedRecipients: z.number().optional(),
  /**
   * ID контактов, отмеченных чекбоксами в предпросмотре. Если не задано или
   * пусто — сообщение уходит всем подходящим получателям стадии.
   */
  selectedContactIds: z.array(z.string()).optional(),
});
export type SendBroadcastInput = z.infer<typeof sendBroadcastSchema>;

export const resendFailedSchema = z.object({ broadcastId: z.string() });

export const sendTestEmailSchema = z.object({
  email: z.string(),
  templateId: z.string(),
  subject: z.string(),
});
export type SendTestEmailInput = z.infer<typeof sendTestEmailSchema>;

export const sendEmailCampaignSchema = z.object({
  stageId: z.string(),
  stageName: z.string().optional(),
  templateId: z.string(),
  templateName: z.string().optional(),
  subject: z.string(),
  dryRun: z.boolean(),
  expectedRecipients: z.number().optional(),
  selectedContactIds: z.array(z.string()).optional(),
});
export type SendEmailCampaignInput = z.infer<typeof sendEmailCampaignSchema>;

export const templatePreviewSchema = z.object({ templateId: z.string() });

const widgetEntitySchema = z.enum(["deal", "contact"]);

export const widgetRecipientSchema = z.object({
  entity: widgetEntitySchema,
  id: z.string(),
});

export const widgetPollSchema = z.object({
  entity: widgetEntitySchema,
  id: z.string(),
  sinceIso: z.string(),
});

export const sendWidgetMessageSchema = z.object({
  entity: widgetEntitySchema,
  entityId: z.string(),
  messenger: widgetMessengerSchema,
  /** Только для messenger="telegram-personal" — на портале может быть
   * несколько подключённых номеров, каждый на своей линии. */
  lineId: z.string().optional(),
  text: z.string(),
});
export type SendWidgetMessageInput = z.infer<typeof sendWidgetMessageSchema>;
