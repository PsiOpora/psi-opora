"use client";

import { BotIcon, HeadsetIcon } from "lucide-react";
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

/** Кто фактически отправил исходящее сообщение — определяет цвет пузыря и иконку:
 * бот/автоматика получает один стиль, живой оператор — другой. */
const SOURCE_META: Record<
  string,
  { label: string; category: "bot" | "operator" }
> = {
  scenario: { label: "бот", category: "bot" },
  reminder: { label: "напоминание", category: "bot" },
  broadcast: { label: "рассылка", category: "bot" },
  widget: { label: "оператор", category: "operator" },
  operator: { label: "оператор", category: "operator" },
};

const DEFAULT_SOURCE_META = { label: null, category: "operator" as const };

const BUBBLE_STYLES = {
  in: "self-start rounded-bl-md border bg-message-client text-message-client-foreground border-message-client-border",
  bot: "self-end rounded-br-md bg-message-bot text-message-bot-foreground",
  operator:
    "self-end rounded-br-md bg-message-operator text-message-operator-foreground",
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
      className="flex h-full flex-col overflow-y-auto px-4 py-3"
    >
      {messages.map((item, index) => {
        const prev = messages[index - 1];
        const showDay =
          !prev || dayKey(prev.createdAt) !== dayKey(item.createdAt);
        const meta =
          item.direction === "out"
            ? (SOURCE_META[item.source] ?? DEFAULT_SOURCE_META)
            : null;
        const groupedWithPrev =
          !showDay &&
          !!prev &&
          prev.direction === item.direction &&
          prev.source === item.source;
        const Icon = meta?.category === "bot" ? BotIcon : HeadsetIcon;

        return (
          <div
            key={item.id}
            className={cn(
              "flex flex-col",
              showDay ? "mt-0" : groupedWithPrev ? "mt-1" : "mt-3",
            )}
          >
            {showDay && (
              <div className="my-3 flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">
                  {formatDayLabel(item.createdAt)}
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>
            )}
            <div
              className={cn(
                "max-w-[70%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap shadow-sm",
                BUBBLE_STYLES[item.direction === "in" ? "in" : meta!.category],
                item.pending && "opacity-60",
              )}
            >
              {item.text}
              <div
                className={cn(
                  "mt-1 flex items-center gap-1 text-[10px] opacity-70",
                  item.direction === "out" ? "justify-end" : "",
                )}
              >
                {meta?.label && (
                  <>
                    <Icon className="size-3" />
                    <span>{meta.label}</span>
                    <span>·</span>
                  </>
                )}
                <span>{formatTime(item.createdAt)}</span>
                {item.pending && <span>· отправляется…</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
