import { router } from "../../orpc";
import { assign } from "./assign";
import { list } from "./list";
import { markRead } from "./mark-read";
import { addNote, deleteNote, notes } from "./notes";
import { poll } from "./poll";
import { profile } from "./profile";
import {
  deleteQuickReply,
  quickReplies,
  saveQuickReply,
} from "./quick-replies";
import { send } from "./send";
import { setTags } from "./set-tags";
import { thread } from "./thread";

export const messagesRouter = router({
  list,
  thread,
  poll,
  send,
  markRead,
  assign,
  profile,
  setTags,
  notes,
  addNote,
  deleteNote,
  quickReplies,
  saveQuickReply,
  deleteQuickReply,
});

export type {
  ClientListItem,
  ClientMessageItem,
  ClientNoteItem,
  ClientProfile,
  InboxMessenger,
  QuickReplyItem,
} from "./types";
