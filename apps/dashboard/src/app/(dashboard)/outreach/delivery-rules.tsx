"use client";

import { OUTREACH_MAX_DEDUP_DAYS } from "@psi-opora/api/schemas";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { DeliveryDraft } from "./delivery-model";

const WEEKDAYS = [
	{ day: 1, label: "Пн" },
	{ day: 2, label: "Вт" },
	{ day: 3, label: "Ср" },
	{ day: 4, label: "Чт" },
	{ day: 5, label: "Пт" },
	{ day: 6, label: "Сб" },
	{ day: 7, label: "Вс" },
];

const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

/** Окно отправки, поведение при дневном лимите и защита от повторов. */
export function DeliveryRules({
	draft,
	onChange,
	recentlyContacted,
}: {
	draft: DeliveryDraft;
	onChange: (patch: Partial<DeliveryDraft>) => void;
	/** Сколько контактов отсеет «не писать повторно» (из предпросмотра). */
	recentlyContacted: number | null;
}) {
	const { window } = draft;
	const setWindow = (patch: Partial<DeliveryDraft["window"]>) =>
		onChange({ window: { ...window, ...patch } });
	const toggleDay = (day: number) =>
		setWindow({
			days: window.days.includes(day)
				? window.days.filter((d) => d !== day)
				: [...window.days, day].sort((a, b) => a - b),
		});
	const anyLimit = draft.channels.some((c) => c.enabled && c.dailyLimit);

	return (
		<div className="flex flex-col gap-5">
			<div className="flex flex-col gap-3">
				<div className="flex items-center gap-2">
					<Switch
						id="outreach-window"
						checked={draft.windowEnabled}
						onCheckedChange={(windowEnabled) => onChange({ windowEnabled })}
					/>
					<Label htmlFor="outreach-window">
						Отправлять только в рабочее время (МСК)
					</Label>
				</div>
				{draft.windowEnabled && (
					<div className="flex flex-wrap items-center gap-3 pl-10">
						<div className="flex gap-1">
							{WEEKDAYS.map(({ day, label }) => {
								const selected = window.days.includes(day);
								return (
									<button
										key={day}
										type="button"
										onClick={() => toggleDay(day)}
										aria-pressed={selected}
										className={cn(
											"h-8 w-9 rounded-md border text-xs font-medium transition-colors",
											selected
												? "border-primary bg-primary text-primary-foreground"
												: "bg-background text-muted-foreground hover:bg-muted",
										)}
									>
										{label}
									</button>
								);
							})}
						</div>
						<div className="flex items-center gap-2 text-sm">
							с
							<HourSelect
								value={window.fromHour}
								hours={range(0, 23)}
								onChange={(fromHour) =>
									setWindow({
										fromHour,
										toHour: Math.max(window.toHour, fromHour + 1),
									})
								}
								label="Начало окна"
							/>
							до
							<HourSelect
								value={window.toHour}
								hours={range(window.fromHour + 1, 24)}
								onChange={(toHour) => setWindow({ toHour })}
								label="Конец окна"
							/>
						</div>
					</div>
				)}
				<p className="pl-10 text-xs text-muted-foreground">
					{draft.windowEnabled
						? "Вне окна рассылка встаёт на паузу и сама продолжится, когда окно откроется."
						: "Сообщения уходят круглосуточно — в том числе ночью."}
				</p>
			</div>

			<div className="flex flex-col gap-1.5">
				<Label>Когда номер исчерпал дневной лимит</Label>
				<Select
					value={draft.onDailyLimit}
					onValueChange={(value) =>
						onChange({ onDailyLimit: value as DeliveryDraft["onDailyLimit"] })
					}
				>
					<SelectTrigger className="w-full md:w-[30rem]">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="wait">
							Ждать следующих суток — порядок каналов соблюдается
						</SelectItem>
						<SelectItem value="skip">
							Пропускать канал — писать через следующий по порядку
						</SelectItem>
					</SelectContent>
				</Select>
				{!anyLimit && (
					<p className="text-xs text-muted-foreground">
						Сейчас ни у одного канала нет дневного лимита.
					</p>
				)}
			</div>

			<div className="flex flex-col gap-2">
				<div className="flex flex-wrap items-center gap-2">
					<Switch
						id="outreach-dedup"
						checked={draft.dedupEnabled}
						onCheckedChange={(dedupEnabled) => onChange({ dedupEnabled })}
					/>
					<Label htmlFor="outreach-dedup">
						Не писать тем, кому рассылка уже дошла за последние
					</Label>
					<Input
						type="number"
						min={1}
						max={OUTREACH_MAX_DEDUP_DAYS}
						value={draft.dedupDays}
						disabled={!draft.dedupEnabled}
						onChange={(e) => onChange({ dedupDays: Number(e.target.value) })}
						className="w-20"
						aria-label="Дней"
					/>
					<span className="text-sm">дн.</span>
				</div>
				<p className="pl-10 text-xs text-muted-foreground">
					Сверяется по телефону и email со всеми рассылками по спискам.
					{draft.dedupEnabled &&
						recentlyContacted !== null &&
						` В выбранном списке таких контактов: ${recentlyContacted.toLocaleString("ru-RU")} — они будут пропущены.`}
				</p>
			</div>
		</div>
	);
}

function range(from: number, to: number): number[] {
	return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

function HourSelect({
	value,
	hours,
	onChange,
	label,
}: {
	value: number;
	hours: number[];
	onChange: (hour: number) => void;
	label: string;
}) {
	return (
		<Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
			<SelectTrigger className="w-24" aria-label={label}>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{hours.map((hour) => (
					<SelectItem key={hour} value={String(hour)}>
						{hourLabel(hour)}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
