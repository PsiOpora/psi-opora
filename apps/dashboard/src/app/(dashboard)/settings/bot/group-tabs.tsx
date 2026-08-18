"use client";

import { Check, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface GroupTabsSection {
  label: string;
  /** Нумеровать шаги внутри блока (осмысленно только там, где это последовательность). */
  numbered: boolean;
  groups: string[];
}

/**
 * Навигация по шагам сценария, сгруппированная в смысловые блоки
 * («Диалог в боте», «Кампании по кодовому слову», «Напоминания из CRM») —
 * структура приходит из SCENARIO_TEXT_SECTIONS. Номер шага считается по
 * позиции внутри блока, а не берётся из названия: раньше номера были
 * зашиты в имена групп и, например, «2b» не распознавалось.
 */
export function GroupTabs({
  sections,
  changedCounts,
  children,
}: {
  sections: GroupTabsSection[];
  changedCounts: Record<string, number>;
  children: Record<string, React.ReactNode>;
}) {
  const allGroups = sections.flatMap((section) => section.groups);
  const groupsKey = allGroups.join("|");
  const [active, setActive] = useState(allGroups[0] ?? "");

  // Список шагов приходит асинхронно (defs грузятся запросом), поэтому
  // первый шаг выбираем, как только он появился, и переоткрываем, если
  // текущий пропал.
  useEffect(() => {
    const groups = groupsKey ? groupsKey.split("|") : [];
    if (groups.length === 0) return;
    if (!groups.includes(active)) setActive(groups[0] as string);
  }, [groupsKey, active]);

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[19rem_minmax(0,1fr)]">
      <nav
        aria-label="Шаги сценария бота"
        className="flex gap-2 overflow-x-auto pb-2 lg:sticky lg:top-6 lg:flex-col lg:overflow-visible lg:pb-0"
      >
        {sections.map((section) => (
          <div
            key={section.label}
            className="flex shrink-0 gap-2 lg:flex-col lg:gap-1"
          >
            <p className="hidden px-2 pt-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground lg:block">
              {section.label}
            </p>
            {section.groups.map((group, index) => {
              const count = changedCounts[group] ?? 0;
              const selected = active === group;

              return (
                <Button
                  key={group}
                  type="button"
                  variant={selected ? "secondary" : "ghost"}
                  onClick={() => setActive(group)}
                  className="h-auto min-w-56 justify-start px-3 py-2.5 text-left lg:min-w-0"
                  aria-current={selected ? "step" : undefined}
                >
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold",
                      section.numbered
                        ? "bg-background shadow-sm"
                        : "text-muted-foreground",
                    )}
                    aria-hidden="true"
                  >
                    {section.numbered ? index + 1 : "•"}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{group}</span>
                  {count > 0 ? (
                    <Badge variant="secondary" className="ml-auto">
                      <Check data-icon="inline-start" />
                      {count}
                    </Badge>
                  ) : (
                    <ChevronRight data-icon="inline-end" className="ml-auto" />
                  )}
                </Button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="min-w-0">
        {allGroups.map((group) => (
          <div key={group} className={cn(active !== group && "hidden")}>
            {children[group]}
          </div>
        ))}
      </div>
    </div>
  );
}
