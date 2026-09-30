import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";
import { MaxLoginFlow } from "./login";
import {
	MaxProtocolClient,
	type MaxProtocolClientOptions,
} from "./protocol/client";
import { OPCODE } from "./protocol/opcodes";

type Responder = (
	opcode: number,
	payload: Record<string, unknown>,
) => Record<string, unknown>;

const requests: Array<{ opcode: number; payload: Record<string, unknown> }> =
	[];
let connections = 0;
let respond: Responder = () => ({});
let closeConnection: ((error: Error) => void) | undefined;

beforeEach(() => {
	requests.length = 0;
	connections = 0;
	spyOn(MaxProtocolClient.prototype, "connect").mockImplementation(
		async function (this: MaxProtocolClient) {
			connections += 1;
			// Capture the callback without replacing the module for other test files.
			closeConnection = (
				this as unknown as { options: MaxProtocolClientOptions }
			).options.onClose;
		},
	);
	spyOn(MaxProtocolClient.prototype, "close").mockImplementation(() => {});
	spyOn(MaxProtocolClient.prototype, "request").mockImplementation(
		async (opcode, payload) => {
			requests.push({ opcode, payload });
			if (opcode === OPCODE.SESSION_INIT) return {};
			if (opcode === OPCODE.AUTH_REQUEST)
				return { token: "verify-token", codeLength: 6 };
			return respond(opcode, payload);
		},
	);
});

afterEach(() => mock.restore());

describe("MaxLoginFlow", () => {
	test("без облачного пароля возвращает сессию после кода", async () => {
		respond = () => ({ tokenAttrs: { LOGIN: { token: "login-token" } } });
		const { flow, result } = await MaxLoginFlow.start("+79991234567");
		expect(result).toEqual({
			status: "code_sent",
			phone: "+79991234567",
			codeLength: 6,
		});
		const connected = await flow.submitCode("123456");
		flow.close();
		expect(connected.status).toBe("connected");
		if (connected.status !== "connected") return;
		expect(JSON.parse(connected.session).sessionToken).toBe("login-token");
	});

	test("код и облачный пароль идут по тому же соединению", async () => {
		respond = (opcode) =>
			opcode === OPCODE.AUTH
				? {
						tokenAttrs: {},
						passwordChallenge: { trackId: "track-1", hint: "!" },
					}
				: { tokenAttrs: { LOGIN: { token: "login-token" } } };
		const { flow } = await MaxLoginFlow.start("+79991234567");
		const challenge = await flow.submitCode("123456");
		expect(challenge).toMatchObject({ status: "password_required", hint: "!" });

		const connected = await flow.submitPassword("secret");
		flow.close();
		expect(connections).toBe(1);
		expect(requests.at(-1)).toEqual({
			opcode: OPCODE.AUTH_LOGIN_CHECK_PASSWORD,
			payload: { trackId: "track-1", password: "secret" },
		});
		expect(JSON.parse(connected.session).sessionToken).toBe("login-token");
	});

	test("неверный пароль не завершает вход", async () => {
		let attempts = 0;
		respond = (opcode) => {
			if (opcode === OPCODE.AUTH)
				return { tokenAttrs: {}, passwordChallenge: { trackId: "track-1" } };
			attempts += 1;
			return attempts === 1
				? { error: "password.invalid" }
				: { tokenAttrs: { LOGIN: { token: "login-token" } } };
		};
		const { flow } = await MaxLoginFlow.start("+79991234567");
		await flow.submitCode("123456");
		await expect(flow.submitPassword("wrong")).rejects.toThrow(
			/Неверный облачный пароль/,
		);
		const connected = await flow.submitPassword("right");
		flow.close();
		expect(connected.status).toBe("connected");
	});

	test.each(["service.unavailable", "password.attempts.exceeded"])(
		"сохраняет исходную ошибку проверки пароля: %s",
		async (error) => {
			respond = (opcode) =>
				opcode === OPCODE.AUTH
					? { passwordChallenge: { trackId: "track-1" } }
					: { error };
			const { flow } = await MaxLoginFlow.start("+79991234567");
			try {
				await flow.submitCode("123456");
				await expect(flow.submitPassword("secret")).rejects.toThrow(error);
			} finally {
				flow.close();
			}
		},
	);

	test("не шлёт пароль, если сервер его не запрашивал", async () => {
		const { flow } = await MaxLoginFlow.start("+79991234567");
		const sent = requests.length;
		await expect(flow.submitPassword("secret")).rejects.toThrow(
			/не запрашивал/,
		);
		flow.close();
		expect(requests).toHaveLength(sent);
	});

	test("после обрыва соединения просит начать заново", async () => {
		const { flow } = await MaxLoginFlow.start("+79991234567");
		const clearPing = spyOn(globalThis, "clearInterval");
		try {
			closeConnection?.(new Error("closed"));
			expect(clearPing).toHaveBeenCalledTimes(1);
		} finally {
			clearPing.mockRestore();
		}
		expect(flow.connectionLost).toBe(true);
		await expect(flow.submitCode("123456")).rejects.toThrow(
			/запросите код заново/,
		);
		flow.close();
	});
});
