import { router } from "../../orpc";
import { assign } from "./assign";
import { list } from "./list";
import { markRead } from "./mark-read";
import { poll } from "./poll";
import { profile } from "./profile";
import { send } from "./send";
import { thread } from "./thread";

export const messagesRouter = router({
  list,
  thread,
  poll,
  send,
  markRead,
  assign,
  profile,
});

export type {
  ClientListItem,
  ClientMessageItem,
  ClientProfile,
  InboxMessenger,
} from "./types";
