"use client";

import { useEffect, useRef } from "react";
import { formatDayLabel, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Сообщение треда; pending — оптимистично добавленное до подтверждения поллингом. */
export interface ThreadMessage {
  id: string;
  direction: "in" | "out";
  source: string;
  text: string;
  createdAt: string;
  pending?: boolean;
}

/** Подпись источника исходящего сообщения — откуда оно было отправлено. */
const SOURCE_LABELS: Record<string, string> = {
  scenario: "бот",
  reminder: "напоминание",
  widget: "оператор",
  broadcast: "рассылка",
  operator: "оператор",
};

/** Насколько близко к низу нужно быть, чтобы новое сообщение автоскроллило —
 * иначе менеджера, читающего историю выше, не «дёрнет» вниз поллингом. */
const STICK_TO_BOTTOM_THRESHOLD_PX = 60;

/** Вливает новые сообщения с поллинга в локальную историю: заменяет
 * совпадающее оптимистичное сообщение подтверждённой записью (чтобы не
 * задваивать только что отправленное), остальное — добавляет. */
export function mergeThread(
  prev: ThreadMessage[],
  incoming: ThreadMessage[],
): ThreadMessage[] {
  let next = prev;
  for (const msg of incoming) {
    if (next.some((item) => item.id === msg.id)) continue;
    const pendingIdx = next.findIndex(
      (item) =>
        item.id.startsWith("pending-") &&
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

function dayKey(iso: string): string {
  return new Date(iso).toDateString();
}

export function MessageList({ messages }: { messages: ThreadMessage[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const el = containerRef.current;
    if (el && stickToBottomRef.current && messages.length > 0) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    stickToBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <
      STICK_TO_BOTTOM_THRESHOLD_PX;
  };

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex h-full flex-col gap-1.5 overflow-y-auto px-4 py-3"
    >
      {messages.map((item, index) => {
        const prev = messages[index - 1];
        const showDay =
          !prev || dayKey(prev.createdAt) !== dayKey(item.createdAt);
        const sourceLabel =
          item.direction === "out" ? SOURCE_LABELS[item.source] : null;
        return (
          <div key={item.id} className="flex flex-col gap-1.5">
            {showDay && (
              <div className="my-2 flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">
                  {formatDayLabel(item.createdAt)}
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>
            )}
            <div
              className={cn(
                "max-w-[70%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap",
                item.direction === "out"
                  ? "self-end rounded-br-md bg-primary text-primary-foreground"
                  : "self-start rounded-bl-md bg-muted",
                item.pending && "opacity-60",
              )}
            >
              {item.text}
              <div
                className={cn(
                  "mt-1 flex items-center gap-1 text-[10px]",
                  item.direction === "out"
                    ? "justify-end text-primary-foreground/70"
                    : "text-muted-foreground",
                )}
              >
                <span>{formatTime(item.createdAt)}</span>
                {sourceLabel && <span>· {sourceLabel}</span>}
                {item.pending && <span>· отправляется…</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
