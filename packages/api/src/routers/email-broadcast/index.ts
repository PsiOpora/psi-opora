import { router } from "../../orpc";
import { send } from "./send";
import { sendTest } from "./send-test";
import { templatePreview } from "./template-preview";

export const emailBroadcastRouter = router({
	templatePreview,
	sendTest,
	send,
});

export type {
	EmailCampaignActionResult,
	RecentEmailCampaignInfo,
} from "./types";
