"use client";

import type {
  WidgetChannel,
  WidgetEntity,
  WidgetHistoryItem,
  WidgetRecipient,
} from "@psi-opora/api";
import { MESSAGE_MAX_LENGTH } from "@psi-opora/api/schemas";
import {
  BoldIcon,
  CheckIcon,
  CodeIcon,
  ItalicIcon,
  Link2Icon,
  Loader2Icon,
  SendIcon,
} from "lucide-react";
import type * as React from "react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { orpcClient } from "@/lib/orpc/client";
import { cn } from "@/lib/utils";

/** Оптимистично добавленное сообщение до подтверждения записи в БД поллингом. */
type HistoryEntry = WidgetHistoryItem & { pending?: boolean };

const POLL_INTERVAL_MS = 5000;
/** Через сколько снимать надпись «отправляется…», даже если поллинг ещё не
 * подтвердил запись в БД (сама отправка клиенту при этом уже прошла успешно). */
const PENDING_LABEL_TIMEOUT_MS = 8000;

function draftStorageKey(entity: WidgetEntity, entityId: string): string {
  return `psi-opora:widget-draft:${entity}:${entityId}`;
}

/** localStorage может быть недоступен в iframe виджета (Safari ITP и т.п.) —
 * тогда черновик просто не сохраняется, без падения виджета. */
function readDraft(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeDraft(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // недоступно — черновик не сохранится, отправка сообщений при этом не страдает
  }
}

/**
 * Кнопки разметки соответствуют «легаси» Markdown Telegram, с которым
 * реально отправляются сообщения (см. packages/jobs/src/messenger.ts):
 * *жирный*, _курсив_, `код`, [текст](ссылка) — без **, __ и других вариантов.
 */
const MARKDOWN_ACTIONS: Array<{
  label: string;
  icon: typeof BoldIcon;
  before: string;
  after: string;
  placeholder: string;
}> = [
  {
    label: "Жирный",
    icon: BoldIcon,
    before: "*",
    after: "*",
    placeholder: "жирный текст",
  },
  {
    label: "Курсив",
    icon: ItalicIcon,
    before: "_",
    after: "_",
    placeholder: "курсив",
  },
  { label: "Код", icon: CodeIcon, before: "`", after: "`", placeholder: "код" },
];

// Подпись канала в истории переписки — для ботов фиксированная, для
// telegram-personal показываем то, что вернул сервер (с номером), см.
// historyLabel() ниже (WidgetHistoryItem не хранит label каналов).
const MESSENGER_LABELS: Record<string, string> = {
  telegram: "Telegram",
  max: "MAX",
  "telegram-personal": "Telegram (личный)",
};

function historyLabel(messenger: string): string {
  return MESSENGER_LABELS[messenger] ?? messenger;
}

function channelKey(channel: Pick<WidgetChannel, "messenger" | "lineId">): string {
  return `${channel.messenger}:${channel.lineId ?? ""}`;
}

const SOURCE_LABELS: Record<string, string> = {
  reminder: "напоминание",
  widget: "из CRM",
  broadcast: "рассылка",
};

/** Насколько близко к низу нужно быть, чтобы новое сообщение автоскроллило —
 * иначе менеджер, читающий историю выше, не будет «дёрнут» вниз поллингом. */
const STICK_TO_BOTTOM_THRESHOLD_PX = 40;

function HistoryList({ history }: { history: HistoryEntry[] }) {
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
          </div>
        </div>
      ))}
    </div>
  );
}

/** Вливает новые сообщения с поллинга в локальную историю: заменяет
 * совпадающее по смыслу оптимистичное сообщение подтверждённой записью
 * (чтобы не задваивать только что отправленное), остальное — добавляет.
 * Матчинг идёт по id с префиксом "pending-", а не по флагу `pending` —
 * он мог быть уже снят по таймауту (см. PENDING_LABEL_TIMEOUT_MS), но
 * запись всё ещё нужно бесшовно заменить подтверждённой, без дубля. */
function mergeHistory(
  prev: HistoryEntry[],
  incoming: WidgetHistoryItem[],
): HistoryEntry[] {
  let next = prev;
  for (const msg of incoming) {
    if (next.some((item) => item.id === msg.id)) continue;
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

/**
 * Форма отправки сообщения клиенту из карточки CRM. Список каналов —
 * динамический (recipient.channels): боты — только если контакт уже писал
 * (поля контакта), личный(е) номер(а) Telegram — всегда, если у контакта
 * есть телефон (можно писать первым, см. packages/tg-userbot).
 */
export function MessageWidget({
  entity,
  entityId,
}: {
  entity: WidgetEntity;
  entityId: string;
}) {
  const [recipient, setRecipient] = useState<WidgetRecipient | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [channel, setChannel] = useState<WidgetChannel | null>(null);
  const [text, setText] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<Date | null>(null);
  const [sending, startSending] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Момент последнего известного сообщения — поллинг запрашивает только то, что новее.
  const sinceRef = useRef(new Date().toISOString());

  /** Оборачивает выделенный текст в разметку (или подставляет плейсхолдер) и
   * оставляет его выделенным, чтобы сразу можно было напечатать своё. */
  const wrapSelection = useCallback(
    (before: string, after: string, placeholder: string) => {
      const el = textareaRef.current;
      const start = el?.selectionStart ?? text.length;
      const end = el?.selectionEnd ?? text.length;
      const selected = text.slice(start, end) || placeholder;
      const next =
        text.slice(0, start) + before + selected + after + text.slice(end);
      setText(next);
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(
          start + before.length,
          start + before.length + selected.length,
        );
      });
    },
    [text],
  );

  /** Ссылка: выделенный текст (или плейсхолдер) уходит в подпись,
   * а под курсор попадает URL — чтобы сразу его вписать. */
  const insertLink = useCallback(() => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const label = text.slice(start, end) || "текст ссылки";
    const url = "https://";
    const next = `${text.slice(0, start)}[${label}](${url})${text.slice(end)}`;
    setText(next);
    const urlStart = start + label.length + 3;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(urlStart, urlStart + url.length);
    });
  }, [text]);

  const load = useCallback(() => {
    if (!entityId) {
      setLoadError("Откройте вкладку из карточки сделки или контакта");
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    orpcClient.widgetMessage
      .loadRecipient({ entity, id: entityId })
      .then(({ recipient: loaded, error }) => {
        if (error || !loaded) {
          setLoadError(error ?? "Не удалось получить данные");
          return;
        }
        setRecipient(loaded);
        setHistory(loaded.history);
        sinceRef.current =
          loaded.history[loaded.history.length - 1]?.createdAt ??
          new Date().toISOString();
        setChannel(loaded.channels[0] ?? null);
      })
      .catch((err) => setLoadError((err as Error).message))
      .finally(() => setLoading(false));
  }, [entity, entityId]);

  // Токены портала сохраняются BitrixFrameProvider чуть позже первого рендера —
  // при ошибке авторизации менеджер нажмёт «Повторить»
  useEffect(load, [load]);

  // Черновик переживает случайное закрытие/переключение вкладки CRM —
  // восстанавливается один раз на элемент CRM, если поле ещё пустое.
  useEffect(() => {
    if (!entityId) return;
    const saved = readDraft(draftStorageKey(entity, entityId));
    if (saved) setText(saved);
  }, [entity, entityId]);

  useEffect(() => {
    if (!entityId) return;
    writeDraft(draftStorageKey(entity, entityId), text);
  }, [entity, entityId, text]);

  // Поллинг: новые сообщения клиента (и отправленные из других мест — сценарий,
  // напоминание, рассылка) подтягиваются без перезагрузки вкладки. Пока вкладка
  // CRM не в фокусе — не дёргаем Bitrix API, а сразу опрашиваем при возврате.
  useEffect(() => {
    if (!entityId || loading || loadError || !recipient) return;
    if (recipient.channels.length === 0) return;

    const poll = async () => {
      if (document.hidden) return;
      const result = await orpcClient.widgetMessage.poll({
        entity,
        id: entityId,
        sinceIso: sinceRef.current,
      });
      if (!result.messages || result.messages.length === 0) return;
      sinceRef.current =
        result.messages[result.messages.length - 1]?.createdAt ??
        sinceRef.current;
      setHistory((prev) => mergeHistory(prev, result.messages ?? []));
    };

    const interval = setInterval(poll, POLL_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (!document.hidden) poll();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [entity, entityId, loading, loadError, recipient]);

  const trimmedText = text.trim();
  const overLimit = trimmedText.length > MESSAGE_MAX_LENGTH;

  const send = () => {
    if (!recipient || !channel || !trimmedText || overLimit || sending) return;

    setSendError(null);
    startSending(async () => {
      const result = await orpcClient.widgetMessage.send({
        entity,
        entityId,
        messenger: channel.messenger,
        lineId: channel.lineId,
        text: trimmedText,
      });
      if (result.error) {
        setSendError(result.error);
        return;
      }
      setSentAt(new Date());
      setText("");
      // Показываем сообщение сразу же, не дожидаясь ближайшего поллинга —
      // он позже заменит эту запись подтверждённой (см. mergeHistory).
      const pendingId = `pending-${crypto.randomUUID()}`;
      setHistory((prev) => [
        ...prev,
        {
          id: pendingId,
          messenger: channel.messenger,
          direction: "out",
          source: "widget",
          text: trimmedText,
          createdAt: new Date().toISOString(),
          pending: true,
        },
      ]);
      // Сама отправка клиенту уже прошла успешно — если запись в журнал БД
      // почему-то подвиснет и поллинг её не подтвердит, не держим надпись
      // «отправляется…» вечно (mergeHistory всё равно бесшовно заменит эту
      // запись подтверждённой, когда/если она подтянется позже).
      setTimeout(() => {
        setHistory((prev) =>
          prev.map((item) =>
            item.id === pendingId ? { ...item, pending: false } : item,
          ),
        );
      }, PENDING_LABEL_TIMEOUT_MS);
    });
  };

  const handleTextareaKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" />
        Загружаем данные контакта…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-start gap-3 py-4">
        <p className="text-sm text-destructive">{loadError}</p>
        <Button variant="outline" size="sm" onClick={load}>
          Повторить
        </Button>
      </div>
    );
  }

  if (!recipient) return null;

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <div>
        <p className="text-sm font-medium">{recipient.contactName}</p>
        <p className="text-xs text-muted-foreground">
          Сообщение уйдёт от имени бота центра «Опора»
        </p>
      </div>

      <HistoryList history={history} />

      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">Канал отправки</p>
        {recipient.channels.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {recipient.channels.map((c) => {
              const selected = channel && channelKey(channel) === channelKey(c);
              return (
                <button
                  key={channelKey(c)}
                  type="button"
                  onClick={() => setChannel(c)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:bg-muted",
                  )}
                >
                  <CheckIcon className="size-3.5 text-emerald-500" />
                  {c.label}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {recipient.note ??
              "У контакта не найден Telegram/MAX и нет телефона. Мессенджер появляется в полях контакта, когда клиент пишет нашему боту, либо станет доступен личный номер Telegram, если указан телефон."}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label
          htmlFor="widget-message"
          className="text-xs text-muted-foreground"
        >
          Текст сообщения (поддерживается Markdown)
        </Label>
        <div className="flex gap-1 rounded-t-md border border-b-0 bg-muted/40 p-1">
          {MARKDOWN_ACTIONS.map(
            ({ label, icon: Icon, before, after, placeholder }) => (
              <Button
                key={label}
                type="button"
                variant="ghost"
                size="icon-sm"
                title={label}
                aria-label={label}
                onClick={() => wrapSelection(before, after, placeholder)}
              >
                <Icon className="size-3.5" />
              </Button>
            ),
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="Ссылка"
            aria-label="Ссылка"
            onClick={insertLink}
          >
            <Link2Icon className="size-3.5" />
          </Button>
        </div>
        <Textarea
          id="widget-message"
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleTextareaKeyDown}
          placeholder="Здравствуйте! Это центр «Опора»… (Enter — отправить, Shift+Enter — новая строка)"
          className="min-h-28 rounded-t-none text-sm"
        />
        <span
          className={cn(
            "self-end text-xs",
            overLimit ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {trimmedText.length} / {MESSAGE_MAX_LENGTH}
          {overLimit && " — мессенджеры не примут такое длинное сообщение"}
        </span>
      </div>

      {sendError && <p className="text-sm text-destructive">{sendError}</p>}
      {sentAt && !sendError && (
        <p className="text-sm text-emerald-600">
          ✓ Отправлено в {sentAt.toLocaleTimeString("ru-RU")} — добавлено в
          таймлайн контакта
        </p>
      )}

      <Button
        onClick={send}
        disabled={sending || !trimmedText || !channel || overLimit}
        className="self-start"
      >
        {sending ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : (
          <SendIcon className="size-4" />
        )}
        Отправить
      </Button>
    </div>
  );
}
