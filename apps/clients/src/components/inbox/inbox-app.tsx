"use client";

import type { ClientListItem } from "@psi-opora/api";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { BellIcon, BellOffIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useB24Frame } from "@/components/bitrix/frame-provider";
import {
  ClientList,
  type MessengerFilter,
} from "@/components/inbox/client-list";
import { clientKey } from "@/components/inbox/messenger-meta";
import { ProfilePane } from "@/components/inbox/profile-pane";
import {
  type CurrentOperator,
  type SelectedClient,
  ThreadPane,
} from "@/components/inbox/thread-pane";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { orpc, orpcClient } from "@/lib/orpc/client";
import { cn } from "@/lib/utils";

const LIST_POLL_INTERVAL_MS = 8000;
const SEARCH_DEBOUNCE_MS = 300;

export function InboxApp() {
  const { b24, status } = useB24Frame();
  const queryClient = useQueryClient();

  const [operator, setOperator] = useState<CurrentOperator | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [messengerFilter, setMessengerFilter] =
    useState<MessengerFilter>("all");
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [onlyAwaiting, setOnlyAwaiting] = useState(false);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedClient | null>(null);
  const [showProfile, setShowProfile] = useState(true);
  const [notificationsOn, setNotificationsOn] = useState(false);

  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedSearch(search),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [search]);

  // Текущий оператор — из Bitrix (user.current), для «Назначить на себя» и фильтра «Мои».
  useEffect(() => {
    if (!b24) return;
    b24
      .callMethod("user.current", {})
      .then((res) => {
        if (!res.isSuccess) return;
        const data = (
          res.getData() as
            | { result?: { ID?: string; NAME?: string; LAST_NAME?: string } }
            | undefined
        )?.result;
        if (!data?.ID) return;
        setOperator({
          id: data.ID,
          name:
            [data.NAME, data.LAST_NAME].filter(Boolean).join(" ") ||
            `#${data.ID}`,
        });
      })
      .catch(() => {
        // не критично — просто не покажем «Назначить на себя» и «Мои»
      });
  }, [b24]);

  const listQuery = useQuery(
    orpc.messages.list.queryOptions({
      input: { search: debouncedSearch || undefined },
      refetchInterval: LIST_POLL_INTERVAL_MS,
      placeholderData: keepPreviousData,
    }),
  );
  const allItems = useMemo(() => listQuery.data?.items ?? [], [listQuery.data]);

  const items = useMemo(
    () =>
      allItems.filter((c) => {
        if (messengerFilter !== "all" && c.messenger !== messengerFilter)
          return false;
        if (onlyUnread && !c.unread) return false;
        if (onlyAwaiting && c.lastMessageDirection !== "in") return false;
        if (tagFilter && !c.tags.includes(tagFilter)) return false;
        if (onlyMine && operator && c.assignedOperatorId !== operator.id)
          return false;
        return true;
      }),
    [
      allItems,
      messengerFilter,
      onlyUnread,
      onlyAwaiting,
      tagFilter,
      onlyMine,
      operator,
    ],
  );

  /** Точечно правит строки в кэше списка — без ожидания следующего поллинга. */
  const patchListCache = useCallback(
    (patch: (item: ClientListItem) => ClientListItem) => {
      queryClient.setQueriesData<{ items: ClientListItem[] }>(
        { queryKey: orpc.messages.list.key() },
        (old) => (old ? { items: old.items.map(patch) } : old),
      );
    },
    [queryClient],
  );

  const refreshList = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: orpc.messages.list.key() });
  }, [queryClient]);

  const openClient = useCallback(
    (item: ClientListItem) => {
      setSelected({ messenger: item.messenger, userId: item.userId });
      if (!item.unread) return;
      orpcClient.messages
        .markRead({ messenger: item.messenger, userId: item.userId })
        .then(() => {
          patchListCache((c) =>
            c.messenger === item.messenger && c.userId === item.userId
              ? { ...c, unread: false, unreadCount: 0 }
              : c,
          );
        });
    },
    [patchListCache],
  );

  const handleAssigned = useCallback(
    (assignedOperator: CurrentOperator) => {
      if (!selected) return;
      patchListCache((c) =>
        c.messenger === selected.messenger && c.userId === selected.userId
          ? {
              ...c,
              assignedOperatorId: assignedOperator.id,
              assignedOperatorName: assignedOperator.name,
            }
          : c,
      );
    },
    [selected, patchListCache],
  );

  const handleTagsSaved = useCallback(
    (tags: string[]) => {
      if (!selected) return;
      patchListCache((c) =>
        c.messenger === selected.messenger && c.userId === selected.userId
          ? { ...c, tags }
          : c,
      );
    },
    [selected, patchListCache],
  );

  const selectedClient = selected
    ? allItems.find(
        (c) =>
          c.messenger === selected.messenger && c.userId === selected.userId,
      )
    : undefined;
  const unreadTotal = allItems.filter((c) => c.unread).length;
  const awaitingTotal = allItems.filter(
    (c) => c.lastMessageDirection === "in",
  ).length;

  // Счётчик непрочитанных в заголовке вкладки — видно, не открывая инбокс.
  useEffect(() => {
    document.title =
      unreadTotal > 0 ? `(${unreadTotal}) Клиенты` : "Пси-Опора — Клиенты";
  }, [unreadTotal]);

  // Браузерные уведомления о новых входящих (opt-in по кнопке-колокольчику).
  const knownUnreadRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const unreadKeys = new Set(
      allItems
        .filter((c) => c.unread)
        .map((c) => clientKey(c.messenger, c.userId)),
    );
    const known = knownUnreadRef.current;
    knownUnreadRef.current = unreadKeys;
    // Первая загрузка — только запоминаем, не уведомляем о старом.
    if (!known || !notificationsOn) return;
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;

    for (const c of allItems) {
      const key = clientKey(c.messenger, c.userId);
      if (!c.unread || known.has(key)) continue;
      new Notification(c.name, {
        body: c.lastMessageText.slice(0, 120),
        tag: key,
      });
    }
  }, [allItems, notificationsOn]);

  const toggleNotifications = useCallback(async () => {
    if (notificationsOn) {
      setNotificationsOn(false);
      return;
    }
    if (typeof Notification === "undefined") return;
    const permission =
      Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();
    if (permission === "granted") setNotificationsOn(true);
  }, [notificationsOn]);

  return (
    <div className="flex h-svh flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <h1 className="text-sm font-semibold">Клиенты</h1>
        <Badge variant="secondary" className="text-xs">
          {allItems.length} диалогов
        </Badge>
        {unreadTotal > 0 && (
          <Badge className="text-xs">{unreadTotal} непрочитанных</Badge>
        )}
        {awaitingTotal > 0 && (
          <Badge variant="outline" className="text-xs">
            {awaitingTotal} ждут ответа
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span
            className={cn(
              "flex items-center gap-1.5 text-xs text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "size-2 rounded-full",
                status === "ready" ? "bg-emerald-500" : "bg-amber-500",
              )}
            />
            {status === "ready" ? "Битрикс24" : "Автономный режим"}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggleNotifications}
            title={
              notificationsOn
                ? "Выключить уведомления о новых сообщениях"
                : "Включить уведомления о новых сообщениях"
            }
          >
            {notificationsOn ? (
              <BellIcon className="size-4" />
            ) : (
              <BellOffIcon className="size-4 text-muted-foreground" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={refreshList}
            title="Обновить список"
          >
            <RefreshCwIcon
              className={cn("size-4", listQuery.isFetching && "animate-spin")}
            />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <ClientList
          items={items}
          allItems={allItems}
          loading={listQuery.isLoading}
          search={search}
          onSearchChange={setSearch}
          messengerFilter={messengerFilter}
          onMessengerFilterChange={setMessengerFilter}
          onlyUnread={onlyUnread}
          onOnlyUnreadChange={setOnlyUnread}
          onlyMine={onlyMine}
          onOnlyMineChange={setOnlyMine}
          onlyAwaiting={onlyAwaiting}
          onOnlyAwaitingChange={setOnlyAwaiting}
          tagFilter={tagFilter}
          onTagFilterChange={setTagFilter}
          operatorId={operator?.id ?? null}
          selectedKey={
            selected ? clientKey(selected.messenger, selected.userId) : null
          }
          onSelect={openClient}
        />
        <ThreadPane
          selected={selected}
          client={selectedClient}
          operator={operator}
          showProfile={showProfile}
          onToggleProfile={() => setShowProfile((v) => !v)}
          onAfterSend={refreshList}
          onAssigned={handleAssigned}
        />
        {selected && showProfile && (
          <ProfilePane
            selected={selected}
            client={selectedClient}
            operator={operator}
            onTagsSaved={handleTagsSaved}
          />
        )}
      </div>
    </div>
  );
}
