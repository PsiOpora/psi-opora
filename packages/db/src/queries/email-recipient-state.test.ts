import { describe, expect, test } from "bun:test";
import {
	applyEmailEvent,
	type RecipientTrackingState,
} from "./email-recipient-state";

function state(
	overrides: Partial<RecipientTrackingState> = {},
): RecipientTrackingState {
	return {
		status: "sent",
		error: null,
		sentAt: new Date("2026-10-01T10:00:00Z"),
		deliveredAt: null,
		openedAt: null,
		clickedAt: null,
		bouncedAt: null,
		complainedAt: null,
		unsubscribedAt: null,
		openCount: 0,
		clickCount: 0,
		lastEventAt: null,
		...overrides,
	};
}

const t = (iso: string) => new Date(`2026-10-01T${iso}Z`);

describe("applyEmailEvent", () => {
	test("delivered → opened → clicked продвигает статус", () => {
		let s = applyEmailEvent(state(), {
			type: "delivered",
			occurredAt: t("10:01:00"),
		});
		expect(s.status).toBe("delivered");
		s = applyEmailEvent(s, { type: "opened", occurredAt: t("10:05:00") });
		expect(s.status).toBe("opened");
		expect(s.openCount).toBe(1);
		s = applyEmailEvent(s, { type: "clicked", occurredAt: t("10:06:00") });
		expect(s.status).toBe("clicked");
		expect(s.clickCount).toBe(1);
		expect(s.openCount).toBe(1);
	});

	test("запоздавший delivered не откатывает opened", () => {
		let s = applyEmailEvent(state(), {
			type: "opened",
			occurredAt: t("10:05:00"),
		});
		s = applyEmailEvent(s, { type: "delivered", occurredAt: t("10:01:00") });
		expect(s.status).toBe("opened");
		expect(s.deliveredAt).toEqual(t("10:01:00"));
		expect(s.lastEventAt).toEqual(t("10:05:00"));
	});

	test("открытие без delivered проставляет доставку", () => {
		const s = applyEmailEvent(state(), {
			type: "opened",
			occurredAt: t("10:05:00"),
		});
		expect(s.deliveredAt).toEqual(t("10:05:00"));
	});

	test("клик без открытия засчитывает открытие", () => {
		const s = applyEmailEvent(state(), {
			type: "clicked",
			occurredAt: t("10:05:00"),
		});
		expect(s.openedAt).toEqual(t("10:05:00"));
		expect(s.openCount).toBe(1);
	});

	test("повторные открытия увеличивают счётчик, но не сдвигают первое", () => {
		let s = applyEmailEvent(state(), {
			type: "opened",
			occurredAt: t("10:05:00"),
		});
		s = applyEmailEvent(s, { type: "opened", occurredAt: t("11:00:00") });
		expect(s.openCount).toBe(2);
		expect(s.openedAt).toEqual(t("10:05:00"));
	});

	test("отписка важнее открытия и клика", () => {
		let s = applyEmailEvent(state(), {
			type: "clicked",
			occurredAt: t("10:05:00"),
		});
		s = applyEmailEvent(s, { type: "unsubscribed", occurredAt: t("10:06:00") });
		expect(s.status).toBe("unsubscribed");
	});

	test("жалоба важнее отписки", () => {
		let s = applyEmailEvent(state(), {
			type: "unsubscribed",
			occurredAt: t("10:05:00"),
		});
		s = applyEmailEvent(s, { type: "complained", occurredAt: t("10:06:00") });
		expect(s.status).toBe("complained");
	});

	test("hard bounce сохраняет ответ SMTP", () => {
		const s = applyEmailEvent(state(), {
			type: "bounced",
			occurredAt: t("10:01:00"),
			details: "550 user unknown",
		});
		expect(s.status).toBe("bounced");
		expect(s.error).toBe("550 user unknown");
	});

	test("soft bounce не меняет статус", () => {
		const s = applyEmailEvent(state(), {
			type: "soft_bounced",
			occurredAt: t("10:01:00"),
		});
		expect(s.status).toBe("sent");
	});

	test("ошибка после доставки игнорируется", () => {
		let s = applyEmailEvent(state(), {
			type: "delivered",
			occurredAt: t("10:01:00"),
		});
		s = applyEmailEvent(s, {
			type: "failed",
			occurredAt: t("10:02:00"),
			details: "x",
		});
		expect(s.status).toBe("delivered");
	});

	test("ошибка до доставки переводит в error", () => {
		const s = applyEmailEvent(state(), {
			type: "failed",
			occurredAt: t("10:02:00"),
			details: "rejected",
		});
		expect(s.status).toBe("error");
		expect(s.error).toBe("rejected");
	});

	test("ok_sent у Unisender переводит imported → sent", () => {
		const s = applyEmailEvent(state({ status: "imported", sentAt: null }), {
			type: "sent",
			occurredAt: t("10:00:30"),
		});
		expect(s.status).toBe("sent");
	});
});
