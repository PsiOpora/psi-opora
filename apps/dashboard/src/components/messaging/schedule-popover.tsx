"use client";

import {
	addDays,
	addHours,
	format,
	isAfter,
	setHours,
	setMilliseconds,
	setMinutes,
	setSeconds,
} from "date-fns";
import { ru } from "date-fns/locale";
import { CalendarClockIcon, Loader2Icon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";

/** Формат значения у <input type="datetime-local">. */
const LOCAL_INPUT_FORMAT = "yyyy-MM-dd'T'HH:mm";
/** Запас, при котором время считается «ещё в будущем» — сервер отклоняет
 * отправку ближе, чем через SCHEDULE_MIN_AHEAD_SECONDS (см. packages/api). */
const MIN_AHEAD_MS = 60_000;

function atTime(date: Date, hours: number): Date {
	return setMilliseconds(
		setSeconds(setMinutes(setHours(date, hours), 0), 0),
		0,
	);
}

interface Preset {
	label: string;
	at: Date;
}

function buildPresets(now: Date): Preset[] {
	const presets: Preset[] = [
		{ label: "Через час", at: addHours(now, 1) },
		{ label: "Сегодня в 18:00", at: atTime(now, 18) },
		{ label: "Завтра в 9:00", at: atTime(addDays(now, 1), 9) },
		{ label: "Послезавтра в 9:00", at: atTime(addDays(now, 2), 9) },
	];
	return presets.filter((p) =>
		isAfter(p.at, new Date(now.getTime() + MIN_AHEAD_MS)),
	);
}

export function formatScheduledAt(iso: string | Date): string {
	const date = typeof iso === "string" ? new Date(iso) : iso;
	return format(date, "d MMMM, HH:mm", { locale: ru });
}

interface SchedulePopoverProps {
	/** Нечего откладывать (пустое сообщение, идёт загрузка и т.п.). */
	disabled?: boolean;
	/** Откладывает сообщение на указанное время. Возвращает текст ошибки или
	 * null, если сообщение успешно запланировано (попап закроется). */
	onSchedule: (sendAt: Date) => Promise<string | null>;
}

/** Кнопка «Отложить» рядом с «Отправить»: быстрый выбор времени либо точные
 * дата и время. Время — в часовом поясе браузера оператора. */
export function SchedulePopover({
	disabled,
	onSchedule,
}: SchedulePopoverProps) {
	const [open, setOpen] = useState(false);
	const [custom, setCustom] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	// Пересчитываем при каждом открытии: «Через час» не должно устаревать.
	const [presets, setPresets] = useState<Preset[]>([]);

	const submit = async (at: Date) => {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const failure = await onSchedule(at);
			if (failure) {
				setError(failure);
				return;
			}
			setOpen(false);
		} finally {
			setBusy(false);
		}
	};

	const submitCustom = () => {
		const at = new Date(custom);
		if (!custom || Number.isNaN(at.getTime())) {
			setError("Укажите дату и время отправки");
			return;
		}
		void submit(at);
	};

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (next) {
					const now = new Date();
					setPresets(buildPresets(now));
					setCustom(format(addHours(now, 1), LOCAL_INPUT_FORMAT));
					setError(null);
				}
			}}
		>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					disabled={disabled}
					title="Отправить позже"
				>
					<CalendarClockIcon className="size-4" />
					Отложить
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" side="top" className="w-72">
				<p className="text-sm font-medium">Отправить позже</p>
				<div className="flex flex-col gap-1">
					{presets.map((preset) => (
						<Button
							key={preset.label}
							type="button"
							variant="ghost"
							size="sm"
							className="justify-between"
							disabled={busy}
							onClick={() => void submit(preset.at)}
						>
							<span>{preset.label}</span>
							<span className="text-xs text-muted-foreground">
								{format(preset.at, "d MMM, HH:mm", { locale: ru })}
							</span>
						</Button>
					))}
				</div>
				<div className="flex flex-col gap-1.5 border-t pt-2.5">
					<label
						htmlFor="schedule-custom-at"
						className="text-xs text-muted-foreground"
					>
						Или выберите дату и время
					</label>
					<Input
						id="schedule-custom-at"
						type="datetime-local"
						value={custom}
						min={format(new Date(), LOCAL_INPUT_FORMAT)}
						onChange={(e) => setCustom(e.target.value)}
					/>
					<Button type="button" disabled={busy} onClick={submitCustom}>
						{busy && <Loader2Icon className="size-4 animate-spin" />}
						Запланировать
					</Button>
				</div>
				{error && <p className="text-xs text-destructive">{error}</p>}
			</PopoverContent>
		</Popover>
	);
}
