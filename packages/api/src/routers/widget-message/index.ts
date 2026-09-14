import { router } from "../../orpc";
import { loadRecipient } from "./load-recipient";
import { poll } from "./poll";
import { send } from "./send";

export const widgetMessageRouter = router({
	loadRecipient,
	poll,
	send,
});

export type {
	WidgetChannel,
	WidgetEntity,
	WidgetHistoryItem,
	WidgetMessenger,
	WidgetRecipient,
} from "./types";
