import { CreateTaskWorkflow } from "@hatchet-dev/typescript-sdk/v1";
import { sendBookPreorderDrip } from "../book-preorder-drip";
import { sendGuideFollowUps } from "../guide-follow-ups";
import { runSteps } from "./run-steps";

/**
 * Почасовые дожимные рассылки:
 * - follow-up по кампаниям гайдов (bot_guide_campaigns) — раз в час
 *   достаточно, т.к. задержка задаётся в днях (campaign.followUpDelayDays),
 *   см. sendGuideFollowUps в guide-follow-ups.ts;
 * - напоминания о предзаказе книги «Тело берёт своё» (Б1–Б6) — дни считаются
 *   от bot_texts.book_ready_date, см. sendBookPreorderDrip.
 *
 * Один крон на обе рассылки — из-за лимита Hatchet на число cron-триггеров.
 */
export const hourlyDrips = CreateTaskWorkflow({
	name: "hourly-drips",
	// Сдвиг от "0 * * * *" — чтобы не стартовать в ту же минуту, что остальные
	// почасовые/суточные крон-задачи.
	on: { cron: "5 * * * *" },
	retries: 0,
	executionTimeout: "20m",
	fn: async () =>
		runSteps({
			guideFollowUps: async () => ({ ...(await sendGuideFollowUps()) }),
			bookPreorderDrip: async () => ({ ...(await sendBookPreorderDrip()) }),
		}),
});
