import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DeliverySummary } from "./delivery-summary";

type Campaign = Parameters<typeof DeliverySummary>[0]["campaign"];

function render(
	bots: NonNullable<Campaign["settings"]>["bots"],
	useBots = true,
) {
	return renderToStaticMarkup(
		createElement(DeliverySummary, {
			campaign: {
				accounts: { max: null, telegram: null, whatsapp: null },
				settings: {
					useBots,
					bots,
					channels: [
						{
							channel: "whatsapp",
							minIntervalSec: 30,
							maxIntervalSec: 60,
							dailyLimit: null,
							batchSize: null,
							batchPauseMin: 10,
						},
					],
					onDailyLimit: "skip",
					window: null,
					dedupDays: null,
				},
				intervalSec: 30,
				emailTemplateId: "template",
				emailSubject: "Тема",
				emailTemplateName: null,
				status: "done",
				resumeAt: null,
				pauseReason: null,
			},
		}),
	);
}

describe("DeliverySummary", () => {
	test.each([
		{ max: true, telegram: false },
		{ max: false, telegram: true },
		{ max: true, telegram: true },
		{ max: false, telegram: false },
	])("only available bots appear and later steps follow them: %j", (bots) => {
		const html = render(bots);
		const labels = [
			bots.max && "Бот MAX",
			bots.telegram && "Бот Telegram",
		].filter(Boolean);
		labels.forEach((label, index) => {
			expect(html).toContain(`${index + 1}. ${label}`);
		});
		if (!bots.max) expect(html).not.toContain("Бот MAX");
		if (!bots.telegram) expect(html).not.toContain("Бот Telegram");
		expect(html).toContain(`${labels.length + 1}. Личный WhatsApp`);
		expect(html).toContain(`${labels.length + 2}. Email`);
	});

	test("disabled bots do not occupy a step", () => {
		const html = render({ max: true, telegram: true }, false);
		expect(html).not.toContain("Бот ");
		expect(html).toContain("1. Личный WhatsApp");
		expect(html).toContain("2. Email");
	});

	test("legacy bot campaigns without an availability snapshot retain both bots", () => {
		const html = render(undefined);
		expect(html).toContain("1. Бот MAX");
		expect(html).toContain("2. Бот Telegram");
		expect(html).toContain("3. Личный WhatsApp");
		expect(html).toContain("4. Email");
	});
});
