"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { DateRange as DayPickerRange } from "react-day-picker";
import { ru } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDateParam } from "@/lib/analytics/date-range";

const PRESETS = [
  { label: "7 дней", days: 7 },
  { label: "30 дней", days: 30 },
  { label: "90 дней", days: 90 },
];

const DAY_MS = 24 * 60 * 60 * 1000;

function currentRange(searchParams: URLSearchParams): { from: Date; to: Date } {
  const toParam = searchParams.get("to");
  const fromParam = searchParams.get("from");
  const to = toParam ? new Date(toParam) : new Date();
  const from = fromParam ? new Date(fromParam) : new Date(to.getTime() - 30 * DAY_MS);
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

  function applyPreset(days: number) {
    const now = new Date();
    const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    setRange({ from: start, to: now });
    apply({ from: start, to: now });
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
          <div className="flex flex-row gap-1 sm:flex-col">
            {PRESETS.map((preset) => (
              <Button key={preset.days} variant="ghost" size="sm" onClick={() => applyPreset(preset.days)}>
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
