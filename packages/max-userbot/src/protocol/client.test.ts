import { describe, expect, test } from "bun:test";
import { nextFrameSequence } from "./client";

describe("nextFrameSequence", () => {
	test("зацикливает uint16 sequence без переполнения заголовка", () => {
		expect(nextFrameSequence(65_534)).toBe(65_535);
		expect(nextFrameSequence(65_535)).toBe(1);
	});

	test("не переиспользует sequence ожидающего запроса", () => {
		expect(nextFrameSequence(65_535, (seq) => seq === 1)).toBe(2);
	});
});
