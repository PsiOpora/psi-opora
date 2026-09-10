import { CreateTaskWorkflow } from "@hatchet-dev/typescript-sdk/v1";
import { sendGuideFollowUps } from "../guide-follow-ups";

/**
 * Follow-up по кампаниям гайдов (bot_guide_campaigns) — раз в час
 * достаточно, т.к. задержка задаётся в днях (campaign.followUpDelayDays).
 * См. sendGuideFollowUps в guide-follow-ups.ts.
 */
export const guideFollowUps = CreateTaskWorkflow({
	name: "guide-follow-ups",
	// Сдвиг от "0 * * * *" — чтобы не стартовать в ту же минуту, что остальные
	// почасовые/суточные крон-задачи.
	on: { cron: "5 * * * *" },
	retries: 0,
	executionTimeout: "10m",
	fn: async () => ({ ...(await sendGuideFollowUps()) }),
});
