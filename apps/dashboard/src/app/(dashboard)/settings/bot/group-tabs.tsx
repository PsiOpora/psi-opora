"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Вкладки поверх карточек-групп текстов. Не размонтирует неактивные панели
 * (просто скрывает через CSS) — все поля формы остаются в DOM и попадают
 * в submit, даже если вкладка ни разу не открывалась.
 */
export function GroupTabs({
  groups,
  changedCounts,
  children,
}: {
  groups: string[];
  changedCounts: Record<string, number>;
  children: React.ReactNode[];
}) {
  const [active, setActive] = useState(groups[0]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
        {groups.map((group) => (
          <button
            key={group}
            type="button"
            onClick={() => setActive(group)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active === group
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {group}
            {(() => {
              const count = changedCounts[group] ?? 0;
              return count > 0 ? (
                <Badge variant="secondary" className="text-[10px]">
                  {count}
                </Badge>
              ) : null;
            })()}
          </button>
        ))}
      </div>

      {groups.map((group, i) => (
        <div key={group} className={active === group ? "" : "hidden"}>
          {children[i]}
        </div>
      ))}
    </div>
  );
}
