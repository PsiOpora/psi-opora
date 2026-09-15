import { router } from "../../orpc";
import { disconnect } from "./disconnect";
import { list } from "./list";
import { registerSlot } from "./register-slot";
import { startLogin } from "./start-login";
import { submitCode } from "./submit-code";

export const maxPersonalRouter = router({
	registerSlot,
	startLogin,
	submitCode,
	list,
	disconnect,
});

export type { MaxPersonalAccountView } from "./types";
