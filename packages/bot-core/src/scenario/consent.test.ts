import { describe, expect, test } from "bun:test";
import { startBookPreorder } from "./book-preorder/engine";
import { hasRecordedConsent, needsKnownContact } from "./consent";
import {
	applyScenarioAction,
	type GuideCampaignContext,
	startConsultation,
	startGuideCampaign,
	startScenario,
	withName,
} from "./engine";
import { DEFAULT_SCENARIO_TEXTS as t } from "./texts";

const CONSENT_AT = "2026-10-17T10:00:00.000Z";

const campaign: GuideCampaignContext = {
	id: "campaign-1",
	keyword: "ШКОЛА",
	title: "Гайд про школу",
	guideId: "guide-1",
	welcomeMessage: "Здравствуйте!",
	emailQuestion: "На какой email прислать гайд про школу?",
	emailSubject: "Ваш гайд",
	emailBody: "Гайд во вложении",
	deliveryMessage: "Держите гайд",
};

describe("hasRecordedConsent", () => {
	test("согласие отмечено в карточке CRM", () => {
		expect(hasRecordedConsent({ consentGranted: true })).toBe(true);
	});

	test("контакт есть в CRM, но согласие не отмечено — этого недостаточно", () => {
		expect(hasRecordedConsent({ name: "Иван", phone: "+79991234567" })).toBe(
			false,
		);
		expect(hasRecordedConsent({ consentGranted: false })).toBe(false);
	});

	test("клиент не распознан", () => {
		expect(hasRecordedConsent(null)).toBe(false);
		expect(hasRecordedConsent(undefined)).toBe(false);
	});
});

describe("needsKnownContact", () => {
	test("выбор на старте ведёт к экрану согласия — ищем клиента заранее", () => {
		expect(needsKnownContact({ step: "entry" }, "sc_consult")).toBe(true);
		expect(needsKnownContact({ step: "entry" }, "sc_guide")).toBe(true);
	});

	test("согласие в флоу консультации — ищем для подстановки данных", () => {
		expect(
			needsKnownContact({ step: "consent", flow: "consult" }, "consent_agree"),
		).toBe(true);
	});

	test("на остальных шагах в CRM не ходим", () => {
		expect(needsKnownContact(undefined, "consent_agree")).toBe(false);
		expect(
			needsKnownContact({ step: "consent", flow: "guide" }, "consent_agree"),
		).toBe(false);
		expect(
			needsKnownContact(
				{ step: "consent", flow: "consult" },
				"consent_decline",
			),
		).toBe(false);
		expect(needsKnownContact({ step: "category" }, "sc_child")).toBe(false);
	});
});

describe("согласие уже отмечено в CRM — экран согласия не показываем", () => {
	test("консультация: известны имя и телефон — заявка уходит сразу", () => {
		const out = startConsultation(t, {
			name: "Иван",
			phone: "+79991234567",
			email: "ivan@example.com",
			consentGranted: true,
			consentAt: CONSENT_AT,
		});
		expect(out.state.step).toBe("done");
		expect(out.lead).toEqual({
			flow: "consult",
			phone: "+79991234567",
			email: "ivan@example.com",
			name: "Иван",
			consentAt: CONSENT_AT,
		});
		expect(out.messages.map((m) => m.text)).toEqual([
			withName(t.consult_success, "Иван"),
		]);
		expect(out.track).toEqual(["consult_click", "consent"]);
	});

	test("консультация: известно только имя — сразу вопрос о телефоне", () => {
		const out = startConsultation(t, { name: "Мария", consentGranted: true });
		expect(out.state.step).toBe("phone");
		expect(out.state.name).toBe("Мария");
		// Даты согласия в карточке нет — свою не выдумываем.
		expect(out.state.consentAt).toBeUndefined();
		expect(out.messages.map((m) => m.text)).toEqual([
			withName(t.consult_phone_question, "Мария"),
		]);
	});

	test("консультация: в карточке только отметка о согласии — спрашиваем имя", () => {
		const out = startConsultation(t, {
			consentGranted: true,
			consentAt: CONSENT_AT,
		});
		expect(out.state.step).toBe("name");
		expect(out.state.consentAt).toBe(CONSENT_AT);
		expect(out.messages.map((m) => m.text)).toEqual([t.name_question]);
	});

	test("кнопка «Записаться» в общем меню — тоже без согласия", () => {
		const out = applyScenarioAction(
			startScenario(t).state,
			"sc_consult",
			t,
			null,
			{ consentGranted: true },
		);
		expect(out?.state.step).toBe("name");
		expect(out?.state.flow).toBe("consult");
	});

	test("кнопка «Получить гайд» — сразу выбор категории", () => {
		const out = applyScenarioAction(
			startScenario(t).state,
			"sc_guide",
			t,
			null,
			{ name: "Иван", consentGranted: true, consentAt: CONSENT_AT },
		);
		expect(out?.state.step).toBe("category");
		expect(out?.state.flow).toBe("guide");
		expect(out?.state.consentAt).toBe(CONSENT_AT);
		// Имя из CRM флоу гайда не использует — как и после кнопки согласия.
		expect(out?.state.name).toBeUndefined();
		expect(out?.track).toEqual(["guide_click", "consent"]);
	});

	test("кодовое слово кампании — приветствие и сразу вопрос про email", () => {
		const out = startGuideCampaign(campaign, t, {
			consentGranted: true,
			consentAt: CONSENT_AT,
		});
		expect(out.state).toMatchObject({
			step: "email",
			flow: "guide",
			campaignId: "campaign-1",
			audience: "child",
			consentAt: CONSENT_AT,
		});
		expect(out.messages.map((m) => m.text)).toEqual([
			"Здравствуйте!",
			campaign.emailQuestion,
		]);
		expect(out.track).toEqual(["guide_click", "consent"]);
	});

	test("предзаказ книги — сразу вопрос об имени", () => {
		const out = startBookPreorder(t, "vk", "pay", {
			consentGranted: true,
			consentAt: CONSENT_AT,
		});
		expect(out.state).toMatchObject({
			step: "name",
			source: "vk",
			intent: "pay",
			consentAt: CONSENT_AT,
		});
		expect(out.messages.map((m) => m.text)).toEqual([t.bp_name_question]);
	});
});

describe("согласие в CRM не отмечено — экран согласия остаётся", () => {
	const known = { name: "Иван", phone: "+79991234567" };

	test("консультация", () => {
		const out = startConsultation(t, known);
		expect(out.state.step).toBe("consent");
		expect(out.lead).toBeUndefined();
		expect(out.track).toEqual(["consult_click"]);
	});

	test("гайд из общего меню", () => {
		const out = applyScenarioAction(
			startScenario(t).state,
			"sc_guide",
			t,
			null,
			known,
		);
		expect(out?.state.step).toBe("consent");
		expect(out?.track).toEqual(["guide_click"]);
	});

	test("кодовое слово кампании", () => {
		const out = startGuideCampaign(campaign, t, known);
		expect(out.state.step).toBe("consent");
		expect(out.messages).toHaveLength(2);
	});

	test("предзаказ книги", () => {
		expect(startBookPreorder(t, undefined, undefined, known).state.step).toBe(
			"consent",
		);
		expect(startBookPreorder(t).state.step).toBe("consent");
	});
});
