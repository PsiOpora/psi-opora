"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Loader2Icon, SendIcon } from "lucide-react";
import type { Messenger } from "@psi-opora/jobs";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  loadWidgetRecipientAction,
  sendWidgetMessageAction,
  type WidgetEntity,
  type WidgetHistoryItem,
  type WidgetRecipient,
} from "./actions";

const MESSENGER_LABELS: Record<Messenger, string> = {
  telegram: "Telegram",
  max: "MAX",
};

const SOURCE_LABELS: Record<string, string> = {
  reminder: "напоминание",
  widget: "из CRM",
  broadcast: "рассылка",
};

function HistoryList({ history }: { history: WidgetHistoryItem[] }) {
  if (history.length === 0) return null;
  return (
    <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto rounded-md border p-3">
      {history.map((item) => (
        <div
          key={`${item.createdAt}-${item.direction}-${item.text.slice(0, 20)}`}
          className={cn(
            "max-w-[85%] rounded-lg px-3 py-1.5 text-sm whitespace-pre-wrap",
            item.direction === "out"
              ? "self-end bg-primary/10"
              : "self-start bg-muted",
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
            {SOURCE_LABELS[item.source] ? ` · ${SOURCE_LABELS[item.source]}` : ""}
            {" · "}
            {MESSENGER_LABELS[item.messenger]}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Форма отправки сообщения клиенту через бота из карточки CRM.
 * Канал выбирается по тому, что записано в полях контакта
 * (IM telegram/max от наших ботов или UF-поля интеграций).
 */
export function MessageWidget({
  entity,
  entityId,
}: {
  entity: WidgetEntity;
  entityId: string;
}) {
  const [recipient, setRecipient] = useState<WidgetRecipient | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [channel, setChannel] = useState<Messenger | null>(null);
  const [text, setText] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<Date | null>(null);
  const [sending, startSending] = useTransition();

  const load = useCallback(() => {
    if (!entityId) {
      setLoadError("Откройте вкладку из карточки сделки или контакта");
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    loadWidgetRecipientAction(entity, entityId)
      .then(({ recipient: loaded, error }) => {
        if (error || !loaded) {
          setLoadError(error ?? "Не удалось получить данные");
          return;
        }
        setRecipient(loaded);
        setChannel(loaded.channels[0]?.messenger ?? null);
      })
      .catch((err) => setLoadError((err as Error).message))
      .finally(() => setLoading(false));
  }, [entity, entityId]);

  // Токены портала сохраняются BitrixFrameProvider чуть позже первого рендера —
  // при ошибке авторизации менеджер нажмёт «Повторить»
  useEffect(load, [load]);

  const send = () => {
    if (!recipient || !channel) return;
    const target = recipient.channels.find((c) => c.messenger === channel);
    if (!target) return;

    setSendError(null);
    startSending(async () => {
      const result = await sendWidgetMessageAction({
        messenger: target.messenger,
        userId: target.userId,
        text,
        contactId: recipient.contactId,
      });
      if (result.error) {
        setSendError(result.error);
        return;
      }
      setSentAt(new Date());
      setText("");
      // Пополняем историю локально, без повторного запроса
      setRecipient((prev) =>
        prev
          ? {
              ...prev,
              history: [
                ...prev.history,
                {
                  messenger: target.messenger,
                  direction: "out",
                  source: "widget",
                  text,
                  createdAt: new Date().toISOString(),
                },
              ],
            }
          : prev,
      );
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

  if (recipient.channels.length === 0) {
    return (
      <div className="py-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">{recipient.contactName}</p>
        <p className="mt-2">
          {recipient.note ??
            "У контакта не найден Telegram или MAX. Мессенджер появляется в полях контакта, когда клиент пишет нашему боту."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <div>
        <p className="text-sm font-medium">{recipient.contactName}</p>
        <p className="text-xs text-muted-foreground">
          Сообщение уйдёт от имени бота центра «Опора»
        </p>
      </div>

      <HistoryList history={recipient.history} />

      {recipient.channels.length > 1 && (
        <div className="flex gap-2">
          {recipient.channels.map((c) => (
            <button
              key={c.messenger}
              type="button"
              onClick={() => setChannel(c.messenger)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm transition-colors",
                channel === c.messenger
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-muted",
              )}
            >
              {MESSENGER_LABELS[c.messenger]}
            </button>
          ))}
        </div>
      )}

      {recipient.channels.length === 1 && (
        <p className="text-xs text-muted-foreground">
          Канал:{" "}
          {MESSENGER_LABELS[recipient.channels[0]?.messenger ?? "telegram"]}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <Label
          htmlFor="widget-message"
          className="text-xs text-muted-foreground"
        >
          Текст сообщения (поддерживается Markdown)
        </Label>
        <Textarea
          id="widget-message"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Здравствуйте! Это центр «Опора»…"
          className="min-h-28 text-sm"
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
        disabled={sending || !text.trim() || !channel}
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
