import { describe, expect, test } from "bun:test";
import { planContactMerge } from "./contact-merge";

describe("planContactMerge", () => {
	test("новые контакты вставляются", () => {
		const plan = planContactMerge(
			[],
			[{ email: "a@x.ru", name: "Анна" }, { phone: "+79990000001" }],
		);
		expect(plan.inserts).toEqual([
			{ email: "a@x.ru", phone: null, name: "Анна" },
			{ email: null, phone: "+79990000001", name: null },
		]);
		expect(plan.updates).toEqual([]);
	});

	test("повтор внутри импорта склеивается по телефону и по email", () => {
		const plan = planContactMerge(
			[],
			[
				{ phone: "+79990000001", name: "Иван" },
				{ phone: "+79990000001", email: "ivan@x.ru" },
				{ email: "ivan@x.ru" },
			],
		);
		expect(plan.inserts).toEqual([
			{ email: "ivan@x.ru", phone: "+79990000001", name: "Иван" },
		]);
		expect(plan.duplicatesInBatch).toBe(2);
	});

	test("строка дополняет существующий контакт, а не дублирует его", () => {
		const plan = planContactMerge(
			[{ id: "c1", email: "ivan@x.ru", phone: null, name: null }],
			[{ email: "ivan@x.ru", phone: "+79990000001", name: "Иван" }],
		);
		expect(plan.inserts).toEqual([]);
		expect(plan.updates).toEqual([
			{ id: "c1", email: "ivan@x.ru", phone: "+79990000001", name: "Иван" },
		]);
		expect(plan.matchedExisting).toBe(1);
	});

	test("без изменений существующий контакт не обновляется", () => {
		const plan = planContactMerge(
			[{ id: "c1", email: "ivan@x.ru", phone: "+79990000001", name: "Иван" }],
			[{ phone: "+79990000001" }],
		);
		expect(plan.updates).toEqual([]);
		expect(plan.inserts).toEqual([]);
	});

	test("телефон одного контакта и email другого — контакты склеиваются", () => {
		const plan = planContactMerge(
			[
				{ id: "c1", email: null, phone: "+79990000001", name: null },
				{ id: "c2", email: "petr@x.ru", phone: null, name: "Пётр" },
			],
			[{ phone: "+79990000001", email: "petr@x.ru" }],
		);
		expect(plan.inserts).toEqual([]);
		expect(plan.updates).toEqual([]);
		expect(plan.merges).toEqual([
			{
				keep: {
					id: "c1",
					email: "petr@x.ru",
					phone: "+79990000001",
					name: "Пётр",
				},
				absorbedIds: ["c2"],
			},
		]);
		expect(plan.conflicts).toBe(0);
	});

	test("несовместимые контакты не склеиваются — конфликт без дубля", () => {
		const plan = planContactMerge(
			[
				{ id: "c1", email: "ivan@x.ru", phone: "+79990000001", name: null },
				{ id: "c2", email: "petr@x.ru", phone: null, name: null },
			],
			[{ phone: "+79990000001", email: "petr@x.ru" }],
		);
		expect(plan.inserts).toEqual([]);
		expect(plan.updates).toEqual([]);
		expect(plan.merges).toEqual([]);
		expect(plan.conflicts).toBe(1);
	});

	test("внутри импорта: email, телефон, затем строка с обоими — один контакт", () => {
		const plan = planContactMerge(
			[],
			[
				{ email: "anna@x.ru" },
				{ phone: "+79990000003", name: "Анна" },
				{ email: "anna@x.ru", phone: "+79990000003" },
			],
		);
		expect(plan.inserts).toEqual([
			{ email: "anna@x.ru", phone: "+79990000003", name: "Анна" },
		]);
		expect(plan.conflicts).toBe(0);
	});

	test("существующий email-контакт поглощает новый телефонный из импорта", () => {
		const plan = planContactMerge(
			[{ id: "c1", email: "anna@x.ru", phone: null, name: null }],
			[
				{ phone: "+79990000003" },
				{ email: "anna@x.ru", phone: "+79990000003" },
			],
		);
		expect(plan.inserts).toEqual([]);
		expect(plan.merges).toEqual([]);
		expect(plan.updates).toEqual([
			{ id: "c1", email: "anna@x.ru", phone: "+79990000003", name: null },
		]);
	});

	test("другой телефон у найденного по email контакта не перезаписывается", () => {
		const plan = planContactMerge(
			[{ id: "c1", email: "ivan@x.ru", phone: "+79990000001", name: null }],
			[{ email: "ivan@x.ru", phone: "+79990000002", name: "Иван" }],
		);
		expect(plan.inserts).toEqual([]);
		expect(plan.updates).toEqual([
			{ id: "c1", email: "ivan@x.ru", phone: "+79990000001", name: "Иван" },
		]);
		expect(plan.conflicts).toBe(1);
	});

	test("строки без телефона и email пропускаются", () => {
		const plan = planContactMerge([], [{ name: "Без контактов" }]);
		expect(plan.inserts).toEqual([]);
	});
});
