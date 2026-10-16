import { resolveOpenLineDialog } from "./openline";
import { appendPhoneToDealComment } from "./phone-fallback";
import { appendDealComment } from "./sources";

/** См. appendPhoneToDealComment — с реальными вызовами Bitrix. */
export function appendPhoneToTrackerDeal(
	params: Parameters<typeof appendPhoneToDealComment>[0],
): Promise<boolean> {
	return appendPhoneToDealComment(params, {
		resolveDialog: resolveOpenLineDialog,
		appendComment: appendDealComment,
	});
}
