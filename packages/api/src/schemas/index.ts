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
  type ActivateBotConnectorInput,
  activateBotConnectorSchema,
  type DeactivateBotConnectorInput,
  deactivateBotConnectorSchema,
} from "./bot-connector";
export {
  LARGE_AUDIENCE_THRESHOLD,
  MESSAGE_MAX_LENGTH,
  resendFailedSchema,
  type SendBroadcastInput,
  type SendEmailCampaignInput,
  type SendTestEmailInput,
  type SendTestMessageInput,
  type SendWidgetMessageInput,
  sendBroadcastSchema,
  sendEmailCampaignSchema,
  sendTestEmailSchema,
  sendTestMessageSchema,
  sendWidgetMessageSchema,
  templatePreviewSchema,
  widgetPollSchema,
  widgetRecipientSchema,
} from "./broadcast";
export { type AddCostInput, addCostSchema } from "./costs";
export {
  type DisconnectMaxPersonalInput,
  disconnectMaxPersonalSchema,
  type StartMaxLoginInput,
  startMaxLoginSchema,
  type SubmitMaxCodeInput,
  submitMaxCodeSchema,
} from "./max-personal";
export {
  type AssignConversationInput,
  assignConversationSchema,
  type BitrixDialogInput,
  bitrixDialogSchema,
  type ClientPollInput,
  type ClientThreadInput,
  clientPollSchema,
  clientThreadSchema,
  type EditClientMessageInput,
  editClientMessageSchema,
  type ListClientsInput,
  listClientsSchema,
  type SendClientMessageInput,
  sendClientMessageSchema,
} from "./messages";
export {
  type DisconnectTelegramPersonalInput,
  disconnectTelegramPersonalSchema,
  type StartTelegramLoginInput,
  type SubmitTelegramCodeInput,
  type SubmitTelegramPasswordInput,
  startTelegramLoginSchema,
  submitTelegramCodeSchema,
  submitTelegramPasswordSchema,
} from "./telegram-personal";
export {
  type EmailProviderInput,
  emailProviderSchema,
  type RusenderSettingsInput,
  rusenderSettingsSchema,
} from "./rusender";
export {
  type UnisenderSettingsInput,
  unisenderSettingsSchema,
} from "./unisender";
export {
  type SmtpBzSettingsInput,
  smtpBzSettingsSchema,
} from "./smtp-bz";
export {
  type ResendSettingsInput,
  resendSettingsSchema,
} from "./resend";
export {
  type DisconnectWhatsappPersonalInput,
  disconnectWhatsappPersonalSchema,
  type PollWhatsappStatusInput,
  pollWhatsappStatusSchema,
  type StartWhatsappLoginInput,
  startWhatsappLoginSchema,
} from "./whatsapp-personal";
