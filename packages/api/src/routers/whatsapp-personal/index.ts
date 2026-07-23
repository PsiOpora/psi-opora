import { router } from "../../orpc";
import { disconnect } from "./disconnect";
import { list } from "./list";
import { pollStatus } from "./poll-status";
import { startLogin } from "./start-login";

export const whatsappPersonalRouter = router({
  startLogin,
  pollStatus,
  list,
  disconnect,
});

export type { WhatsappPersonalAccountView } from "./types";
