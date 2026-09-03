import { beforeEach, describe, expect, mock, test } from "bun:test";

const envMock: Record<string, string | undefined> = {
	YANDEX_METRIKA_COUNTER_ID: "12345",
	YANDEX_METRIKA_OAUTH_TOKEN: "test-token",
	YANDEX_METRIKA_CONSULTATION_GOAL: "consultation_booked",
};
const warn = mock(() => {});
const error = mock(() => {});
const info = mock(() => {});
mock.module("@psi-opora/config", () => ({
	env: envMock,
	logger: { warn, error, info },
}));

const { sendConsultationGoalToYandexMetrika } = await import(
	"./yandex-metrika"
);

describe("sendConsultationGoalToYandexMetrika", () => {
	beforeEach(() => {
		envMock.YANDEX_METRIKA_COUNTER_ID = "12345";
		envMock.YANDEX_METRIKA_OAUTH_TOKEN = "test-token";
		envMock.YANDEX_METRIKA_CONSULTATION_GOAL = "consultation_booked";
		warn.mockClear();
		error.mockClear();
		info.mockClear();
	});

	test("отправляет CSV ClientId/Target/DateTime с OAuth-токеном на upload-эндпоинт", async () => {
		let capturedUrl: string | undefined;
		let capturedInit: RequestInit | undefined;
		const fetchMock = mock(async (url: string, init: RequestInit) => {
			capturedUrl = url;
			capturedInit = init;
			return new Response("{}", { status: 200 });
		});
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const ok = await sendConsultationGoalToYandexMetrika({
			clientId: "163972457524306386",
			dealId: 42,
			occurredAt: new Date("2026-01-01T00:00:00Z"),
		});

		expect(ok).toBe(true);
		expect(capturedUrl).toBe(
			"https://api-metrika.yandex.net/management/v1/counter/12345/offline_conversions/upload?client_id_type=CLIENT_ID",
		);
		expect(capturedInit?.method).toBe("POST");
		const headers = capturedInit?.headers as Record<string, string>;
		expect(headers.Authorization).toBe("OAuth test-token");

		const form = capturedInit?.body as FormData;
		const file = form.get("file") as File;
		expect(await file.text()).toBe(
			"ClientId,Target,DateTime\n163972457524306386,consultation_booked,1767225600\n",
		);
	});

	test("без счётчика или токена — не отправляет запрос и логирует warn", async () => {
		envMock.YANDEX_METRIKA_COUNTER_ID = undefined;
		const fetchMock = mock(async () => new Response("{}", { status: 200 }));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const ok = await sendConsultationGoalToYandexMetrika({ clientId: "123" });

		expect(ok).toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledTimes(1);
	});

	test("без ClientID — не отправляет запрос", async () => {
		const fetchMock = mock(async () => new Response("{}", { status: 200 }));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const ok = await sendConsultationGoalToYandexMetrika({ clientId: "" });

		expect(ok).toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test("HTTP-ошибка Метрики — возвращает false и логирует error", async () => {
		const fetchMock = mock(
			async () => new Response("bad request", { status: 400 }),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const ok = await sendConsultationGoalToYandexMetrika({ clientId: "123" });

		expect(ok).toBe(false);
		expect(error).toHaveBeenCalledTimes(1);
	});
});
