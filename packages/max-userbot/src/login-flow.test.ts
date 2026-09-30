import { beforeEach, describe, expect, mock, test } from "bun:test";
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

// mock.module подменяет модуль на весь процесс bun test — остальные экспорты
// (nextFrameSequence для client.test.ts) оставляем настоящими.
const actualClient = await import("./protocol/client");
mock.module("./protocol/client", () => ({
	...actualClient,
	MaxProtocolClient: class {
		constructor(options: { onClose?: (error: Error) => void } = {}) {
			closeConnection = options.onClose;
		}
		async connect() {
			connections += 1;
		}
		close() {}
		async request(opcode: number, payload: Record<string, unknown>) {
			requests.push({ opcode, payload });
			if (opcode === OPCODE.SESSION_INIT) return {};
			if (opcode === OPCODE.AUTH_REQUEST)
				return { token: "verify-token", codeLength: 6 };
			return respond(opcode, payload);
		}
	},
}));

const { MaxLoginFlow } = await import("./login");

beforeEach(() => {
	requests.length = 0;
	connections = 0;
});

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
		closeConnection?.(new Error("closed"));
		expect(flow.connectionLost).toBe(true);
		await expect(flow.submitCode("123456")).rejects.toThrow(
			/запросите код заново/,
		);
		flow.close();
	});
});
