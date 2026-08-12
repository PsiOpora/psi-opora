import { describe, expect, test } from "bun:test";
import { wahaSessionHealth, wahaSessionPhoneMatches } from "./index";

describe("wahaSessionHealth", () => {
	test("returns error for a missing or failed session", () => {
		expect(wahaSessionHealth(null).status).toBe("error");
		expect(wahaSessionHealth({ status: "FAILED" }).status).toBe("error");
	});

	test("returns limited while reachout timelock is active", () => {
		const health = wahaSessionHealth(
			{
				status: "WORKING",
				me: {
					reachoutTimelock: {
						isActive: true,
						timeEnforcementEnds: 2_000,
					},
				},
			},
			1_000,
		);
		expect(health.status).toBe("limited");
	});

	test("returns connected when the limit has expired", () => {
		expect(
			wahaSessionHealth(
				{
					status: "WORKING",
					me: {
						reachoutTimelock: {
							isActive: true,
							timeEnforcementEnds: 999,
						},
					},
				},
				1_000,
			).status,
		).toBe("connected");
	});
});

describe("wahaSessionPhoneMatches", () => {
	test("normalizes a Russian leading 8", () => {
		expect(
			wahaSessionPhoneMatches(
				{ me: { id: "79679953114@c.us" } },
				"8 (967) 995-31-14",
			),
		).toBe(true);
	});

	test("rejects a different linked number", () => {
		expect(
			wahaSessionPhoneMatches(
				{ me: { id: "79679953114@c.us" } },
				"+7 985 725-73-97",
			),
		).toBe(false);
	});
});
