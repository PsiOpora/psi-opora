import { beforeEach, describe, expect, mock, test } from "bun:test";

let dialog: { dealId: number | null } | null = null;
let dialogError: Error | null = null;
const resolveOpenLineDialog = mock(
	(_messenger: string, _userId: number, _chatId: number) =>
		dialogError ? Promise.reject(dialogError) : Promise.resolve(dialog),
);

const appendDealComment = mock(
	(_messenger: string, _dealId: number, _comment: string) => Promise.resolve(),
);

// Зависимости передаём явно, а не через mock.module: тот глобален для всего
// прогона и конфликтует с другими тестами, мокающими ./openline и ./sources.
const deps = {
	resolveDialog: resolveOpenLineDialog as never,
	appendComment: appendDealComment as never,
};

const { appendPhoneToDealComment } = await import("./phone-fallback");

describe("appendPhoneToDealComment", () => {
	beforeEach(() => {
		resolveOpenLineDialog.mockClear();
		appendDealComment.mockClear();
		dialog = null;
		dialogError = null;
	});

	test("пишет телефон комментарием в сделку трекера Открытой линии", async () => {
		dialog = { dealId: 6104 };

		const ok = await appendPhoneToDealComment(
			{
				messenger: "max",
				userId: 49043323,
				chatId: 49043323,
				phone: "9109084657",
			},
			deps,
		);

		expect(ok).toBe(true);
		expect(resolveOpenLineDialog).toHaveBeenCalledWith(
			"max",
			49043323,
			49043323,
		);
		expect(appendDealComment).toHaveBeenCalledTimes(1);
		const [messenger, dealId, comment] = appendDealComment.mock.calls[0] ?? [];
		expect(messenger).toBe("max");
		expect(dealId).toBe(6104);
		expect(comment).toContain("9109084657");
	});

	test("без chatId использует userId — как у MAX", async () => {
		dialog = { dealId: 1 };

		await appendPhoneToDealComment(
			{
				messenger: "max",
				userId: 77,
				phone: "9109084657",
			},
			deps,
		);

		expect(resolveOpenLineDialog).toHaveBeenCalledWith("max", 77, 77);
	});

	test("у трекера нет сделки — ничего не пишет", async () => {
		dialog = { dealId: null };

		const ok = await appendPhoneToDealComment(
			{
				messenger: "max",
				userId: 1,
				phone: "9109084657",
			},
			deps,
		);

		expect(ok).toBe(false);
		expect(appendDealComment).not.toHaveBeenCalled();
	});

	test("диалога нет — ничего не пишет", async () => {
		const ok = await appendPhoneToDealComment(
			{
				messenger: "max",
				userId: 1,
				phone: "9109084657",
			},
			deps,
		);

		expect(ok).toBe(false);
		expect(appendDealComment).not.toHaveBeenCalled();
	});

	test("пустой телефон или нет userId — Bitrix не трогает", async () => {
		expect(
			await appendPhoneToDealComment(
				{
					messenger: "max",
					userId: 1,
					phone: "",
				},
				deps,
			),
		).toBe(false);
		expect(
			await appendPhoneToDealComment(
				{ messenger: "max", phone: "9109084657" },
				deps,
			),
		).toBe(false);
		expect(resolveOpenLineDialog).not.toHaveBeenCalled();
	});

	test("ошибка поиска диалога не пробрасывается", async () => {
		dialogError = new Error("bitrix упал");

		const ok = await appendPhoneToDealComment(
			{
				messenger: "max",
				userId: 1,
				phone: "9109084657",
			},
			deps,
		);

		expect(ok).toBe(false);
		expect(appendDealComment).not.toHaveBeenCalled();
	});
});
