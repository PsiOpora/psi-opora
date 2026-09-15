import { afterEach, describe, expect, test } from "bun:test";
import {
	findMaxId,
	findTelegram,
	messengerByConnectorId,
	type RawContact,
} from "./broadcast-send";

const originalTelegramConnectorId = process.env.TG_BITRIX_CONNECTOR_ID;
const originalMaxConnectorId = process.env.MAX_BITRIX_CONNECTOR_ID;

afterEach(() => {
	if (originalTelegramConnectorId === undefined) {
		delete process.env.TG_BITRIX_CONNECTOR_ID;
	} else {
		process.env.TG_BITRIX_CONNECTOR_ID = originalTelegramConnectorId;
	}
	if (originalMaxConnectorId === undefined) {
		delete process.env.MAX_BITRIX_CONNECTOR_ID;
	} else {
		process.env.MAX_BITRIX_CONNECTOR_ID = originalMaxConnectorId;
	}
});

function contactWithIm(valueType: string, value: string): RawContact {
	return {
		ID: "1",
		IM: [{ VALUE_TYPE: valueType, VALUE: value }],
	};
}

describe("messengerByConnectorId", () => {
	test("recognizes standard names and safe aliases", () => {
		expect(messengerByConnectorId("max")).toBe("max");
		expect(messengerByConnectorId("telegram")).toBe("telegram");
		expect(messengerByConnectorId("tg")).toBe("telegram");
		expect(messengerByConnectorId("psiopora_max_bot")).toBe("max");
		expect(messengerByConnectorId("psiopora-tg-bot")).toBe("telegram");
	});

	test("uses exact configured connector IDs", () => {
		process.env.MAX_BITRIX_CONNECTOR_ID = "customConnector42";
		process.env.TG_BITRIX_CONNECTOR_ID = "anotherConnector";

		expect(messengerByConnectorId("CUSTOMCONNECTOR42")).toBe("max");
		expect(messengerByConnectorId("anotherConnector")).toBe("telegram");
	});

	test("does not match aliases inside unrelated words", () => {
		expect(messengerByConnectorId("maximum_connector")).toBeNull();
		expect(messengerByConnectorId("target_gateway")).toBeNull();
	});
});

describe("contact messenger fields", () => {
	test("supports direct Telegram and MAX field types", () => {
		expect(findTelegram(contactWithIm("TELEGRAM", "12345"), [])).toEqual({
			userId: "12345",
		});
		expect(findMaxId(contactWithIm("MAX", "67890"), [])).toBe("67890");
	});

	test("supports standard IMOL connector names", () => {
		expect(
			findTelegram(contactWithIm("IMOL", "imol|telegram|2|12345|448"), []),
		).toEqual({ userId: "12345" });
		expect(findMaxId(contactWithIm("IMOL", "imol|max|2|67890|449"), [])).toBe(
			"67890",
		);
	});

	test("supports real custom Bitrix connector IDs", () => {
		process.env.MAX_BITRIX_CONNECTOR_ID = "psiopora_max_bot";
		process.env.TG_BITRIX_CONNECTOR_ID = "psiopora_tg_bot";

		expect(
			findMaxId(
				contactWithIm("IMOL", "imol|psiopora_max_bot|2|11283473|448"),
				[],
			),
		).toBe("11283473");
		expect(
			findTelegram(
				contactWithIm("IMOL", "imol|psiopora_tg_bot|2|998877|449"),
				[],
			),
		).toEqual({ userId: "998877" });
	});

	test("ignores malformed and foreign IMOL values", () => {
		expect(findMaxId(contactWithIm("IMOL", "imol|max|2||448"), [])).toBeNull();
		expect(
			findMaxId(
				contactWithIm("IMOL", "imol|foreign_connector|2|11283473|448"),
				[],
			),
		).toBeNull();
	});
});
