"use client";

import type { OutreachBotOptions } from "@psi-opora/api";
import { CornerDownRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export const BOT_CHANNELS = [
	{ key: "max", label: "Бот MAX" },
	{ key: "telegram", label: "Бот Telegram" },
] as const;

/** Подключённые боты в порядке попыток: сначала MAX, затем Telegram. */
export function connectedBots(bots: OutreachBotOptions) {
	return BOT_CHANNELS.filter((b) => bots[b.key]);
}

/** Заголовок этапа цепочки: «Этап 1 · Боты — если номер уже писал боту». */
export function StageHeading({
	stage,
	title,
	condition,
	muted,
}: {
	stage: number;
	title: string;
	condition: string;
	muted?: boolean;
}) {
	return (
		<div
			className={cn(
				"flex flex-wrap items-baseline gap-x-2",
				muted && "opacity-60",
			)}
		>
			<span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
				Этап {stage}
			</span>
			<span className="text-sm font-semibold">{title}</span>
			<span className="text-sm text-muted-foreground">— {condition}</span>
		</div>
	);
}

/** Переход к следующему этапу: при каком условии контакт идёт дальше. */
export function StageTransition({ children }: { children: ReactNode }) {
	return (
		<div className="flex items-center gap-2 py-1 pl-3 text-xs text-muted-foreground">
			<CornerDownRightIcon className="size-4 shrink-0" />
			<span>{children}</span>
		</div>
	);
}

/**
 * Первый этап рассылки: официальные боты. Пишут только тем, чей телефон
 * уже обращался к боту (Bot API не умеет «написать первым»), поэтому идут
 * до личных номеров и не расходуют их лимиты.
 */
export function BotsStage({
	bots,
	enabled,
	onEnabledChange,
	startStep,
}: {
	bots: OutreachBotOptions;
	enabled: boolean;
	onEnabledChange: (enabled: boolean) => void;
	startStep: number;
}) {
	const available = connectedBots(bots).length > 0;
	const active = enabled && available;
	let step = startStep - 1;

	return (
		<div className={cn("rounded-lg border bg-card", !active && "bg-muted/30")}>
			<div className="flex flex-wrap items-center gap-3 p-3">
				{/* Место под стрелки — боты всегда первые, их порядок не меняется. */}
				<span className="w-6" />
				<div className="flex min-w-28 items-center gap-2">
					<Switch
						id="outreach-bots"
						checked={active}
						disabled={!available}
						onCheckedChange={onEnabledChange}
					/>
					<Label htmlFor="outreach-bots" className="font-medium">
						Сначала через ботов
					</Label>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					{BOT_CHANNELS.map((b) => {
						const connected = bots[b.key];
						if (active && connected) step++;
						return (
							<span
								key={b.key}
								className={cn(
									"inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm",
									!(active && connected) && "text-muted-foreground",
								)}
							>
								<span
									className={cn(
										"flex size-5 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
										active && connected
											? "bg-primary text-primary-foreground"
											: "bg-muted",
									)}
								>
									{active && connected ? step : "–"}
								</span>
								{b.label}
								{!connected && " · не подключён"}
							</span>
						);
					})}
				</div>
			</div>
			<p className="px-3 pb-3 text-xs text-muted-foreground">
				{available ? (
					<>
						Ищем по телефону: контакт в CRM с этим номером и его диалог с ботом
						или телефон, который клиент сам оставил в боте. Нашёлся — пишет бот,
						личные номера не тратятся (без пауз и дневных лимитов, только окно
						отправки). Бот не может написать тому, кто ему не писал, — такие
						контакты сразу идут на этап 2.
					</>
				) : (
					"Боты MAX и Telegram не подключены — подключите их в разделе «Каналы», чтобы писать клиентам, которые уже обращались к боту."
				)}
			</p>
		</div>
	);
}
