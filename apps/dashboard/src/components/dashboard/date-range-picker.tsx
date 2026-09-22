"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { DateRange as DayPickerRange } from "react-day-picker";
import { ru } from "date-fns/locale";
import {
	startOfWeek,
	startOfMonth,
	endOfMonth,
	subMonths,
	startOfQuarter,
	endOfDay,
} from "date-fns";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { formatDateParam } from "@/lib/analytics/date-range";

const PRESETS: { label: string; range: () => { from: Date; to: Date } }[] = [
	{
		label: "Текущая неделя",
		range: () => ({
			from: startOfWeek(new Date(), { weekStartsOn: 1 }),
			to: endOfDay(new Date()),
		}),
	},
	{
		label: "Текущий месяц",
		range: () => ({ from: startOfMonth(new Date()), to: endOfDay(new Date()) }),
	},
	{
		label: "Прошлый месяц",
		range: () => {
			const prev = subMonths(new Date(), 1);
			return { from: startOfMonth(prev), to: endOfMonth(prev) };
		},
	},
	{
		label: "Текущий квартал",
		range: () => ({
			from: startOfQuarter(new Date()),
			to: endOfDay(new Date()),
		}),
	},
	{
		label: "Последние 7 дней",
		range: () => {
			const now = new Date();
			const from = new Date(now);
			from.setDate(from.getDate() - 6);
			from.setHours(0, 0, 0, 0);
			return { from, to: endOfDay(now) };
		},
	},
	{
		label: "Последние 30 дней",
		range: () => {
			const now = new Date();
			const from = new Date(now);
			from.setDate(from.getDate() - 29);
			from.setHours(0, 0, 0, 0);
			return { from, to: endOfDay(now) };
		},
	},
	{
		label: "Последние 90 дней",
		range: () => {
			const now = new Date();
			const from = new Date(now);
			from.setDate(from.getDate() - 89);
			from.setHours(0, 0, 0, 0);
			return { from, to: endOfDay(now) };
		},
	},
];

function currentRange(searchParams: URLSearchParams): { from: Date; to: Date } {
	const toParam = searchParams.get("to");
	const fromParam = searchParams.get("from");
	const to = toParam ? new Date(toParam) : new Date();
	if (fromParam) {
		return { from: new Date(fromParam), to };
	}
	const from = new Date(to);
	from.setDate(from.getDate() - 29);
	return { from, to };
}

export function DateRangePicker() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { from, to } = currentRange(searchParams);
	const [open, setOpen] = useState(false);
	const [range, setRange] = useState<DayPickerRange | undefined>({ from, to });

	function apply(next: DayPickerRange | undefined) {
		if (!next?.from || !next?.to) return;
		const params = new URLSearchParams(searchParams);
		params.set("from", formatDateParam(next.from));
		params.set("to", formatDateParam(next.to));
		router.push(`?${params.toString()}`);
		setOpen(false);
	}

	function applyPreset(preset: (typeof PRESETS)[number]) {
		const next = preset.range();
		setRange(next);
		apply(next);
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="outline" size="sm">
					<CalendarIcon data-icon="inline-start" />
					{formatDateParam(from)} — {formatDateParam(to)}
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-auto p-0" align="end">
				<div className="flex flex-col gap-2 p-3 sm:flex-row">
					<div className="flex flex-row flex-wrap gap-1 sm:w-40 sm:flex-col sm:flex-nowrap">
						{PRESETS.map((preset) => (
							<Button
								key={preset.label}
								variant="ghost"
								size="sm"
								className="justify-start"
								onClick={() => applyPreset(preset)}
							>
								{preset.label}
							</Button>
						))}
					</div>
					<Calendar
						mode="range"
						locale={ru}
						selected={range}
						onSelect={setRange}
						numberOfMonths={2}
						defaultMonth={from}
					/>
				</div>
				<div className="flex justify-end gap-2 border-t p-3">
					<Button size="sm" onClick={() => apply(range)}>
						Применить
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
