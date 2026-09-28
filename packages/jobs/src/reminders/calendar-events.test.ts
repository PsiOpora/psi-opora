import { describe, expect, it } from "bun:test";
import { findDuplicateCalendarEvent, phoneKey } from "./calendar-events";

const from = new Date("2026-09-28T18:00:00+03:00");
const to = new Date("2026-09-28T19:30:00+03:00");

// Время в формате calendar.event.get: "28.09.2026 18:00:00" по Москве.
function moscow(time: string, day = "28.09.2026"): string {
	return `${day} ${time}:00`;
}

function event(
	id: string,
	start: string,
	end: string,
	extra: Record<string, unknown> = {},
) {
	return {
		ID: id,
		DATE_FROM: moscow(start),
		DATE_TO: moscow(end),
		TZ_OFFSET_FROM: "10800",
		TZ_OFFSET_TO: "10800",
		// Как на реальном портале: "UTC"-метка сдвинута и не должна
		// использоваться для сравнения.
		DATE_FROM_TS_UTC: "1",
		DATE_TO_TS_UTC: "2145992400",
		...extra,
	};
}

describe("phoneKey", () => {
	it("treats +7, 8 and bare 7 prefixes as the same number", () => {
		expect(phoneKey("+7 (953) 661-30-66")).toBe("9536613066");
		expect(phoneKey("89536613066")).toBe("9536613066");
		expect(phoneKey("12345")).toBe("");
	});
});

describe("findDuplicateCalendarEvent", () => {
	const params = { dealId: 5920, phone: "+79053413340", from, to };

	it("prefers an overlapping event linked to the same deal", () => {
		const match = findDuplicateCalendarEvent(
			[
				event("1", "18:00", "19:00", { NAME: "Ирина 8 905 341-33-40" }),
				event("2", "18:00", "19:00", { UF_CRM_CAL_EVENT: ["D_5920", "C_44"] }),
			],
			params,
		);
		expect(match).toEqual({ id: 2, source: "deal" });
	});

	it("finds a manual entry by the client's phone", () => {
		const match = findDuplicateCalendarEvent(
			[
				event("3", "18:00", "18:30", {
					NAME: "б/п консультация Ирина +7 905 341-33-40",
				}),
			],
			params,
		);
		expect(match).toEqual({ id: 3, source: "phone" });
	});

	it("ignores events at another time, of other clients and all-day ones", () => {
		const match = findDuplicateCalendarEvent(
			[
				event("4", "14:00", "14:30", { UF_CRM_CAL_EVENT: ["D_5920"] }),
				event("5", "19:30", "20:00", { UF_CRM_CAL_EVENT: ["D_5920"] }),
				event("6", "18:00", "19:00", { NAME: "Bukza Наталья 89801764799" }),
				event("7", "00:00", "00:00", {
					DATE_TO: moscow("00:00", "29.09.2026"),
					DT_SKIP_TIME: "Y",
					UF_CRM_CAL_EVENT: ["D_5920"],
				}),
			],
			params,
		);
		expect(match).toBeNull();
	});

	it("checks each occurrence of a recurring series by its own time", () => {
		const series = (day: string) =>
			event("8", "17:00", "17:45", {
				DATE_FROM: moscow("17:00", day),
				DATE_TO: moscow("17:45", day),
				RRULE: { FREQ: "DAILY" },
				NAME: "Ирина +79053413340",
			});
		expect(
			findDuplicateCalendarEvent(
				[series("27.09.2026"), series("28.09.2026")],
				params,
			),
		).toBeNull();
	});
});
