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
  appendDealComment,
  type BitrixSource,
  listBitrixSources,
  registerBitrixSource,
} from "./sources";
export type { BitrixApiLike, ContactData, DealData } from "./types";
