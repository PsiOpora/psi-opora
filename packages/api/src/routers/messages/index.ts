import { router } from "../../orpc";
import { assign } from "./assign";
import { list } from "./list";
import { markRead } from "./mark-read";
import { poll } from "./poll";
import { send } from "./send";
import { thread } from "./thread";

export const messagesRouter = router({
  list,
  thread,
  poll,
  send,
  markRead,
  assign,
});

export type { ClientListItem, ClientMessageItem, InboxMessenger } from "./types";
