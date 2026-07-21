import { router } from "../../orpc";
import { disconnect } from "./disconnect";
import { list } from "./list";
import { startLogin } from "./start-login";
import { submitCode } from "./submit-code";
import { submitPassword } from "./submit-password";

export const telegramPersonalRouter = router({
  startLogin,
  submitCode,
  submitPassword,
  list,
  disconnect,
});

export type { TelegramPersonalAccountView } from "./types";
