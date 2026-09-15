import { describe, expect, test } from "bun:test";
import {
	applyScenarioAction,
	applyScenarioText,
	buildReminder,
	describeLead,
	type ScenarioOutput,
	startConsultation,
	startScenario,
} from "./engine";
import { DEFAULT_SCENARIO_TEXTS as t } from "./texts";

/** Прогоняет цепочку действий/текстов, возвращает последний output. */
async function run(
	steps: Array<{ action?: string; text?: string }>,
): Promise<ScenarioOutput> {
	let out = startScenario(t);
	for (const step of steps) {
		const next = step.action
			? // biome-ignore lint/suspicious/noExplicitAny: тесты передают и невалидные action
				applyScenarioAction(out.state, step.action as any, t)
			: await applyScenarioText(out.state, step.text ?? "", t);
		if (!next) throw new Error(`шаг не обработан: ${JSON.stringify(step)}`);
		out = next;
	}
	return out;
}

describe("startScenario", () => {
	test("приветствие с выбором: консультация или гайд, трекается start", async () => {
		const out = startScenario(t);
		expect(out.state.step).toBe("entry");
		expect(out.messages[0]?.text).toBe(t.welcome);
		expect(out.messages[0]?.buttons?.flat().map((b) => b.action)).toEqual([
			"sc_consult",
			"sc_guide",
		]);
		expect(out.track).toEqual(["start"]);
		expect(out.awaitingInput).toBe(true);
	});
});

describe("флоу «запись на консультацию»", () => {
	test("кнопка «Записаться» показывает согласие на ПДн", async () => {
		const out = await run([{ action: "sc_consult" }]);
		expect(out.state.step).toBe("consent");
		expect(out.state.flow).toBe("consult");
		expect(out.track).toEqual(["consult_click"]);
		expect(out.messages[0]?.text).toBe(t.consent_text);
		// btn_consent_decline по умолчанию пустой — кнопка отказа скрыта
		// (см. бот Андрея Клюева, hint в texts.ts).
		expect(out.messages[0]?.buttons?.flat().map((b) => b.action)).toEqual([
			"consent_agree",
		]);
	});

	test("полный путь: согласие → имя → телефон → email → сделка", async () => {
		const out = await run([
			{ action: "sc_consult" },
			{ action: "consent_agree" },
			{ text: "Анна" },
			{ text: "+7 999 123-45-67" },
			{ text: "anna@example.com" },
		]);

		expect(out.state.step).toBe("done");
		expect(out.lead).toEqual({
			flow: "consult",
			phone: "+7 999 123-45-67",
			email: "anna@example.com",
			name: "Анна",
			consentAt: out.lead?.consentAt,
		});
		expect(out.lead?.consentAt).toBeTruthy();
		expect(out.messages[0]?.text).toContain("Анна");
		expect(out.awaitingInput).toBe(false);
	});

	test("согласие на ПДн ведёт сразу к вопросу об имени, без шага рекламы", async () => {
		const consent = await run([
			{ action: "sc_consult" },
			{ action: "consent_agree" },
		]);
		expect(consent.state.step).toBe("name");
		expect(consent.state.consentAt).toBeTruthy();
		expect(consent.track).toEqual(["consent"]);
		expect(consent.messages.map((m) => m.text)).toEqual([
			t.consent_agreed,
			t.name_question,
		]);

		// consult_phone_question по умолчанию не содержит {name} — см. ТЗ
		// (сообщение 3: «Введите ваш номер телефона...», без обращения по имени).
		const name = await applyScenarioText(consent.state, "Пётр", t);
		expect(name?.track).toEqual(["name"]);
		expect(name?.messages[0]?.text).toBe(t.consult_phone_question);
		expect(name?.state.step).toBe("phone");
	});

	test("отказ от согласия завершает сценарий без заявки", async () => {
		const out = await run([
			{ action: "sc_consult" },
			{ action: "consent_decline" },
		]);
		expect(out.state.step).toBe("done");
		expect(out.lead).toBeUndefined();
		expect(out.messages[0]?.text).toBe(t.consent_declined);
	});

	test("вопрос email в флоу консультации содержит кнопку «без email»", async () => {
		const out = await run([
			{ action: "sc_consult" },
			{ action: "consent_agree" },
			{ text: "Анна" },
			{ text: "89991234567" },
		]);
		expect(out.state.step).toBe("email");
		expect(
			out.messages
				.at(-1)
				?.buttons?.flat()
				.map((b) => b.action),
		).toEqual(["sc_skip_email"]);
	});

	test("кнопка «без email» в флоу консультации сразу заводит заявку", async () => {
		const out = await run([
			{ action: "sc_consult" },
			{ action: "consent_agree" },
			{ text: "Анна" },
			{ text: "89991234567" },
			{ action: "sc_skip_email" },
		]);
		expect(out.state.step).toBe("done");
		expect(out.lead?.email).toBeUndefined();
		expect(out.lead?.phone).toBe("89991234567");
		expect(out.lead?.name).toBe("Анна");
		expect(out.messages).toHaveLength(1);
		expect(out.messages[0]?.text).toContain("Анна");
	});

	test("после 3 нераспознанных email — сделка без email", async () => {
		const out = await run([
			{ action: "sc_consult" },
			{ action: "consent_agree" },
			{ text: "Анна" },
			{ text: "89991234567" },
			{ text: "не email" },
			{ text: "снова нет" },
			{ text: "и это нет" },
		]);
		expect(out.state.step).toBe("done");
		expect(out.lead?.email).toBeUndefined();
		expect(out.lead?.phone).toBe("89991234567");
		expect(out.messages.map((m) => m.text)[0]).toBe(
			t.consult_email_invalid_final,
		);
	});

	test("после 3 нераспознанных телефонов сценарий завершается без заявки", async () => {
		const out = await run([
			{ action: "sc_consult" },
			{ action: "consent_agree" },
			{ text: "Анна" },
			{ text: "абв" },
			{ text: "где" },
			{ text: "ёжз" },
		]);
		expect(out.state.step).toBe("done");
		expect(out.lead).toBeUndefined();
		expect(out.messages[0]?.text).toBe(t.consult_phone_invalid_final);
	});

	test("startConsultation — вход по старой кнопке «Записаться»", async () => {
		const out = startConsultation(t);
		expect(out.state.step).toBe("consent");
		expect(out.state.flow).toBe("consult");
		expect(out.track).toEqual(["consult_click"]);
	});
});

describe("флоу гайда: ветка «трудности с ребенком»", () => {
	test("полный путь: гайд → согласие → категория → тема → email → телефон → заявка", async () => {
		const out = await run([
			{ action: "sc_guide" },
			{ action: "consent_agree" },
			{ action: "sc_child" },
			{ action: "sc_eating" },
			{ text: "parent@example.com" },
			{ text: "+7 999 123-45-67" },
		]);

		expect(out.state.step).toBe("done");
		expect(out.lead).toEqual({
			flow: "guide",
			phone: "+7 999 123-45-67",
			email: "parent@example.com",
			audience: "child",
			issue: "eating",
			consentAt: out.lead?.consentAt,
		});
		expect(out.lead?.consentAt).toBeTruthy();
		expect(out.track).toEqual(["phone"]);
		expect(out.messages.map((m) => m.text)).toEqual([t.phone_thanks]);
	});

	test("кнопка «Получить гайд» ведёт к согласию на ПДн", async () => {
		const out = await run([{ action: "sc_guide" }]);
		expect(out.state.step).toBe("consent");
		expect(out.state.flow).toBe("guide");
		expect(out.track).toEqual(["guide_click"]);
		expect(out.messages[0]?.buttons?.flat().map((b) => b.action)).toEqual([
			"consent_agree",
		]);
	});

	test("согласие в флоу гайда ведёт сразу к вопросу о категории, без шага рекламы", async () => {
		const out = await run([
			{ action: "sc_guide" },
			{ action: "consent_agree" },
		]);
		expect(out.state.step).toBe("category");
		expect(out.track).toEqual(["consent"]);
		expect(out.messages.map((m) => m.text)).toEqual([
			t.consent_agreed,
			t.category_question,
		]);
		expect(out.messages[1]?.buttons?.flat().map((b) => b.action)).toEqual([
			"sc_child",
			"sc_self",
		]);
	});

	test("отказ от согласия завершает флоу гайда без заявки", async () => {
		const out = await run([
			{ action: "sc_guide" },
			{ action: "consent_decline" },
		]);
		expect(out.state.step).toBe("done");
		expect(out.lead).toBeUndefined();
		expect(out.messages[0]?.text).toBe(t.consent_declined);
	});

	test("email принят — отправляется гайд и запрос телефона", async () => {
		const out = await run([
			{ action: "sc_guide" },
			{ action: "consent_agree" },
			{ action: "sc_child" },
			{ action: "sc_other" },
			{ text: "parent@example.com" },
		]);
		expect(out.state.step).toBe("phone");
		expect(out.track).toEqual(["email"]);
		expect(out.messages.map((m) => m.text)).toEqual([
			t.lead_magnet,
			t.phone_question,
		]);
		expect(out.contact).toEqual({
			email: "parent@example.com",
			consentAt: out.contact?.consentAt,
		});
		expect(out.contact?.consentAt).toBeTruthy();
	});

	test("кнопка «без email» всё равно выдаёт гайд в чат перед вопросом о телефоне", async () => {
		const out = await run([
			{ action: "sc_guide" },
			{ action: "consent_agree" },
			{ action: "sc_child" },
			{ action: "sc_eating" },
			{ action: "sc_skip_email" },
		]);
		expect(out.state.step).toBe("phone");
		expect(out.state.email).toBeUndefined();
		expect(out.messages.map((m) => m.text)).toEqual([
			t.lead_magnet_no_email,
			t.phone_question,
		]);
		expect(out.messages[0]?.guide).toBe(true);
	});

	test("после 3 нераспознанных email — гайд всё равно уходит в чат, дальше телефон", async () => {
		const out = await run([
			{ action: "sc_guide" },
			{ action: "consent_agree" },
			{ action: "sc_child" },
			{ action: "sc_eating" },
			{ text: "не email" },
			{ text: "тоже не email" },
			{ text: "и это нет" },
		]);
		expect(out.state.step).toBe("phone");
		expect(out.state.email).toBeUndefined();
		expect(out.messages.map((m) => m.text)).toEqual([
			t.lead_magnet_no_email,
			t.phone_question,
		]);
		expect(out.messages[0]?.guide).toBe(true);
	});
});

describe("флоу гайда: ветка «помощь для себя»", () => {
	test("телефон → заявка + вопрос о рассылке", async () => {
		const out = await run([
			{ action: "sc_guide" },
			{ action: "consent_agree" },
			{ action: "sc_self" },
			{ action: "sc_other" },
			{ text: "89991234567" },
		]);
		expect(out.state.step).toBe("subscribe");
		expect(out.lead?.audience).toBe("self");
		expect(out.track).toEqual(["phone"]);
		expect(out.messages[0]?.text).toBe(t.subscribe_question);
	});

	test("согласие на рассылку трекается и уходит эффектом", async () => {
		const out = await run([
			{ action: "sc_guide" },
			{ action: "consent_agree" },
			{ action: "sc_self" },
			{ action: "sc_eating" },
			{ text: "89991234567" },
			{ action: "sc_sub_yes" },
		]);
		expect(out.state.step).toBe("done");
		expect(out.track).toEqual(["subscribe"]);
		expect(out.subscribeChoice).toBe("yes");
		expect(out.messages.map((m) => m.text)).toEqual([t.subscribe_yes_reply]);
	});

	test("отказ от рассылки завершает сценарий без трекинга", async () => {
		const out = await run([
			{ action: "sc_guide" },
			{ action: "consent_agree" },
			{ action: "sc_self" },
			{ action: "sc_other" },
			{ text: "89991234567" },
			{ action: "sc_sub_no" },
		]);
		expect(out.state.step).toBe("done");
		expect(out.track).toEqual([]);
		expect(out.subscribeChoice).toBe("no");
	});
});

describe("отказ от телефона и лимиты (флоу гайда)", () => {
	test("«не оставлять телефон» в ветке «для себя» всё равно спрашивает про рассылку", async () => {
		const out = await run([
			{ action: "sc_guide" },
			{ action: "consent_agree" },
			{ action: "sc_self" },
			{ action: "sc_other" },
			{ action: "sc_skip_phone" },
		]);
		expect(out.state.step).toBe("subscribe");
		expect(out.lead).toBeUndefined();
		expect(out.messages.map((m) => m.text)).toEqual([
			t.phone_declined,
			t.subscribe_question,
		]);
	});

	test("«не оставлять телефон» в ветке «ребёнок» завершает без заявки", async () => {
		const out = await run([
			{ action: "sc_guide" },
			{ action: "consent_agree" },
			{ action: "sc_child" },
			{ action: "sc_eating" },
			{ action: "sc_skip_email" },
			{ action: "sc_skip_phone" },
		]);
		expect(out.state.step).toBe("done");
		expect(out.lead).toBeUndefined();
		expect(out.messages.map((m) => m.text)).toEqual([t.phone_declined]);
	});

	test("после 3 нераспознанных телефонов в ветке «ребёнок» сценарий завершается", async () => {
		const out = await run([
			{ action: "sc_guide" },
			{ action: "consent_agree" },
			{ action: "sc_child" },
			{ action: "sc_eating" },
			{ action: "sc_skip_email" },
			{ text: "абв" },
			{ text: "где" },
			{ text: "ёжз" },
		]);
		expect(out.state.step).toBe("done");
		expect(out.lead).toBeUndefined();
	});

	test("после 3 нераспознанных телефонов в ветке «для себя» тоже спрашивает про рассылку", async () => {
		const out = await run([
			{ action: "sc_guide" },
			{ action: "consent_agree" },
			{ action: "sc_self" },
			{ action: "sc_other" },
			{ text: "абв" },
			{ text: "где" },
			{ text: "ёжз" },
		]);
		expect(out.state.step).toBe("subscribe");
		expect(out.lead).toBeUndefined();
	});
});

describe("флоу гайда: тема «ОКР»", () => {
	test("кнопка «ОКР» — третий вариант темы, помимо питания и «другого»", async () => {
		const category = await run([
			{ action: "sc_guide" },
			{ action: "consent_agree" },
			{ action: "sc_self" },
		]);
		expect(category.messages[0]?.buttons?.flat().map((b) => b.action)).toEqual([
			"sc_eating",
			"sc_ocd",
			"sc_other",
		]);

		const issue = applyScenarioAction(category.state, "sc_ocd", t);
		expect(issue?.state.issue).toBe("ocd");
	});

	test("заявка с темой «ОКР» доходит до сделки", async () => {
		const out = await run([
			{ action: "sc_guide" },
			{ action: "consent_agree" },
			{ action: "sc_self" },
			{ action: "sc_ocd" },
			{ text: "89991234567" },
		]);
		expect(out.lead?.issue).toBe("ocd");
	});
});

describe("устойчивость к неожиданному вводу", () => {
	test("кнопка чужого шага игнорируется (null)", async () => {
		const start = startScenario(t);
		expect(applyScenarioAction(start.state, "sc_eating", t)).toBeNull();
		expect(applyScenarioAction(start.state, "sc_sub_yes", t)).toBeNull();
		expect(applyScenarioAction(start.state, "consent_agree", t)).toBeNull();
	});

	test("текст на кнопочном шаге повторяет вопрос только один раз", async () => {
		const start = startScenario(t);
		const first = await applyScenarioText(start.state, "привет", t);
		expect(first?.messages[0]?.text).toBe(t.welcome);
		const second = await applyScenarioText(
			first?.state ?? start.state,
			"ещё",
			t,
		);
		expect(second).toBeNull();
	});

	test("после завершения сценария текст игнорируется", async () => {
		const out = await run([
			{ action: "sc_guide" },
			{ action: "consent_agree" },
			{ action: "sc_child" },
			{ action: "sc_eating" },
			{ action: "sc_skip_email" },
			{ action: "sc_skip_phone" },
		]);
		expect(await applyScenarioText(out.state, "любой текст", t)).toBeNull();
	});

	test("выбор кнопки сбрасывает nudged — вопрос повторится на новом шаге", async () => {
		const start = startScenario(t);
		const nudged = await applyScenarioText(start.state, "привет", t);
		const next = applyScenarioAction(
			nudged?.state ?? start.state,
			"sc_guide",
			t,
		);
		expect(next?.state.nudged).toBe(false);
	});
});

describe("напоминания", () => {
	test("на старте — текст напоминания с кнопками выбора", async () => {
		const start = startScenario(t);
		const reminder = buildReminder(start.state, t);
		expect(reminder?.text).toBe(t.reminder);
		expect(reminder?.buttons?.flat().map((b) => b.action)).toEqual([
			"sc_consult",
			"sc_guide",
		]);
	});

	test("на шаге согласия — кнопки согласия", async () => {
		const out = await run([{ action: "sc_consult" }]);
		const reminder = buildReminder(out.state, t);
		expect(reminder?.buttons?.flat().map((b) => b.action)).toEqual([
			"consent_agree",
		]);
	});

	test("после завершения напоминать нечего", async () => {
		const out = await run([
			{ action: "sc_guide" },
			{ action: "consent_agree" },
			{ action: "sc_child" },
			{ action: "sc_eating" },
			{ action: "sc_skip_email" },
			{ action: "sc_skip_phone" },
		]);
		expect(buildReminder(out.state, t)).toBeNull();
	});
});

describe("describeLead", () => {
	test("гайд: комментарий содержит подписи кнопок категории и темы", async () => {
		const comment = describeLead(
			{ flow: "guide", phone: "+7", audience: "child", issue: "eating" },
			t,
		);
		expect(comment).toContain(t.btn_child);
		expect(comment).toContain(t.btn_issue_eating);
	});

	test("гайд: тема «ОКР» тоже попадает в комментарий", async () => {
		const comment = describeLead(
			{ flow: "guide", phone: "+7", audience: "self", issue: "ocd" },
			t,
		);
		expect(comment).toContain(t.btn_issue_ocd);
	});

	test("консультация: комментарий указывает источник заявки", async () => {
		const comment = describeLead(
			{ flow: "consult", phone: "+7", name: "Анна" },
			t,
		);
		expect(comment).toContain(t.btn_consult);
	});
});
