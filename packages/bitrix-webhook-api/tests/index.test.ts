import { describe, expect, test } from "bun:test";
import {
	type BitrixWebhookPayload,
	getOperatorReplyMessage,
} from "../src/index";

describe("getOperatorReplyMessage", () => {
	test("сохраняет внешний и внутренний ID сообщения", () => {
		const payload: BitrixWebhookPayload = {
			event: "ONIMCONNECTORMESSAGEADD",
			data: {
				CONNECTOR: "psiopora_max_bot",
				LINE: 7,
				MESSAGES: [
					{
						im: { chat_id: 10, message_id: 42 },
						chat: { id: 32263492 },
						message: {
							id: "operator-17-1234567890",
							text: " Ответ оператора ",
							user_id: 17,
						},
					},
				],
			},
		};

		expect(getOperatorReplyMessage(payload)).toEqual({
			connector: "psiopora_max_bot",
			lineId: 7,
			chatId: 32263492,
			text: "Ответ оператора",
			externalMessageId: "operator-17-1234567890",
			bitrixMessageId: 42,
			operatorUserId: 17,
		});
	});
});
