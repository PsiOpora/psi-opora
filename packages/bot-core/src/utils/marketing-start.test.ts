import { describe, expect, test } from "bun:test";
import { type FindMarketingCampaign, matchMarketingStart } from "./marketing-start";

const find: FindMarketingCampaign = async (code) =>
	code.toLowerCase() === "free" ? { code: "FREE" } : null;

describe("matchMarketingStart", () => {
	test("код с площадкой: campaign — код кампании, source — площадка", async () => {
		expect(await matchMarketingStart("FREE_vk", find)).toEqual({
			campaign: "FREE",
			source: "vk",
		});
		expect(await matchMarketingStart("free_b17", find)).toEqual({
			campaign: "FREE",
			source: "b17",
		});
	});

	test("площадка с «_» целиком уходит в source", async () => {
		expect(await matchMarketingStart("FREE_tg_ads", find)).toEqual({
			campaign: "FREE",
			source: "tg_ads",
		});
	});

	test("голый код без площадки — только campaign", async () => {
		expect(await matchMarketingStart("FREE", find)).toEqual({
			campaign: "FREE",
		});
	});

	test("неизвестный код и пустой параметр — null", async () => {
		expect(await matchMarketingStart("OTHER_vk", find)).toBeNull();
		expect(await matchMarketingStart(undefined, find)).toBeNull();
	});

	test("служебные коды SITE_CODES не перекрываются кампанией", async () => {
		const greedy: FindMarketingCampaign = async (code) => ({ code });
		expect(await matchMarketingStart("direct_okr", greedy)).toBeNull();
	});
});
