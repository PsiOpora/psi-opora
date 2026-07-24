/**
 * Node.js запросы к БД (использует node-postgres или neon-http в зависимости от env).
 * Для Edge Runtime используйте @psi-opora/db/queries.edge
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
  getBotMessageMedia as _getBotMessageMedia,
  getClientMessageStats as _getClientMessageStats,
  insertBotMessage as _insertBotMessage,
  listBotMessages as _listBotMessages,
  listBotMessagesSince as _listBotMessagesSince,
  listClientsWithLastMessage as _listClientsWithLastMessage,
  updateBotMessageStatus as _updateBotMessageStatus,
  type BotMessageEntry,
  type BotMessageMedia,
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
  upsertBotUser as _upsertBotUser,
  type BotUserProfileEntry,
} from "./bot-users";
import {
  addClientNote as _addClientNote,
  deleteClientNote as _deleteClientNote,
  listClientNotes as _listClientNotes,
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
export * from "./bot-guides";
export type {
  BotMessage,
  BotMessageEntry,
  BotMessageMedia,
  ClientListItem,
  ClientMessageStats,
  MessageDeliveryStatus,
  NewBotMessage,
} from "./bot-messages";
export type { BotText } from "./bot-texts";
export type { BotUser, BotUserProfileEntry, NewBotUser } from "./bot-users";
export type { ClientNote, NewClientNoteEntry } from "./client-notes";
export type { QuickReply } from "./quick-replies";
export * from "./broadcast";
export * from "./email-campaign";
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

export async function insertBotMessage(entry: BotMessageEntry): Promise<void> {
  return _insertBotMessage(db, entry);
}

export async function getBotMessageMedia(
  id: string,
): Promise<BotMessageMedia | null> {
  return _getBotMessageMedia(db, id);
}

export async function updateBotMessageStatus(
  externalId: string,
  status: MessageDeliveryStatus,
): Promise<void> {
  return _updateBotMessageStatus(db, externalId, status);
}

export async function listBotMessages(
  messenger: string,
  userId: string,
  limit?: number,
) {
  return _listBotMessages(db, messenger, userId, limit);
}

export async function listBotMessagesSince(
  messenger: string,
  userId: string,
  since: Date,
  limit?: number,
) {
  return _listBotMessagesSince(db, messenger, userId, since, limit);
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

export async function listClientNotes(messenger: string, userId: string) {
  return _listClientNotes(db, messenger, userId);
}

export async function addClientNote(entry: NewClientNoteEntry) {
  return _addClientNote(db, entry);
}

export async function deleteClientNote(noteId: string): Promise<void> {
  return _deleteClientNote(db, noteId);
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
