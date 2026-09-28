import { router } from "../../orpc";
import { assign } from "./assign";
import {
	phoneHints,
	retryClientPhoneLink,
	setClientPhone,
} from "./client-phone";
import { crmLinks } from "./crm-links";
import { crmLinksByDialog } from "./crm-links-by-dialog";
import { deleteMessage } from "./delete";
import { edit } from "./edit";
import { guideActivity } from "./guide-activity";
import { list } from "./list";
import { markRead } from "./mark-read";
import { mergeClients, unmergeClient } from "./merge";
import { addNote, deleteNote, notes } from "./notes";
import { poll } from "./poll";
import { profile } from "./profile";
import {
	deleteQuickReply,
	quickReplies,
	saveQuickReply,
} from "./quick-replies";
import { send } from "./send";
import { setTags } from "./set-tags";
import { thread } from "./thread";

export const messagesRouter = router({
	list,
	thread,
	poll,
	send,
	edit,
	delete: deleteMessage,
	markRead,
	assign,
	mergeClients,
	unmergeClient,
	profile,
	guideActivity,
	crmLinks,
	crmLinksByDialog,
	setClientPhone,
	retryClientPhoneLink,
	phoneHints,
	setTags,
	notes,
	addNote,
	deleteNote,
	quickReplies,
	saveQuickReply,
	deleteQuickReply,
});

export type {
	CrmContactRef,
	PhoneHint,
	SetClientPhoneResult,
} from "./client-phone";
export type {
	ClientGuideItem,
	ClientListItem,
	ClientMessageItem,
	ClientNoteItem,
	ClientProfile,
	CrmContactLink,
	CrmDealLink,
	CrmLeadLink,
	CrmLinksResult,
	CrmPhone,
	InboxMessenger,
	MessageDeliveryStatus,
	QuickReplyItem,
} from "./types";
