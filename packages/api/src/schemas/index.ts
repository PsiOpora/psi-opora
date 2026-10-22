/**
 * Client-safe схемы: импортируются и сервером (input процедур), и браузером
 * (resolvers форм) через subpath `@psi-opora/api/schemas` — без затягивания
 * серверного кода (db, better-auth) в клиентский бандл.
 */
export {
	type AdCampaignIdOverrideInput,
	type AdCredentialsInput,
	adCampaignIdOverrideSchema,
	adCredentialsSchema,
} from "./ads";
export { type BackupCredentialsInput, backupCredentialsSchema } from "./backup";
export {
	type DetectBotUsernameInput,
	detectBotUsernameSchema,
	guideIdSchema,
	type SaveBotTextsInput,
	type SaveBotUsernamesInput,
	saveBotTextsSchema,
	saveBotUsernamesSchema,
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
	addEmailSuppressionSchema,
	EMAIL_IMPORT_BATCH_SIZE,
	EMAIL_RECIPIENT_FILTER_VALUES,
	emailCampaignIdSchema,
	emailCampaignRecipientsQuerySchema,
	emailListContactsQuerySchema,
	emailListIdSchema,
	emailRecipientIdSchema,
	emailSuppressionsQuerySchema,
	type ImportEmailListContactsInput,
	importEmailListContactsSchema,
	isValidEmail,
	normalizeEmail,
	removeEmailListContactsSchema,
	removeEmailSuppressionSchema,
	type SaveEmailListInput,
	saveEmailListSchema,
	updateEmailListSchema,
} from "./email-lists";
export {
	type DisconnectMaxPersonalInput,
	disconnectMaxPersonalSchema,
	type StartMaxLoginInput,
	type SubmitMaxCodeInput,
	startMaxLoginSchema,
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
	MAX_ATTACHMENT_SIZE,
	type MessageAttachmentInput,
	messageAttachmentSchema,
	type SendClientMessageInput,
	sendClientMessageSchema,
} from "./messages";
export {
	OUTREACH_MAX_BATCH_PAUSE_MIN,
	OUTREACH_MAX_DAILY_LIMIT,
	OUTREACH_MAX_DEDUP_DAYS,
	OUTREACH_MAX_INTERVAL_SEC,
	OUTREACH_MESSENGER_CHANNELS,
	OUTREACH_MIN_INTERVAL_SEC,
	OUTREACH_RECIPIENT_FILTER_VALUES,
	type OutreachChannelInput,
	type OutreachMessengerChannelInput,
	type OutreachWindowInput,
	outreachChannelSchema,
	outreachIdSchema,
	outreachPreviewSchema,
	outreachRecipientsQuerySchema,
	outreachWindowSchema,
	type SendOutreachInput,
	sendOutreachSchema,
} from "./outreach";
export {
	extractPhones,
	formatPhone,
	normalizePhone,
	type SetClientPhoneInput,
	samePhone,
	setClientPhoneSchema,
} from "./phone";
export { type PostboxSettingsInput, postboxSettingsSchema } from "./postbox";
export { type ResendSettingsInput, resendSettingsSchema } from "./resend";
export {
	type EmailProviderInput,
	emailProviderSchema,
	type RusenderSettingsInput,
	rusenderSettingsSchema,
} from "./rusender";
export { type SmtpBzSettingsInput, smtpBzSettingsSchema } from "./smtp-bz";
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
	updateYandexMetrikaStageGoalSchema,
	type YandexMetrikaSettingsInput,
	type YandexMetrikaStageGoalInput,
	yandexMetrikaSettingsSchema,
	yandexMetrikaStageGoalIdSchema,
	yandexMetrikaStageGoalSchema,
} from "./yandex-metrika";
