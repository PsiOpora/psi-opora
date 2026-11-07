import { router } from "../../orpc";
import { loadRecipient } from "./load-recipient";
import { loadOlder, search } from "./history";
import { addNote, markRead, notes } from "./notes";
import { poll } from "./poll";
import { send } from "./send";

export const widgetMessageRouter = router({
	addNote,
	loadOlder,
	loadRecipient,
	markRead,
	notes,
	poll,
	search,
	send,
});

export type {
	WidgetChannel,
	WidgetEntity,
	WidgetHistoryItem,
	WidgetMessenger,
	WidgetRecipient,
} from "./types";
