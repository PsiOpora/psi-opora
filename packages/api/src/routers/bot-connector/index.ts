import { router } from "../../orpc";
import { activate } from "./activate";
import { deactivate } from "./deactivate";
import { status } from "./status";

export const botConnectorRouter = router({
  activate,
  status,
  deactivate,
});

export type { BotConnectorView } from "./types";
