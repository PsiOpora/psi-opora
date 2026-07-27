/**
 * Edge-совместимые запросы к БД.
 * Использует neon-http драйвер — не содержит node:module зависимостей.
 */
import { db } from "../client.edge";
import { upsertBitrixCrmLink as _upsertBitrixCrmLink } from "./bitrix-crm-links";
import { getBotConnector as _getBotConnector } from "./bot-connectors";
import {
  addConversationTag as _addConversationTag,
  getConversationMeta as _getConversationMeta,
  setConversationTags as _setConversationTags,
} from "./bot-conversations";
import {
  getBotFunnelEventsByDateRange as _getBotFunnelEventsByDateRange,
  upsertBotFunnelEvent as _upsertBotFunnelEvent,
} from "./bot-funnel";
import {
  type BotMessageEntry,
  insertBotMessage as _insertBotMessage,
  type MessageDeliveryStatus,
  updateBotMessageStatus as _updateBotMessageStatus,
} from "./bot-messages";
import { getBotTextsRecord as _getBotTextsRecord } from "./bot-texts";
import {
  type BotUserProfileEntry,
  getBotUserProfile as _getBotUserProfile,
  upsertBotUser as _upsertBotUser,
} from "./bot-users";
import {
  addClientNote as _addClientNote,
  type NewClientNoteEntry,
} from "./client-notes";

export type { BotFunnelEvent, NewBotFunnelEvent } from "./bot-funnel";
export type { BotMessageEntry, MessageDeliveryStatus } from "./bot-messages";
export type { BotUser, BotUserProfileEntry, NewBotUser } from "./bot-users";
export type { BotConnector } from "./bot-connectors";
export type { BotConversation } from "./bot-conversations";
export type { ClientNote, NewClientNoteEntry } from "./client-notes";

export async function getBotConnector(messenger: string) {
  return _getBotConnector(db, messenger);
}

export async function upsertBitrixCrmLink(
  entry: Parameters<typeof _upsertBitrixCrmLink>[1],
): Promise<void> {
  return _upsertBitrixCrmLink(db, entry);
}

export async function insertBotMessage(entry: BotMessageEntry): Promise<void> {
  return _insertBotMessage(db, entry);
}

export async function updateBotMessageStatus(
  externalId: string,
  status: MessageDeliveryStatus,
): Promise<void> {
  return _updateBotMessageStatus(db, externalId, status);
}

export async function getBotTextsRecord(): Promise<Record<string, string>> {
  return _getBotTextsRecord(db);
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

export async function addClientNote(entry: NewClientNoteEntry) {
  return _addClientNote(db, entry);
}
