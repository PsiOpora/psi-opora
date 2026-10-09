import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { BitrixApi } from "@psi-opora/bitrix-client";

interface StageGoal {
	id: string;
	goalId: string;
}

let hasGoals = true;
let stageGoals: StageGoal[] = [];
let visitor: { clientId: string | null; yclid: string | null } | null = null;
let bitrixClientIdField: string | null = null;
const claimed = new Set<string>();

const listEnabledYandexMetrikaGoalsForStage = mock(
	async (_stageId: string, _categoryId: string) => stageGoals,
);
const claimYandexMetrikaGoalEvent = mock(
	async (goalId: string, dealId: string) => {
		const key = `${goalId}:${dealId}`;
		if (claimed.has(key)) return false;
		claimed.add(key);
		return true;
	},
);
const releaseYandexMetrikaGoalEvent = mock(
	async (goalId: string, dealId: string) => {
		claimed.delete(`${goalId}:${dealId}`);
	},
);
mock.module("@psi-opora/db/queries", () => ({
	hasEnabledYandexMetrikaStageGoals: mock(async () => hasGoals),
	listEnabledYandexMetrikaGoalsForStage,
	getYandexMetrikaDealVisitor: mock(async () => visitor),
	getYandexMetrikaSettings: mock(async () => ({ bitrixClientIdField })),
	claimYandexMetrikaGoalEvent,
	releaseYandexMetrikaGoalEvent,
}));

let sendResult = true;
const sendYandexMetrikaGoal = mock(
	async (_params: Record<string, unknown>) => sendResult,
);
mock.module("@psi-opora/bot-core", () => ({ sendYandexMetrikaGoal }));

const warn = mock(() => {});
mock.module("@psi-opora/config", () => ({ logger: { warn } }));

const { handleYandexMetrikaStageGoals } = await import(
	"./yandex-metrika-stage-goals"
);

function apiWithDeal(deal: Record<string, unknown> | false): BitrixApi {
	return {
		async call<T>() {
			return deal as T;
		},
		async list() {
			throw new Error("Unexpected list");
		},
	};
}

describe("handleYandexMetrikaStageGoals", () => {
	beforeEach(() => {
		hasGoals = true;
		stageGoals = [{ id: "g1", goalId: "consultation_paid" }];
		visitor = { clientId: "111", yclid: null };
		bitrixClientIdField = null;
		sendResult = true;
		claimed.clear();
		listEnabledYandexMetrikaGoalsForStage.mockClear();
		claimYandexMetrikaGoalEvent.mockClear();
		releaseYandexMetrikaGoalEvent.mockClear();
		sendYandexMetrikaGoal.mockClear();
		warn.mockClear();
	});

	it("отправляет цель стадии по ClientID сделки", async () => {
		const result = await handleYandexMetrikaStageGoals(
			apiWithDeal({ STAGE_ID: "C2:WON", CATEGORY_ID: "2" }),
			42,
		);

		expect(result).toEqual({ sent: ["consultation_paid"] });
		expect(listEnabledYandexMetrikaGoalsForStage).toHaveBeenCalledWith(
			"C2:WON",
			"2",
		);
		expect(sendYandexMetrikaGoal).toHaveBeenCalledWith({
			target: "consultation_paid",
			clientId: "111",
			yclid: undefined,
			dealId: 42,
		});
	});

	it("не обращается к Bitrix, если нет включённых целей", async () => {
		hasGoals = false;
		const api = apiWithDeal(false);
		const call = mock(api.call);
		api.call = call as BitrixApi["call"];

		const result = await handleYandexMetrikaStageGoals(api, 42);

		expect(result).toEqual({ sent: [], skipped: "no_goals" });
		expect(call).not.toHaveBeenCalled();
	});

	it("пропускает стадию без привязанных целей", async () => {
		stageGoals = [];

		const result = await handleYandexMetrikaStageGoals(
			apiWithDeal({ STAGE_ID: "NEW", CATEGORY_ID: "0" }),
			42,
		);

		expect(result).toEqual({ sent: [], skipped: "no_goals_for_stage" });
		expect(sendYandexMetrikaGoal).not.toHaveBeenCalled();
	});

	it("повторное событие по той же сделке не дублирует конверсию", async () => {
		const api = apiWithDeal({ STAGE_ID: "C2:WON", CATEGORY_ID: "2" });

		await handleYandexMetrikaStageGoals(api, 42);
		const second = await handleYandexMetrikaStageGoals(api, 42);

		expect(second).toEqual({ sent: [] });
		expect(sendYandexMetrikaGoal).toHaveBeenCalledTimes(1);
	});

	it("берёт ClientID из поля Bitrix, если бот его не запомнил", async () => {
		visitor = null;
		bitrixClientIdField = "UF_CRM_YM";

		const result = await handleYandexMetrikaStageGoals(
			apiWithDeal({
				STAGE_ID: "C2:WON",
				CATEGORY_ID: "2",
				UF_CRM_YM: " 777 ",
			}),
			42,
		);

		expect(result.sent).toEqual(["consultation_paid"]);
		expect(sendYandexMetrikaGoal).toHaveBeenCalledWith(
			expect.objectContaining({ clientId: "777" }),
		);
	});

	it("сделка без ClientID и yclid пропускается без отправки", async () => {
		visitor = null;

		const result = await handleYandexMetrikaStageGoals(
			apiWithDeal({ STAGE_ID: "C2:WON", CATEGORY_ID: "2" }),
			42,
		);

		expect(result).toEqual({ sent: [], skipped: "no_visitor" });
		expect(sendYandexMetrikaGoal).not.toHaveBeenCalled();
		expect(claimYandexMetrikaGoalEvent).not.toHaveBeenCalled();
	});

	it("неудачная отправка снимает занятость — следующее событие повторит попытку", async () => {
		sendResult = false;
		const api = apiWithDeal({ STAGE_ID: "C2:WON", CATEGORY_ID: "2" });

		const first = await handleYandexMetrikaStageGoals(api, 42);
		sendResult = true;
		const second = await handleYandexMetrikaStageGoals(api, 42);

		expect(first).toEqual({ sent: [] });
		expect(releaseYandexMetrikaGoalEvent).toHaveBeenCalledTimes(1);
		expect(second).toEqual({ sent: ["consultation_paid"] });
	});
});
