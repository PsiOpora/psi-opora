import { describe, expect, mock, test } from "bun:test";
import type { Update } from "@maxhub/max-bot-api/types";
import type { ConsultationSession, StorageAdapter } from "@psi-opora/bot-core";

// Keep database-backed side effects out of this handler test. The MAX adapter
// imports the same scenario graph as the Telegram bot, so all statically
// imported query functions must be available before importing the adapter.
mock.module("@psi-opora/db/queries", () => ({
	insertBotMessage: () => Promise.resolve(null),
	getBitrixCrmLink: () => Promise.resolve(null),
	getBotTextsRecord: () => Promise.resolve({}),
	getBotConnector: () => Promise.resolve(null),
	getBotUserProfile: () => Promise.resolve(null),
	getConversationMeta: () => Promise.resolve(null),
	addClientNote: () => Promise.resolve(),
	addConversationTag: () => Promise.resolve(),
	upsertBotFunnelEvent: () => Promise.resolve(),
	upsertBitrixCrmLink: () => Promise.resolve(),
	upsertBotUser: () => Promise.resolve(),
	getYandexMetrikaSettings: () => Promise.resolve(null),
	upsertBookPreorderOrder: () => Promise.resolve(null),
	markBookPreorderAwaitingPayment: () => Promise.resolve(),
	markBookPreorderDeclined: () => Promise.resolve(),
	markBookPreorderReserved: () => Promise.resolve(),
	getBookPreorderOrderByOrderNo: () => Promise.resolve(null),
	recordBookPreorderDripAnyClick: () => Promise.resolve(),
	recordBookPreorderDripDeferred: () => Promise.resolve(),
	getEmailProvider: () => Promise.resolve(null),
	getUnisenderSettings: () => Promise.resolve(null),
	getRusenderSettings: () => Promise.resolve(null),
	getSmtpBzSettings: () => Promise.resolve(null),
	getResendSettings: () => Promise.resolve(null),
	getBotGuideCampaign: () => Promise.resolve(null),
	getBotGuideCampaignByKeyword: () => Promise.resolve(null),
	getPendingGuideDiagnosticDelivery: () => Promise.resolve(null),
	markGuideDiagnosticRequested: () => Promise.resolve(),
	upsertBotGuideDelivery: () => Promise.resolve(),
	markBotMessageGuideEmailSent: () => Promise.resolve(),
}));
mock.module("./avatar-storage.js", () => ({
	uploadMaxAvatar: () => Promise.resolve({ avatarS3Key: "test-avatar" }),
	uploadMaxMedia: () => Promise.resolve({ mediaS3Key: "test-media" }),
}));

const { AppContext, createMaxBot } = await import("./bot");
const { DEFAULT_SCENARIO_TEXTS: t } = await import("@psi-opora/bot-core");

const user = {
	user_id: 100,
	name: "U",
	first_name: "U",
	username: null,
	is_bot: false,
	last_activity_time: 0,
};

function botStartedUpdate(): Update {
	return {
		update_type: "bot_started",
		timestamp: 1,
		chat_id: 100,
		user,
	};
}

function callbackUpdate(payload: string, timestamp: number): Update {
	return {
		update_type: "message_callback",
		timestamp,
		callback: {
			timestamp,
			callback_id: `callback-${timestamp}`,
			payload,
			user,
		},
		message: {
			sender: user,
			timestamp,
			recipient: {
				chat_id: 100,
				chat_type: "dialog",
				user_id: 100,
				post_id: null,
			},
			body: { mid: String(timestamp), seq: timestamp, text: null },
		},
	};
}

function textUpdate(text: string, timestamp: number): Update {
	return {
		update_type: "message_created",
		timestamp,
		message: {
			sender: user,
			timestamp,
			recipient: {
				chat_id: 100,
				chat_type: "dialog",
				user_id: 100,
				post_id: null,
			},
			body: { mid: String(timestamp), seq: timestamp, text },
		},
	};
}

async function dispatch(bot: ReturnType<typeof createMaxBot>, update: Update) {
	const ctx = new AppContext(update, bot.api);
	await bot.middleware()(ctx, () => Promise.resolve());
}

describe("MAX-бот: сброс предзаказа книги", () => {
	test("обычный сценарий принимает имя после незавершённой брони книги", async () => {
		const sessions = new Map<string, ConsultationSession>([
			[
				"100",
				{
					step: "name",
					bookPreorder: {
						step: "reserved",
						name: "Пётр",
						phone: "+7 999 111-22-33",
						consentAt: "2026-01-01T00:00:00.000Z",
						nudged: 0,
					},
				},
			],
		]);
		const storage: StorageAdapter<ConsultationSession> = {
			read: (key) => sessions.get(key),
			write: (key, value) => void sessions.set(key, value),
			delete: (key) => void sessions.delete(key),
		};
		const bot = createMaxBot({ storage, token: "test-token" });
		const sent: string[] = [];
		bot.api.getChat = mock(() => Promise.resolve({ icon: null })) as never;
		bot.api.sendMessageToChat = mock((_chatId: number, text: string) => {
			sent.push(text);
			return Promise.resolve({});
		}) as never;
		bot.api.answerOnCallback = mock(() => Promise.resolve({})) as never;

		// A normal MAX start dispatches the ordinary scenario and must clear the
		// stale book-preorder state before the customer continues this flow.
		await dispatch(bot, botStartedUpdate());
		await dispatch(bot, callbackUpdate("sc_consult", 2));
		await dispatch(bot, callbackUpdate("consent_agree", 3));
		await dispatch(bot, textUpdate("Анна", 4));

		expect(sent.at(-1)).toBe(t.consult_phone_question);
		expect(sessions.get("100")?.bookPreorder).toBeUndefined();
	});
});
