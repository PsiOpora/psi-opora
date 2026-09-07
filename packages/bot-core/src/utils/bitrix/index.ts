export { createBitrixContact, createBitrixDeal } from "./create-deal";
export {
	mirrorOperatorMessageToOpenLine,
	type OpenLineConnector,
	type OpenLineMessageData,
	type OperatorReplyData,
	sendMessageToOpenLine,
	updateMessageInOpenLine,
} from "./openline";
export {
	consumeOperatorMirrorEcho,
	enqueueOperatorMirrorEcho,
	type OperatorMirrorEcho,
	operatorMirrorEchoKey,
} from "./operator-mirror";
export {
	appendDealComment,
	type BitrixSource,
	type DealConsentOutboxEntry,
	listBitrixSources,
	type ProcessDealConsentOutboxResult,
	processDealConsentOutbox,
	registerBitrixSource,
	setDealConsentTimestamp,
} from "./sources";
export { createBitrixTask } from "./tasks";
export type { BitrixApiLike, ContactData, DealData } from "./types";
