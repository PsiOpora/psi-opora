import { router } from "../../orpc";
import { resendFailed } from "./resend-failed";
import { send } from "./send";
import { sendTest } from "./send-test";

export const broadcastRouter = router({
  sendTest,
  send,
  resendFailed,
});

export type { BroadcastActionResult, RecentBroadcastInfo } from "./types";
