"use client";

import type { WidgetChannel, WidgetEntity, WidgetRecipient } from "@psi-opora/api";
import { MESSAGE_MAX_LENGTH } from "@psi-opora/api/schemas";
import { CheckIcon, Loader2Icon, SendIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  type HistoryEntry,
  HistoryList,
  mergeHistory,
} from "@/components/messaging/history-list";
import { MessageComposer } from "@/components/messaging/message-composer";
import { orpcClient } from "@/lib/orpc/client";
import { cn } from "@/lib/utils";

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

function channelKey(channel: Pick<WidgetChannel, "messenger" | "lineId">): string {
  return `${channel.messenger}:${channel.lineId ?? ""}`;
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

  // Момент последнего известного сообщения — поллинг запрашивает только то, что новее.
  const sinceRef = useRef(new Date().toISOString());

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
        <MessageComposer
          text={text}
          onTextChange={setText}
          onSend={send}
          placeholder="Здравствуйте! Это центр «Опора»… (Enter — отправить, Shift+Enter — новая строка)"
        />
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
