import { beforeEach, describe, expect, mock, test } from "bun:test";

class FakeSentCode {
	constructor(public phoneCodeHash: string) {}
}

/** Мини-заглушка tl.RpcError — реальный класс генерируется из схемы TL,
 * нам нужен только `.is(err, text)` для ветвления SESSION_PASSWORD_NEEDED. */
class FakeRpcError extends Error {
	constructor(public text: string) {
		super(text);
	}
	static is(err: unknown, text: string): boolean {
		return err instanceof FakeRpcError && err.text === text;
	}
}

const CREDENTIALS = { apiId: 12345, apiHash: "test-hash" };

let nextSendCodeResult: unknown = new FakeSentCode("hash-1");
let nextSignInError: unknown = null;
let exportedSession = "session-string";

const destroyMock = mock(() => Promise.resolve());
const importSessionMock = mock(() => Promise.resolve());
const constructorMock = mock((_opts: unknown) => {});

mock.module("@mtcute/core", () => ({
	MemoryStorage: class {},
	SentCode: FakeSentCode,
	tl: { RpcError: FakeRpcError },
}));

mock.module("@mtcute/node", () => ({
	TelegramClient: class {
		constructor(opts: unknown) {
			constructorMock(opts);
		}
		sendCode = mock(() => Promise.resolve(nextSendCodeResult));
		signIn = mock(() => {
			if (nextSignInError) return Promise.reject(nextSignInError);
			return Promise.resolve({});
		});
		checkPassword = mock(() => Promise.resolve({}));
		exportSession = mock(() => Promise.resolve(exportedSession));
		importSession = importSessionMock;
		destroy = destroyMock;
	},
}));

const { confirmLoginCode, confirmLoginPassword, sendLoginCode } = await import(
	"./login"
);

beforeEach(() => {
	nextSendCodeResult = new FakeSentCode("hash-1");
	nextSignInError = null;
	exportedSession = "session-string";
	destroyMock.mockClear();
	importSessionMock.mockClear();
	constructorMock.mockClear();
});

describe("sendLoginCode", () => {
	test("возвращает pendingSession и phoneCodeHash, закрывает клиент", async () => {
		const result = await sendLoginCode("+70000000000", CREDENTIALS);
		expect(result).toEqual({
			pendingSession: "session-string",
			phoneCodeHash: "hash-1",
		});
		expect(destroyMock).toHaveBeenCalledTimes(1);
	});

	test("создаёт клиент с переданными apiId/apiHash, а не из env", async () => {
		await sendLoginCode("+70000000000", CREDENTIALS);
		expect(constructorMock).toHaveBeenCalledWith(
			expect.objectContaining({ apiId: 12345, apiHash: "test-hash" }),
		);
	});

	test("если Telegram вернул уже авторизованного User — бросает понятную ошибку", async () => {
		nextSendCodeResult = { id: 1 }; // не instanceof SentCode
		await expect(sendLoginCode("+70000000000", CREDENTIALS)).rejects.toThrow(
			/уже авторизован/,
		);
		expect(destroyMock).toHaveBeenCalledTimes(1);
	});
});

describe("confirmLoginCode", () => {
	test("успешный вход возвращает connected + сессию", async () => {
		const result = await confirmLoginCode(
			{
				pendingSession: "p",
				phone: "+7",
				phoneCodeHash: "hash-1",
				code: "12345",
			},
			CREDENTIALS,
		);
		expect(result).toEqual({ status: "connected", session: "session-string" });
		expect(importSessionMock).toHaveBeenCalledWith("p");
	});

	test("SESSION_PASSWORD_NEEDED переводит в password_required, не пробрасывая ошибку", async () => {
		nextSignInError = new FakeRpcError("SESSION_PASSWORD_NEEDED");
		const result = await confirmLoginCode(
			{
				pendingSession: "p",
				phone: "+7",
				phoneCodeHash: "hash-1",
				code: "12345",
			},
			CREDENTIALS,
		);
		expect(result).toEqual({
			status: "password_required",
			pendingSession: "session-string",
		});
	});

	test("прочие ошибки signIn пробрасываются наружу как есть", async () => {
		nextSignInError = new FakeRpcError("PHONE_CODE_INVALID");
		await expect(
			confirmLoginCode(
				{
					pendingSession: "p",
					phone: "+7",
					phoneCodeHash: "hash-1",
					code: "00000",
				},
				CREDENTIALS,
			),
		).rejects.toThrow("PHONE_CODE_INVALID");
	});

	test("клиент закрывается даже при ошибке", async () => {
		nextSignInError = new FakeRpcError("PHONE_CODE_INVALID");
		await confirmLoginCode(
			{
				pendingSession: "p",
				phone: "+7",
				phoneCodeHash: "hash-1",
				code: "00000",
			},
			CREDENTIALS,
		).catch(() => {});
		expect(destroyMock).toHaveBeenCalledTimes(1);
	});
});

describe("confirmLoginPassword", () => {
	test("успешный ввод 2FA-пароля возвращает connected + сессию", async () => {
		const result = await confirmLoginPassword(
			{ pendingSession: "p", password: "secret" },
			CREDENTIALS,
		);
		expect(result).toEqual({ status: "connected", session: "session-string" });
	});
});
