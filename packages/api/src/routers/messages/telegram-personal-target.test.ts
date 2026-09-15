import { describe, expect, mock, test } from "bun:test";
import { resolveTelegramPersonalTarget } from "./telegram-personal-target";

describe("resolveTelegramPersonalTarget", () => {
	test("распознаёт старый ключ-телефон через связанный CRM-контакт", async () => {
		const api = {
			call: mock(() =>
				Promise.resolve({
					PHONE: [{ VALUE: "+7 (987) 094-85-76" }],
				}),
			),
			list: mock(() => Promise.resolve([])),
		};
		const getLink = mock(() =>
			Promise.resolve({
				id: "telegram-personal:79870948576",
				messenger: "telegram-personal",
				userId: "79870948576",
				contactId: "7604",
				dealId: null,
				updatedAt: new Date(),
			}),
		);

		await expect(
			resolveTelegramPersonalTarget(api, "79870948576", getLink),
		).resolves.toEqual({
			kind: "phone",
			value: "79870948576",
		});
	});

	test("оставляет канонический Telegram ID как id", async () => {
		const api = {
			call: mock(() =>
				Promise.resolve({
					PHONE: [{ VALUE: "+79870948576" }],
				}),
			),
			list: mock(() => Promise.resolve([])),
		};
		const getLink = mock(() => Promise.resolve(null));

		await expect(
			resolveTelegramPersonalTarget(api, "987654321", getLink),
		).resolves.toEqual({
			kind: "id",
			value: "987654321",
		});
	});
});
