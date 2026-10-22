import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	setSystemTime,
	spyOn,
	test,
} from "bun:test";
import type { DeliverOutreachPayload } from "./outreach";

let run: (payload: DeliverOutreachPayload) => Promise<unknown>;
mock.module("@hatchet-dev/typescript-sdk/v1", () => ({
	ConcurrencyLimitStrategy: { GROUP_ROUND_ROBIN: "GROUP_ROUND_ROBIN" },
	CreateTaskWorkflow: (config: { fn: typeof run }) => {
		run = config.fn;
		return config;
	},
}));

const start = new Date("2026-10-22T20:00:00Z");
const until = new Date("2026-10-23T07:00:00Z");
const payload = { campaignId: "campaign" };
const campaign = {
	id: payload.campaignId,
	status: "running",
	message: "Hello",
	accounts: { max: { openLineId: "line", connectorId: "connector" } },
	settings: {
		channels: [
			{
				channel: "max",
				minIntervalSec: 30,
				maxIntervalSec: 60,
				dailyLimit: null,
				batchSize: null,
				batchPauseMin: 10,
			},
		],
		onDailyLimit: "wait",
		window: { days: [1, 2, 3, 4, 5], fromHour: 10, toHour: 20 },
	},
};
const createSchedule = mock(async () => {});
const runNoWait = mock(async () => {});
mock.module("./client", () => ({
	getHatchetClient: () => ({
		scheduled: { create: createSchedule },
		runNoWait,
	}),
}));
const sleep = mock(async (_ms: number) => {});
mock.module("../messenger", () => ({ sleep }));
const send = mock(async () => {
	throw new Error("Must not send outside the sending window");
});
mock.module("../outreach/senders", () => ({
	createMaxSender: () => ({ channel: "max", send }),
	createTelegramSender: () => ({ channel: "telegram", send }),
	createWhatsappSender: () => ({ channel: "whatsapp", send }),
}));
mock.module("./outreach-email", () => ({
	startEmailFallback: mock(async () => 0),
}));
const setPause = mock(async () => {});
const finishCampaign = mock(async () => {});
mock.module("@psi-opora/db/queries", () => ({
	getOutreachCampaign: async () => campaign,
	getOutreachAccountUsage: async () => [],
	markOutreachCampaignRunning: async () => {},
	markInterruptedOutreachRecipients: async () => {},
	listOutreachRecipientsByStatus: async () => [
		{ id: "recipient", phone: "+70000000000", name: null, attempts: [] },
	],
	updateOutreachRecipient: async () => {},
	setOutreachCampaignPause: setPause,
	finishOutreachCampaign: finishCampaign,
	insertBotMessage: async () => {},
}));

await import("./outreach");

describe("outreach continuation", () => {
	beforeEach(() => {
		setSystemTime(start);
		mock.clearAllMocks();
		spyOn(console, "error").mockImplementation(() => {});
	});
	afterEach(() => {
		mock.restore();
		setSystemTime();
	});

	test("creates one scheduled continuation and records its pause", async () => {
		await expect(run(payload)).resolves.toMatchObject({ continued: true });
		expect(createSchedule).toHaveBeenCalledWith("outreach-deliver", {
			triggerAt: until,
			input: payload,
		});
		expect(setPause).toHaveBeenCalledWith(campaign.id, {
			resumeAt: until,
			reason: "Вне окна отправки",
		});
		expect(runNoWait).not.toHaveBeenCalled();
		expect(sleep).not.toHaveBeenCalled();
		expect(send).not.toHaveBeenCalled();
	});

	test("backs off before continuing when scheduling fails", async () => {
		createSchedule.mockRejectedValueOnce(new Error("Scheduler unavailable"));
		const sleeping = Promise.withResolvers<void>();
		const wake = Promise.withResolvers<void>();
		sleep.mockImplementationOnce(async () => {
			sleeping.resolve();
			await wake.promise;
		});
		const pending = run(payload);
		await sleeping.promise;
		expect(sleep).toHaveBeenCalledWith(60_000);
		expect(runNoWait).not.toHaveBeenCalled();
		setSystemTime(new Date(start.getTime() + 60_000));
		wake.resolve();
		await expect(pending).resolves.toMatchObject({ continued: true });
		expect(runNoWait).toHaveBeenCalledTimes(1);
		expect(runNoWait).toHaveBeenCalledWith(expect.anything(), payload);
		expect(send).not.toHaveBeenCalled();
	});

	test.each([30_000, 0, -1_000])(
		"limits the retry delay to the remaining wait (%s ms)",
		async (remaining) => {
			createSchedule.mockImplementationOnce(async () => {
				setSystemTime(new Date(until.getTime() - remaining));
				throw new Error("Scheduler unavailable");
			});
			await expect(run(payload)).resolves.toMatchObject({ continued: true });
			expect(sleep).toHaveBeenCalledWith(Math.max(0, remaining));
			expect(runNoWait).toHaveBeenCalledTimes(1);
		},
	);

	test("pause write failure preserves the existing scheduled continuation", async () => {
		setPause.mockRejectedValueOnce(new Error("Pause write failed"));
		await expect(run(payload)).resolves.toMatchObject({ continued: true });
		expect(createSchedule).toHaveBeenCalledTimes(1);
		expect(runNoWait).not.toHaveBeenCalled();
		expect(sleep).not.toHaveBeenCalled();
		expect(finishCampaign).not.toHaveBeenCalled();
	});
});
