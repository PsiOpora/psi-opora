import { beforeEach, describe, expect, mock, test } from "bun:test";

interface SettingsRow {
	counterId: string | null;
	oauthToken: string | null;
	goalId: string | null;
	bitrixClientIdField: string | null;
}

let settings: SettingsRow | null = {
	counterId: "12345",
	oauthToken: "test-token",
	goalId: "consultation_booked",
	bitrixClientIdField: null,
};
const getYandexMetrikaSettings = mock(async () => settings);
mock.module("@psi-opora/db/queries", () => ({ getYandexMetrikaSettings }));

const warn = mock(() => {});
const error = mock(() => {});
const info = mock(() => {});
mock.module("@psi-opora/config", () => ({
	logger: { warn, error, info },
}));

const { sendConsultationGoalToYandexMetrika } = await import(
	"./yandex-metrika"
);

describe("sendConsultationGoalToYandexMetrika", () => {
	beforeEach(() => {
		settings = {
			counterId: "12345",
			oauthToken: "test-token",
			goalId: "consultation_booked",
			bitrixClientIdField: null,
		};
		getYandexMetrikaSettings.mockClear();
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

	test("без настроек в БД — не отправляет запрос и логирует warn", async () => {
		settings = null;
		const fetchMock = mock(async () => new Response("{}", { status: 200 }));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const ok = await sendConsultationGoalToYandexMetrika({ clientId: "123" });

		expect(ok).toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledTimes(1);
	});

	test("без ClientID и без yclid — не отправляет запрос", async () => {
		const fetchMock = mock(async () => new Response("{}", { status: 200 }));
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const ok = await sendConsultationGoalToYandexMetrika({ clientId: "" });

		expect(ok).toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test("без ClientID, но с yclid — отправляет CSV Yclid/Target/DateTime без client_id_type", async () => {
		let capturedUrl: RequestInfo | URL | undefined;
		let capturedInit: RequestInit | undefined;
		const fetchMock = mock(
			async (url: RequestInfo | URL, init?: RequestInit) => {
				capturedUrl = url;
				capturedInit = init;
				return new Response("{}", { status: 200 });
			},
		);
		globalThis.fetch = fetchMock;

		const ok = await sendConsultationGoalToYandexMetrika({
			yclid: "1234567890123456",
			dealId: 42,
			occurredAt: new Date("2026-01-01T00:00:00Z"),
		});

		expect(ok).toBe(true);
		expect(capturedUrl).toBe(
			"https://api-metrika.yandex.net/management/v1/counter/12345/offline_conversions/upload",
		);
		const form = capturedInit?.body as FormData;
		const file = form.get("file") as File;
		expect(await file.text()).toBe(
			"Yclid,Target,DateTime\n1234567890123456,consultation_booked,1767225600\n",
		);
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
