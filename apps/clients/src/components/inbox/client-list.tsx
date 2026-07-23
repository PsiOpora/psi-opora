"use client";

import type { ClientListItem, InboxMessenger } from "@psi-opora/api";
import { Loader2Icon, SearchIcon, UsersIcon } from "lucide-react";
import { ClientAvatar } from "@/components/inbox/client-avatar";
import {
  clientKey,
  MESSENGER_META,
  MESSENGER_ORDER,
} from "@/components/inbox/messenger-meta";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatListTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export type MessengerFilter = "all" | InboxMessenger;

interface ClientListProps {
  items: ClientListItem[];
  /** Все загруженные диалоги до клиентских фильтров — для счётчиков в чипах. */
  allItems: ClientListItem[];
  loading: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  messengerFilter: MessengerFilter;
  onMessengerFilterChange: (value: MessengerFilter) => void;
  onlyUnread: boolean;
  onOnlyUnreadChange: (value: boolean) => void;
  onlyMine: boolean;
  onOnlyMineChange: (value: boolean) => void;
  /** Только диалоги, где последнее слово за клиентом. */
  onlyAwaiting: boolean;
  onOnlyAwaitingChange: (value: boolean) => void;
  /** null — фильтр по тегу выключен. */
  tagFilter: string | null;
  onTagFilterChange: (value: string | null) => void;
  /** null — оператор неизвестен (standalone), фильтр «Мои» скрыт. */
  operatorId: string | null;
  selectedKey: string | null;
  onSelect: (item: ClientListItem) => void;
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs whitespace-nowrap transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function ClientList({
  items,
  allItems,
  loading,
  search,
  onSearchChange,
  messengerFilter,
  onMessengerFilterChange,
  onlyUnread,
  onOnlyUnreadChange,
  onlyMine,
  onOnlyMineChange,
  onlyAwaiting,
  onOnlyAwaitingChange,
  tagFilter,
  onTagFilterChange,
  operatorId,
  selectedKey,
  onSelect,
}: ClientListProps) {
  const unreadTotal = allItems.filter((c) => c.unread).length;
  const awaitingTotal = allItems.filter(
    (c) => c.lastMessageDirection === "in",
  ).length;
  const allTags = [...new Set(allItems.flatMap((c) => c.tags))].sort();
  const countByMessenger = (messenger: InboxMessenger) =>
    allItems.filter((c) => c.messenger === messenger).length;

  return (
    <div className="flex h-full w-[320px] shrink-0 flex-col border-r xl:w-[380px]">
      <div className="flex flex-col gap-2 border-b p-3">
        <div className="relative">
          <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Поиск по имени или username…"
            className="h-9 pl-8"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <FilterChip
            active={messengerFilter === "all"}
            onClick={() => onMessengerFilterChange("all")}
          >
            Все
            <span className="opacity-70">{allItems.length}</span>
          </FilterChip>
          {MESSENGER_ORDER.map((messenger) => {
            const count = countByMessenger(messenger);
            if (count === 0) return null;
            return (
              <FilterChip
                key={messenger}
                active={messengerFilter === messenger}
                onClick={() => onMessengerFilterChange(messenger)}
              >
                <span
                  className={cn(
                    "size-2 rounded-full",
                    MESSENGER_META[messenger].dotClassName,
                  )}
                />
                {MESSENGER_META[messenger].short}
                <span className="opacity-70">{count}</span>
              </FilterChip>
            );
          })}
          <FilterChip
            active={onlyAwaiting}
            onClick={() => onOnlyAwaitingChange(!onlyAwaiting)}
          >
            Ждут ответа
            {awaitingTotal > 0 && (
              <span className="opacity-70">{awaitingTotal}</span>
            )}
          </FilterChip>
          <FilterChip
            active={onlyUnread}
            onClick={() => onOnlyUnreadChange(!onlyUnread)}
          >
            Непрочитанные
            {unreadTotal > 0 && (
              <span className="opacity-70">{unreadTotal}</span>
            )}
          </FilterChip>
          {operatorId && (
            <FilterChip
              active={onlyMine}
              onClick={() => onOnlyMineChange(!onlyMine)}
            >
              Мои
            </FilterChip>
          )}
        </div>
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {allTags.map((tag) => (
              <FilterChip
                key={tag}
                active={tagFilter === tag}
                onClick={() =>
                  onTagFilterChange(tagFilter === tag ? null : tag)
                }
              >
                #{tag}
              </FilterChip>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            Загружаем диалоги…
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-8 text-center text-muted-foreground">
            <UsersIcon className="size-8" />
            <p className="text-sm">
              {allItems.length === 0
                ? "Переписок пока нет"
                : "Ничего не найдено по выбранным фильтрам"}
            </p>
          </div>
        ) : (
          items.map((c) => {
            const key = clientKey(c.messenger, c.userId);
            const isSelected = key === selectedKey;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSelect(c)}
                className={cn(
                  "flex w-full items-center gap-3 border-b px-3 py-2.5 text-left transition-colors hover:bg-muted/60",
                  isSelected && "bg-muted",
                )}
              >
                <ClientAvatar
                  name={c.name}
                  avatarUrl={c.avatarUrl}
                  messenger={c.messenger}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className={cn(
                        "truncate text-sm",
                        c.unread ? "font-semibold" : "font-medium",
                      )}
                    >
                      {c.name}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {formatListTime(c.lastMessageAt)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        "truncate text-xs",
                        c.unread
                          ? "font-medium text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      {c.lastMessageDirection === "out" ? "Вы: " : ""}
                      {c.lastMessageText}
                    </span>
                    {c.unread && (
                      <span className="size-2.5 shrink-0 rounded-full bg-primary" />
                    )}
                  </div>
                  {(c.assignedOperatorName || c.tags.length > 0) && (
                    <div className="flex flex-wrap items-center gap-1">
                      {c.assignedOperatorName && (
                        <Badge
                          variant="outline"
                          className="h-4 max-w-full px-1 text-[10px]"
                        >
                          <span className="truncate">
                            {c.assignedOperatorName}
                          </span>
                        </Badge>
                      )}
                      {c.tags.map((tag) => (
                        <Badge
                          key={tag}
                          variant="secondary"
                          className="h-4 px-1 text-[10px]"
                        >
                          #{tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
