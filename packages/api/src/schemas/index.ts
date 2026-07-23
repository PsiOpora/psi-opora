/**
 * Client-safe схемы: импортируются и сервером (input процедур), и браузером
 * (resolvers форм) через subpath `@psi-opora/api/schemas` — без затягивания
 * серверного кода (db, better-auth) в клиентский бандл.
 */
export { type AdCredentialsInput, adCredentialsSchema } from "./ads";
export {
  type BackupCredentialsInput,
  backupCredentialsSchema,
} from "./backup";
export {
  guideIdSchema,
  type SaveBotTextsInput,
  saveBotTextsSchema,
} from "./bot";
export {
  LARGE_AUDIENCE_THRESHOLD,
  MESSAGE_MAX_LENGTH,
  resendFailedSchema,
  type SendBroadcastInput,
  sendBroadcastSchema,
  type SendEmailCampaignInput,
  sendEmailCampaignSchema,
  type SendTestEmailInput,
  sendTestEmailSchema,
  type SendTestMessageInput,
  sendTestMessageSchema,
  type SendWidgetMessageInput,
  sendWidgetMessageSchema,
  templatePreviewSchema,
  widgetPollSchema,
  widgetRecipientSchema,
} from "./broadcast";
export {
  type ActivateBotConnectorInput,
  activateBotConnectorSchema,
  type DeactivateBotConnectorInput,
  deactivateBotConnectorSchema,
} from "./bot-connector";
export { type AddCostInput, addCostSchema } from "./costs";
export {
  type DisconnectTelegramPersonalInput,
  disconnectTelegramPersonalSchema,
  type StartTelegramLoginInput,
  startTelegramLoginSchema,
  type SubmitTelegramCodeInput,
  submitTelegramCodeSchema,
  type SubmitTelegramPasswordInput,
  submitTelegramPasswordSchema,
} from "./telegram-personal";
export {
  type UnisenderSettingsInput,
  unisenderSettingsSchema,
} from "./unisender";
export {
  type DisconnectWhatsappPersonalInput,
  disconnectWhatsappPersonalSchema,
  type PollWhatsappStatusInput,
  pollWhatsappStatusSchema,
  type StartWhatsappLoginInput,
  startWhatsappLoginSchema,
} from "./whatsapp-personal";
export {
  type AssignConversationInput,
  assignConversationSchema,
  type ClientPollInput,
  clientPollSchema,
  type ClientThreadInput,
  clientThreadSchema,
  type ListClientsInput,
  listClientsSchema,
  type SendClientMessageInput,
  sendClientMessageSchema,
} from "./messages";
