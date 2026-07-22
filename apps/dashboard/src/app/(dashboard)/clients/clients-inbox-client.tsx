"use client";

import type { InboxMessenger } from "@psi-opora/api";
import {
  Loader2Icon,
  MessageSquareIcon,
  SearchIcon,
  SendIcon,
  UserCheckIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useB24Frame } from "@/components/bitrix/frame-provider";
import {
  type HistoryEntry,
  historyLabel,
  HistoryList,
  mergeHistory,
} from "@/components/messaging/history-list";
import { MessageComposer } from "@/components/messaging/message-composer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { orpcClient } from "@/lib/orpc/client";
import { cn } from "@/lib/utils";

const LIST_POLL_INTERVAL_MS = 8000;
const THREAD_POLL_INTERVAL_MS = 5000;

interface ClientRow {
  messenger: InboxMessenger;
  userId: string;
  name: string;
  lastMessageText: string;
  lastMessageDirection: "in" | "out";
  lastMessageAt: string;
  unread: boolean;
  assignedOperatorName: string | null;
}

interface CurrentOperator {
  id: string;
  name: string;
}

function clientKey(messenger: string, userId: string): string {
  return `${messenger}:${userId}`;
}

export function ClientsInbox() {
  const { b24 } = useB24Frame();
  const [operator, setOperator] = useState<CurrentOperator | null>(null);

  const [clients, setClients] = useState<ClientRow[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [selected, setSelected] = useState<{ messenger: InboxMessenger; userId: string } | null>(
    null,
  );
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [text, setText] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, startSending] = useTransition();
  const [assigning, startAssigning] = useTransition();
  const sinceRef = useRef(new Date().toISOString());

  // Текущий оператор — из Bitrix (user.current), для «Назначить на себя».
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
          name: [data.NAME, data.LAST_NAME].filter(Boolean).join(" ") || `#${data.ID}`,
        });
      })
      .catch(() => {
        // не критично — просто не покажем «Назначить на себя»
      });
  }, [b24]);

  const loadClients = useCallback(() => {
    orpcClient.messages
      .list({ search: search || undefined })
      .then((res) => setClients(res.items))
      .catch(() => {
        // поллинг попробует снова
      })
      .finally(() => setClientsLoading(false));
  }, [search]);

  useEffect(() => {
    setClientsLoading(true);
    loadClients();
    const interval = setInterval(loadClients, LIST_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadClients]);

  const openClient = useCallback((messenger: InboxMessenger, userId: string) => {
    setSelected({ messenger, userId });
    setHistory([]);
    setSendError(null);
    setThreadLoading(true);
    orpcClient.messages
      .thread({ messenger, userId })
      .then((res) => {
        setHistory(
          res.messages.map((m) => ({
            id: m.id,
            messenger,
            direction: m.direction,
            source: m.source,
            text: m.text,
            createdAt: m.createdAt,
          })),
        );
        sinceRef.current =
          res.messages[res.messages.length - 1]?.createdAt ?? new Date().toISOString();
      })
      .finally(() => setThreadLoading(false));
    orpcClient.messages.markRead({ messenger, userId }).then(() => {
      setClients((prev) =>
        prev.map((c) =>
          c.messenger === messenger && c.userId === userId ? { ...c, unread: false } : c,
        ),
      );
    });
  }, []);

  // Поллинг открытого диалога — новые сообщения (клиент, оператор из Bitrix, виджет CRM).
  useEffect(() => {
    if (!selected) return;
    const { messenger, userId } = selected;

    const poll = async () => {
      if (document.hidden) return;
      const result = await orpcClient.messages.poll({
        messenger,
        userId,
        sinceIso: sinceRef.current,
      });
      if (!result.messages || result.messages.length === 0) return;
      sinceRef.current =
        result.messages[result.messages.length - 1]?.createdAt ?? sinceRef.current;
      setHistory((prev) =>
        mergeHistory(
          prev,
          result.messages?.map((m) => ({ ...m, messenger })) ?? [],
        ),
      );
    };

    const interval = setInterval(poll, THREAD_POLL_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (!document.hidden) poll();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [selected]);

  const send = () => {
    if (!selected) return;
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setSendError(null);
    startSending(async () => {
      const result = await orpcClient.messages.send({
        messenger: selected.messenger,
        userId: selected.userId,
        text: trimmed,
      });
      if (result.error) {
        setSendError(result.error);
        return;
      }
      setText("");
      const pendingId = `pending-${crypto.randomUUID()}`;
      setHistory((prev) => [
        ...prev,
        {
          id: pendingId,
          messenger: selected.messenger,
          direction: "out",
          source: "widget",
          text: trimmed,
          createdAt: new Date().toISOString(),
          pending: true,
        },
      ]);
      loadClients();
    });
  };

  const assignToMe = () => {
    if (!selected || !operator) return;
    startAssigning(async () => {
      await orpcClient.messages.assign({
        messenger: selected.messenger,
        userId: selected.userId,
        operatorId: operator.id,
        operatorName: operator.name,
      });
      setClients((prev) =>
        prev.map((c) =>
          c.messenger === selected.messenger && c.userId === selected.userId
            ? { ...c, assignedOperatorName: operator.name }
            : c,
        ),
      );
    });
  };

  const selectedClient = selected
    ? clients.find((c) => c.messenger === selected.messenger && c.userId === selected.userId)
    : null;

  return (
    <div className="flex h-[75vh] min-h-[480px] gap-4">
      <div className="flex w-80 shrink-0 flex-col gap-2 rounded-lg border">
        <div className="border-b p-2">
          <div className="relative">
            <SearchIcon className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по имени…"
              className="h-8 pl-7 text-sm"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {clientsLoading ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              Загружаем…
            </div>
          ) : clients.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Переписки не найдены</p>
          ) : (
            clients.map((c) => {
              const isSelected =
                selected?.messenger === c.messenger && selected.userId === c.userId;
              return (
                <button
                  key={clientKey(c.messenger, c.userId)}
                  type="button"
                  onClick={() => openClient(c.messenger, c.userId)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 border-b px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60",
                    isSelected && "bg-muted",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn("truncate", c.unread && "font-semibold")}>
                      {c.name}
                    </span>
                    {c.unread && <span className="size-2 shrink-0 rounded-full bg-primary" />}
                  </div>
                  <span className="truncate text-xs text-muted-foreground">
                    {c.lastMessageDirection === "out" ? "Вы: " : ""}
                    {c.lastMessageText}
                  </span>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span>{historyLabel(c.messenger)}</span>
                    {c.assignedOperatorName && (
                      <Badge variant="outline" className="h-4 px-1 text-[10px]">
                        {c.assignedOperatorName}
                      </Badge>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 rounded-lg border p-4">
        {!selected ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
            <MessageSquareIcon className="size-8" />
            <p className="text-sm">Выберите диалог слева</p>
          </div>
        ) : threadLoading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            Загружаем переписку…
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{selectedClient?.name ?? selected.userId}</p>
                <p className="text-xs text-muted-foreground">
                  {historyLabel(selected.messenger)}
                  {selectedClient?.assignedOperatorName
                    ? ` · Ответственный: ${selectedClient.assignedOperatorName}`
                    : ""}
                </p>
              </div>
              {operator && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={assignToMe}
                  disabled={assigning}
                >
                  {assigning ? (
                    <Loader2Icon className="size-3.5 animate-spin" />
                  ) : (
                    <UserCheckIcon className="size-3.5" />
                  )}
                  Назначить на себя
                </Button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              <HistoryList history={history} />
            </div>

            <MessageComposer
              text={text}
              onTextChange={setText}
              onSend={send}
              placeholder="Ответить клиенту… (Enter — отправить, Shift+Enter — новая строка)"
            />
            {sendError && <p className="text-sm text-destructive">{sendError}</p>}

            <Button onClick={send} disabled={sending || !text.trim()} className="self-start">
              {sending ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <SendIcon className="size-4" />
              )}
              Отправить
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
