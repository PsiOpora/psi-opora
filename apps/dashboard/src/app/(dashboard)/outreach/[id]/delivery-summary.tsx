import { formatPhone } from "@psi-opora/api/schemas";
import type { OutreachCampaign } from "@psi-opora/db/queries";
import {
	describePacing,
	MESSENGER_LABELS,
	type MessengerChannel,
} from "../delivery-model";
import { formatResumeAt } from "../outreach-format";

const WEEKDAY_LABELS = ["", "пн", "вт", "ср", "чт", "пт", "сб", "вс"];

const LEGACY_ORDER: MessengerChannel[] = ["max", "telegram", "whatsapp"];

/** Порядок каналов, темп номеров и правила отправки рассылки — для отчёта. */
export function DeliverySummary({
	campaign,
}: {
	campaign: Pick<
		OutreachCampaign,
		| "accounts"
		| "settings"
		| "intervalSec"
		| "emailTemplateId"
		| "emailSubject"
		| "emailTemplateName"
		| "status"
		| "resumeAt"
		| "pauseReason"
	>;
}) {
	const { settings, accounts } = campaign;
	const order = settings
		? settings.channels.map((c) => c.channel)
		: LEGACY_ORDER.filter((c) => accounts[c]);
	const rules: string[] = [];
	if (settings?.window) {
		const { days, fromHour, toHour } = settings.window;
		rules.push(
			`окно отправки: ${days.map((d) => WEEKDAY_LABELS[d]).join(", ")}, ${fromHour}:00–${toHour}:00 МСК`,
		);
	}
	if (settings?.channels.some((c) => c.dailyLimit)) {
		rules.push(
			settings.onDailyLimit === "wait"
				? "при исчерпании лимита — ждать следующих суток"
				: "при исчерпании лимита — следующий канал",
		);
	}
	if (settings?.dedupDays) {
		rules.push(`не писать получившим рассылку за ${settings.dedupDays} дн.`);
	}
	const paused =
		(campaign.status === "running" || campaign.status === "queued") &&
		campaign.resumeAt &&
		new Date(campaign.resumeAt) > new Date();

	return (
		<div className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
			{paused && campaign.resumeAt && (
				<p className="text-amber-700 dark:text-amber-400">
					Пауза до {formatResumeAt(campaign.resumeAt)}
					{campaign.pauseReason && ` — ${campaign.pauseReason.toLowerCase()}`}.
					Рассылка продолжится автоматически.
				</p>
			)}
			<ol className="flex flex-col gap-0.5">
				{order.map((channel, index) => {
					const account = accounts[channel];
					const pacing = settings?.channels.find((c) => c.channel === channel);
					return (
						<li key={channel}>
							{index + 1}. {MESSENGER_LABELS[channel]}
							{account && ` ${formatPhone(account.phone)}`}
							{" — "}
							{pacing
								? describePacing(pacing).toLowerCase()
								: `пауза ~${campaign.intervalSec} с`}
						</li>
					);
				})}
				{campaign.emailTemplateId && (
					<li>
						{order.length + 1}. Email «
						{campaign.emailSubject ?? campaign.emailTemplateName ?? ""}»
					</li>
				)}
			</ol>
			{rules.length > 0 && <p>{rules.join(" · ")}</p>}
		</div>
	);
}
