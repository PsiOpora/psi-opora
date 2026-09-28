import { beforeEach, expect, mock, test } from "bun:test";

let locked = false;
const order = {
	id: "telegram:7",
	orderNo: 1001,
	userId: "7",
	messenger: "telegram",
	status: "paid",
	dealId: 42,
	paidNotifiedAt: null,
	dealPaidSyncedAt: null,
};
const withBookPreorderOrderLock = mock(
	async <T>(_id: string, fn: () => Promise<T>) => {
		locked = true;
		try {
			return await fn();
		} finally {
			locked = false;
		}
	},
);
const markBookPreorderPaid = mock(async () => {
	expect(locked).toBe(true);
	return order;
});
const moveBookPreorderDealStage = mock(async () => {
	expect(locked).toBe(true);
});
const releaseBookPreorderDealPaidSync = mock(async () => {});
mock.module("@psi-opora/config", () => ({
	env: { PRODAMUS_SECRET_KEY: "test-secret" },
}));
mock.module("@psi-opora/bot-core", () => ({
	verifyProdamusSignature: () => true,
	appendDealComment: async () => {},
	getScenarioTexts: async () => ({ bp_paid_reply: "Paid {номер}" }),
	moveBookPreorderDealStage,
}));
mock.module("@psi-opora/db/queries", () => ({
	withBookPreorderOrderLock,
	getBookPreorderOrderByOrderNo: async () => order,
	markBookPreorderPaid,
	claimBookPreorderDealPaidSync: async () => true,
	claimBookPreorderPaidNotification: async () => true,
	releaseBookPreorderDealPaidSync,
	releaseBookPreorderPaidNotification: async () => {},
}));
mock.module("@psi-opora/jobs", () => ({
	sendMessengerMessage: async () => {},
}));
const { handlePayformWebhook } = await import("../src/payform-webhook");
function request() {
	return new Request("https://example.test/payform", {
		method: "POST",
		body: "order_id=1001&payment_status=success",
	});
}
beforeEach(() => {
	withBookPreorderOrderLock.mockClear();
	markBookPreorderPaid.mockClear();
	moveBookPreorderDealStage.mockClear();
	releaseBookPreorderDealPaidSync.mockClear();
});

test("payment status and Bitrix paid stage share the callback's order lock", async () => {
	expect((await handlePayformWebhook(request())).status).toBe(200);
	expect(withBookPreorderOrderLock).toHaveBeenCalledWith(
		"telegram:7",
		expect.any(Function),
	);
	expect(markBookPreorderPaid).toHaveBeenCalledWith(1001);
	expect(moveBookPreorderDealStage).toHaveBeenCalledWith(
		"telegram",
		42,
		"paid",
	);
	expect(locked).toBe(false);
});

test("failed Bitrix sync remains retryable and releases the order lock", async () => {
	moveBookPreorderDealStage.mockRejectedValueOnce(
		new Error("Bitrix unavailable"),
	);
	expect((await handlePayformWebhook(request())).status).toBe(200);
	expect(releaseBookPreorderDealPaidSync).toHaveBeenCalledWith("telegram:7");
	expect(locked).toBe(false);
	await handlePayformWebhook(request());
	expect(moveBookPreorderDealStage).toHaveBeenCalledTimes(2);
});
