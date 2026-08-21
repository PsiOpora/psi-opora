/**
 * Node.js запросы к PostgreSQL. В k3s используется драйвер node-postgres.
 */
import { db } from "../client";
import {
	getBitrixCrmLink as _getBitrixCrmLink,
	upsertBitrixCrmLink as _upsertBitrixCrmLink,
} from "./bitrix-crm-links";
import {
	getBotConnector as _getBotConnector,
	markBotConnectorWebhookConfigured as _markBotConnectorWebhookConfigured,
	removeBotConnector as _removeBotConnector,
	upsertBotConnector as _upsertBotConnector,
} from "./bot-connectors";
import {
	addConversationTag as _addConversationTag,
	assignConversation as _assignConversation,
	assignConversationIfUnassigned as _assignConversationIfUnassigned,
	getConversationMeta as _getConversationMeta,
	markConversationRead as _markConversationRead,
	setConversationTags as _setConversationTags,
	type ConversationAssignment,
} from "./bot-conversations";
import {
	getBotFunnelEventsByDateRange as _getBotFunnelEventsByDateRange,
	upsertBotFunnelEvent as _upsertBotFunnelEvent,
} from "./bot-funnel";
import {
	createBotGuideCampaign as _createBotGuideCampaign,
	deleteBotGuideCampaign as _deleteBotGuideCampaign,
	getBotGuideCampaign as _getBotGuideCampaign,
	getBotGuideCampaignByKeyword as _getBotGuideCampaignByKeyword,
	listBotGuideCampaigns as _listBotGuideCampaigns,
	updateBotGuideCampaign as _updateBotGuideCampaign,
} from "./bot-guide-campaigns";
import {
	getBotGuideDelivery as _getBotGuideDelivery,
	getPendingGuideDiagnosticDelivery as _getPendingGuideDiagnosticDelivery,
	listClientGuideActivity as _listClientGuideActivity,
	listDueGuideFollowUps as _listDueGuideFollowUps,
	listGuideCampaignStats as _listGuideCampaignStats,
	markGuideDiagnosticRequested as _markGuideDiagnosticRequested,
	markGuideFollowUpSent as _markGuideFollowUpSent,
	upsertBotGuideDelivery as _upsertBotGuideDelivery,
	type NewBotGuideDeliveryEntry,
} from "./bot-guide-deliveries";
import {
	listGuideViewers as _listGuideViewers,
	recordBotGuideView as _recordBotGuideView,
	type GuideViewMeta,
	type RecordedGuideView,
} from "./bot-guide-views";
import {
	getBotMessageMedia as _getBotMessageMedia,
	getClientMessageStats as _getClientMessageStats,
	getClientMessageStatsForGroup as _getClientMessageStatsForGroup,
	getDeletableBotMessage as _getDeletableBotMessage,
	getEditableBotMessage as _getEditableBotMessage,
	insertBotMessage as _insertBotMessage,
	listAllBotMessages as _listAllBotMessages,
	listAllBotMessagesForGroup as _listAllBotMessagesForGroup,
	listBotMessages as _listBotMessages,
	listBotMessagesSince as _listBotMessagesSince,
	listBotMessagesSinceForGroup as _listBotMessagesSinceForGroup,
	listClientsWithLastMessage as _listClientsWithLastMessage,
	markBotMessageDeleted as _markBotMessageDeleted,
	markBotMessageGuideEmailSent as _markBotMessageGuideEmailSent,
	setBotMessageBitrixExternalId as _setBotMessageBitrixExternalId,
	updateBotMessageExternalResult as _updateBotMessageExternalResult,
	updateBotMessageStatus as _updateBotMessageStatus,
	updateBotMessageText as _updateBotMessageText,
	type BotMessageEntry,
	type BotMessageMedia,
	type ClientIdentityRef,
	type ClientListItem,
	type ClientMessageStats,
	type MessageDeliveryStatus,
} from "./bot-messages";
import {
	getBotTextsRecord as _getBotTextsRecord,
	saveBotTexts as _saveBotTexts,
} from "./bot-texts";
import {
	getBotUserProfile as _getBotUserProfile,
	listBotUsersMissingAvatarUpload as _listBotUsersMissingAvatarUpload,
	updateExistingBotUserPresence as _updateExistingBotUserPresence,
	upsertBotUser as _upsertBotUser,
	upsertBotUserPresence as _upsertBotUserPresence,
	type BotUserProfileEntry,
} from "./bot-users";
import {
	listAllIdentityLinks as _listAllIdentityLinks,
	listGroupIdentities as _listGroupIdentities,
	mergeClientIdentities as _mergeClientIdentities,
	resolveCanonicalIdentity as _resolveCanonicalIdentity,
	unmergeClientIdentity as _unmergeClientIdentity,
	type ClientIdentity,
	type ClientIdentityLink,
	type MergeClientIdentitiesEntry,
} from "./client-identity-links";
import {
	addClientNote as _addClientNote,
	deleteClientNote as _deleteClientNote,
	listClientNotes as _listClientNotes,
	listClientNotesForGroup as _listClientNotesForGroup,
	type NewClientNoteEntry,
} from "./client-notes";
import {
	deleteQuickReply as _deleteQuickReply,
	listQuickReplies as _listQuickReplies,
	saveQuickReply as _saveQuickReply,
} from "./quick-replies";

export * from "./ads";
export * from "./backup";
export type { BitrixCrmLink } from "./bitrix-crm-links";
export type { BotConnector } from "./bot-connectors";
export type {
	BotConversation,
	ConversationAssignment,
} from "./bot-conversations";
export type { BotFunnelEvent, NewBotFunnelEvent } from "./bot-funnel";
export type {
	BotGuideCampaign,
	NewBotGuideCampaign,
} from "./bot-guide-campaigns";
export type {
	BotGuideDelivery,
	ClientGuideActivity,
	DueGuideFollowUp,
	GuideCampaignStats,
	NewBotGuideDeliveryEntry,
} from "./bot-guide-deliveries";
export type {
	BotGuideView,
	GuideViewer,
	GuideViewMeta,
	RecordedGuideView,
} from "./bot-guide-views";
export * from "./bot-guides";
export type {
	BotMessage,
	BotMessageEntry,
	BotMessageMedia,
	ClientIdentityRef,
	ClientListItem,
	ClientMessageStats,
	MessageDeliveryStatus,
	NewBotMessage,
} from "./bot-messages";
export type { BotText } from "./bot-texts";
export type { BotUser, BotUserProfileEntry, NewBotUser } from "./bot-users";
export * from "./broadcast";
export * from "./deal-stage-history";
export * from "./deals";
export type {
	ClientIdentity,
	ClientIdentityLink,
	MergeClientIdentitiesEntry,
} from "./client-identity-links";
export type { ClientNote, NewClientNoteEntry } from "./client-notes";
export * from "./email-campaign";
export * from "./email-provider";
export * from "./email-templates";
export * from "./max-personal";
export type { QuickReply } from "./quick-replies";
export * from "./resend";
export * from "./rusender";
export * from "./smtp-bz";
export * from "./telegram-personal";
export * from "./unisender";
export * from "./whatsapp-personal";

export async function getBotConnector(messenger: string) {
	return _getBotConnector(db, messenger);
}

export async function upsertBitrixCrmLink(
	entry: Parameters<typeof _upsertBitrixCrmLink>[1],
): Promise<void> {
	return _upsertBitrixCrmLink(db, entry);
}

export async function getBitrixCrmLink(messenger: string, userId: string) {
	return _getBitrixCrmLink(db, messenger, userId);
}

export async function upsertBotConnector(
	data: Parameters<typeof _upsertBotConnector>[1],
): Promise<void> {
	return _upsertBotConnector(db, data);
}

export async function markBotConnectorWebhookConfigured(
	messenger: string,
): Promise<void> {
	return _markBotConnectorWebhookConfigured(db, messenger);
}

export async function removeBotConnector(messenger: string): Promise<void> {
	return _removeBotConnector(db, messenger);
}

export async function insertBotMessage(
	entry: BotMessageEntry,
): Promise<string | undefined> {
	return _insertBotMessage(db, entry);
}

export async function getBotMessageMedia(
	id: string,
): Promise<BotMessageMedia | null> {
	return _getBotMessageMedia(db, id);
}

export async function getEditableBotMessage(id: string, operatorId: string) {
	return _getEditableBotMessage(db, id, operatorId);
}

export async function getDeletableBotMessage(id: string, operatorId: string) {
	return _getDeletableBotMessage(db, id, operatorId);
}

export async function updateBotMessageText(id: string, text: string) {
	return _updateBotMessageText(db, id, text);
}

export async function markBotMessageDeleted(id: string, operatorId: string) {
	return _markBotMessageDeleted(db, id, operatorId);
}

export async function setBotMessageBitrixExternalId(
	id: string,
	bitrixExternalId: string,
): Promise<void> {
	return _setBotMessageBitrixExternalId(db, id, bitrixExternalId);
}

export async function markBotMessageGuideEmailSent(id: string): Promise<void> {
	return _markBotMessageGuideEmailSent(db, id);
}

export async function updateBotMessageStatus(
	externalId: string,
	status: MessageDeliveryStatus,
): Promise<void> {
	return _updateBotMessageStatus(db, externalId, status);
}

export async function updateBotMessageExternalResult(
	id: string,
	externalId: string | undefined,
	status: MessageDeliveryStatus,
): Promise<void> {
	return _updateBotMessageExternalResult(db, id, externalId, status);
}

export async function listBotMessages(
	messenger: string,
	userId: string,
	limit?: number,
) {
	return _listBotMessages(db, messenger, userId, limit);
}

export async function listAllBotMessages(messenger: string, userId: string) {
	return _listAllBotMessages(db, messenger, userId);
}

export async function listAllBotMessagesForGroup(
	identities: ClientIdentityRef[],
) {
	return _listAllBotMessagesForGroup(db, identities);
}

export async function listBotMessagesSince(
	messenger: string,
	userId: string,
	since: Date,
	limit?: number,
) {
	return _listBotMessagesSince(db, messenger, userId, since, limit);
}

export async function listBotMessagesSinceForGroup(
	identities: ClientIdentityRef[],
	since: Date,
	limit?: number,
) {
	return _listBotMessagesSinceForGroup(db, identities, since, limit);
}

export async function getBotTextsRecord(): Promise<Record<string, string>> {
	return _getBotTextsRecord(db);
}

export async function saveBotTexts(
	entries: Record<string, string>,
): Promise<void> {
	return _saveBotTexts(db, entries);
}

export async function upsertBotFunnelEvent(
	data: Parameters<typeof _upsertBotFunnelEvent>[1],
): Promise<void> {
	return _upsertBotFunnelEvent(db, data);
}

export async function getBotFunnelEventsByDateRange(
	fromDate: string,
	toDate: string,
) {
	return _getBotFunnelEventsByDateRange(db, fromDate, toDate);
}

export async function upsertBotUser(entry: BotUserProfileEntry): Promise<void> {
	return _upsertBotUser(db, entry);
}

export async function upsertBotUserPresence(
	entry: Parameters<typeof _upsertBotUserPresence>[1],
): Promise<void> {
	return _upsertBotUserPresence(db, entry);
}

export async function updateExistingBotUserPresence(
	entry: Parameters<typeof _updateExistingBotUserPresence>[1],
): Promise<void> {
	return _updateExistingBotUserPresence(db, entry);
}

export async function getBotUserProfile(messenger: string, userId: string) {
	return _getBotUserProfile(db, messenger, userId);
}

export async function listBotUsersMissingAvatarUpload(messenger: string) {
	return _listBotUsersMissingAvatarUpload(db, messenger);
}

export async function getClientMessageStats(
	messenger: string,
	userId: string,
): Promise<ClientMessageStats> {
	return _getClientMessageStats(db, messenger, userId);
}

export async function getClientMessageStatsForGroup(
	identities: ClientIdentityRef[],
): Promise<ClientMessageStats> {
	return _getClientMessageStatsForGroup(db, identities);
}

export async function listClientsWithLastMessage(
	options?: Parameters<typeof _listClientsWithLastMessage>[1],
): Promise<ClientListItem[]> {
	return _listClientsWithLastMessage(db, options);
}

export async function markConversationRead(
	messenger: string,
	userId: string,
): Promise<void> {
	return _markConversationRead(db, messenger, userId);
}

export async function assignConversation(
	entry: ConversationAssignment,
): Promise<void> {
	return _assignConversation(db, entry);
}

export async function assignConversationIfUnassigned(
	entry: ConversationAssignment,
): Promise<void> {
	return _assignConversationIfUnassigned(db, entry);
}

export async function getConversationMeta(messenger: string, userId: string) {
	return _getConversationMeta(db, messenger, userId);
}

export async function setConversationTags(
	messenger: string,
	userId: string,
	tags: string[],
): Promise<void> {
	return _setConversationTags(db, messenger, userId, tags);
}

export async function addConversationTag(
	messenger: string,
	userId: string,
	tag: string,
): Promise<void> {
	return _addConversationTag(db, messenger, userId, tag);
}

export async function listClientNotes(messenger: string, userId: string) {
	return _listClientNotes(db, messenger, userId);
}

export async function listClientNotesForGroup(identities: ClientIdentityRef[]) {
	return _listClientNotesForGroup(db, identities);
}

export async function addClientNote(entry: NewClientNoteEntry) {
	return _addClientNote(db, entry);
}

export async function deleteClientNote(noteId: string): Promise<void> {
	return _deleteClientNote(db, noteId);
}

export async function resolveCanonicalIdentity(
	messenger: string,
	userId: string,
): Promise<ClientIdentity> {
	return _resolveCanonicalIdentity(db, messenger, userId);
}

export async function listGroupIdentities(
	messenger: string,
	userId: string,
): Promise<[ClientIdentity, ...ClientIdentity[]]> {
	return _listGroupIdentities(db, messenger, userId);
}

export async function mergeClientIdentities(
	entry: MergeClientIdentitiesEntry,
): Promise<ClientIdentity> {
	return _mergeClientIdentities(db, entry);
}

export async function unmergeClientIdentity(
	messenger: string,
	userId: string,
): Promise<void> {
	return _unmergeClientIdentity(db, messenger, userId);
}

export async function listAllIdentityLinks(): Promise<ClientIdentityLink[]> {
	return _listAllIdentityLinks(db);
}

export async function listQuickReplies() {
	return _listQuickReplies(db);
}

export async function saveQuickReply(entry: {
	id?: string;
	title: string;
	text: string;
}) {
	return _saveQuickReply(db, entry);
}

export async function deleteQuickReply(id: string): Promise<void> {
	return _deleteQuickReply(db, id);
}

export async function listBotGuideCampaigns() {
	return _listBotGuideCampaigns(db);
}

export async function getBotGuideCampaign(id: string) {
	return _getBotGuideCampaign(db, id);
}

export async function getBotGuideCampaignByKeyword(keyword: string) {
	return _getBotGuideCampaignByKeyword(db, keyword);
}

export async function createBotGuideCampaign(
	campaign: Parameters<typeof _createBotGuideCampaign>[1],
): Promise<void> {
	return _createBotGuideCampaign(db, campaign);
}

export async function updateBotGuideCampaign(
	id: string,
	patch: Parameters<typeof _updateBotGuideCampaign>[2],
): Promise<void> {
	return _updateBotGuideCampaign(db, id, patch);
}

export async function deleteBotGuideCampaign(id: string): Promise<void> {
	return _deleteBotGuideCampaign(db, id);
}

export async function upsertBotGuideDelivery(
	entry: NewBotGuideDeliveryEntry,
): Promise<void> {
	return _upsertBotGuideDelivery(db, entry);
}

export async function getBotGuideDelivery(
	messenger: string,
	userId: string,
	campaignId: string,
) {
	return _getBotGuideDelivery(db, messenger, userId, campaignId);
}

export async function getPendingGuideDiagnosticDelivery(
	messenger: string,
	userId: string,
) {
	return _getPendingGuideDiagnosticDelivery(db, messenger, userId);
}

export async function listDueGuideFollowUps() {
	return _listDueGuideFollowUps(db);
}

export async function listClientGuideActivity(
	messenger: string,
	userId: string,
) {
	return _listClientGuideActivity(db, messenger, userId);
}

export async function listGuideCampaignStats() {
	return _listGuideCampaignStats(db);
}

export async function markGuideFollowUpSent(id: string): Promise<void> {
	return _markGuideFollowUpSent(db, id);
}

export async function markGuideDiagnosticRequested(
	id: string,
	dealId?: number,
): Promise<void> {
	return _markGuideDiagnosticRequested(db, id, dealId);
}

export async function recordBotGuideView(
	token: string,
	meta?: GuideViewMeta,
): Promise<RecordedGuideView | null> {
	return _recordBotGuideView(db, token, meta);
}

export async function listGuideViewers(
	opts?: Parameters<typeof _listGuideViewers>[1],
) {
	return _listGuideViewers(db, opts);
}
