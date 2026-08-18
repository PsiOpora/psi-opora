"use client";

import type { WidgetHistoryItem } from "@psi-opora/api";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/** Оптимистично добавленное сообщение до подтверждения записи в БД поллингом. */
export type HistoryEntry = WidgetHistoryItem & { pending?: boolean };

// Подпись канала в истории переписки — для ботов фиксированная, для
// telegram-personal показываем то, что вернул сервер (с номером), где есть.
export const MESSENGER_LABELS: Record<string, string> = {
  telegram: "Telegram",
  max: "MAX",
  "telegram-personal": "Telegram (личный)",
};

export function historyLabel(messenger: string): string {
  return MESSENGER_LABELS[messenger] ?? messenger;
}

export const SOURCE_LABELS: Record<string, string> = {
  reminder: "напоминание",
  widget: "из CRM",
  broadcast: "рассылка",
  operator: "оператор",
};

/** Насколько близко к низу нужно быть, чтобы новое сообщение автоскроллило —
 * иначе менеджер, читающий историю выше, не будет «дёрнут» вниз поллингом. */
const STICK_TO_BOTTOM_THRESHOLD_PX = 40;

/** Статус доставки исходящего сообщения. Выше "sent" его поднимает только
 * WhatsApp (ack WAHA) — у Telegram/MAX нет вебхуков доставки, это ограничение
 * их API. "failed" ставят пути отправки, когда мессенджер отклонил сообщение
 * (бот заблокирован, диалог удалён и т.п.). */
export const STATUS_LABELS: Record<string, string> = {
  sent: "отправлено",
  delivered: "доставлено",
  read: "прочитано",
  failed: "не доставлено",
};

/** Вливает новые сообщения с поллинга в локальную историю: уже известный id —
 * обновляет запись на месте (так долетают статусные апдейты sent → delivered
 * → read → failed по уже показанным сообщениям, поллинг ходит по updatedAt),
 * совпадающее по смыслу оптимистичное сообщение — заменяет подтверждённой
 * записью (чтобы не задваивать только что отправленное), остальное —
 * добавляет. Матчинг оптимистичной записи идёт по id с префиксом "pending-",
 * а не по флагу `pending` — он мог быть уже снят по таймауту, но запись всё
 * ещё нужно бесшовно заменить подтверждённой, без дубля. */
export function mergeHistory(
  prev: HistoryEntry[],
  incoming: WidgetHistoryItem[],
): HistoryEntry[] {
  let next = prev;
  for (const msg of incoming) {
    const existingIdx = next.findIndex((item) => item.id === msg.id);
    if (existingIdx !== -1) {
      next = [
        ...next.slice(0, existingIdx),
        { ...next[existingIdx], ...msg },
        ...next.slice(existingIdx + 1),
      ];
      continue;
    }
    const pendingIdx = next.findIndex(
      (item) =>
        item.id.startsWith("pending-") &&
        item.messenger === msg.messenger &&
        item.direction === msg.direction &&
        item.text === msg.text,
    );
    if (pendingIdx !== -1) {
      next = [...next.slice(0, pendingIdx), msg, ...next.slice(pendingIdx + 1)];
    } else {
      next = [...next, msg];
    }
  }
  return next;
}

export function HistoryList({ history }: { history: HistoryEntry[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const el = containerRef.current;
    if (el && stickToBottomRef.current && history.length > 0) {
      el.scrollTop = el.scrollHeight;
    }
  }, [history.length]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    stickToBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <
      STICK_TO_BOTTOM_THRESHOLD_PX;
  };

  if (history.length === 0) return null;
  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex max-h-64 flex-col gap-1.5 overflow-y-auto rounded-md border p-3"
    >
      {history.map((item) => (
        <div
          key={item.id}
          className={cn(
            "max-w-[85%] rounded-lg px-3 py-1.5 text-sm whitespace-pre-wrap",
            item.direction === "out"
              ? "self-end bg-primary/10"
              : "self-start bg-muted",
            item.pending && "opacity-60",
            item.direction === "out" &&
              item.status === "failed" &&
              "ring-1 ring-destructive/40",
          )}
        >
          {item.text}
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            {new Date(item.createdAt).toLocaleString("ru-RU", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
            {" · "}
            {item.direction === "out" ? "бот" : "клиент"}
            {SOURCE_LABELS[item.source]
              ? ` · ${SOURCE_LABELS[item.source]}`
              : ""}
            {" · "}
            {historyLabel(item.messenger)}
            {item.pending ? " · отправляется…" : ""}
            {/* Статус показываем только у исходящих и только после
                подтверждения записью в БД: у оптимистичной записи он всегда
                "sent" и вводил бы в заблуждение. */}
            {!item.pending &&
            item.direction === "out" &&
            STATUS_LABELS[item.status] ? (
              <span
                className={cn(
                  item.status === "failed" && "font-medium text-destructive",
                )}
              >
                {` · ${STATUS_LABELS[item.status]}`}
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
