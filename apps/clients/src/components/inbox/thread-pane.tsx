"use client";

import type { ClientListItem, InboxMessenger } from "@psi-opora/api";
import {
  Loader2Icon,
  MessageSquareIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  SendIcon,
  UserCheckIcon,
} from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { ClientAvatar } from "@/components/inbox/client-avatar";
import {
  MessageList,
  mergeThread,
  type ThreadMessage,
} from "@/components/inbox/message-list";
import { messengerLabel } from "@/components/inbox/messenger-meta";
import { QuickReplies } from "@/components/inbox/quick-replies";
import { MessageComposer } from "@/components/messaging/message-composer";
import { Button } from "@/components/ui/button";
import { orpcClient } from "@/lib/orpc/client";

const THREAD_POLL_INTERVAL_MS = 5000;

/** Курсор поллинга — максимальный updatedAt среди сообщений, а не createdAt:
 * listBotMessagesSince ловит и статусные апдейты уже показанных сообщений
 * (sent → delivered → read), не только новые строки, поэтому нельзя
 * полагаться на порядок массива и брать «последний» элемент. */
function latestUpdatedAt(messages: { updatedAt: string }[]): string {
  const max = messages.reduce(
    (acc, m) => (m.updatedAt > acc ? m.updatedAt : acc),
    "",
  );
  return max || new Date().toISOString();
}

export interface SelectedClient {
  messenger: InboxMessenger;
  userId: string;
}

export interface CurrentOperator {
  id: string;
  name: string;
}

interface ThreadPaneProps {
  selected: SelectedClient | null;
  client: ClientListItem | undefined;
  operator: CurrentOperator | null;
  showProfile: boolean;
  onToggleProfile: () => void;
  /** Обновить список диалогов (последнее сообщение, порядок) после отправки. */
  onAfterSend: () => void;
  /** Отразить назначение ответственного в списке диалогов. */
  onAssigned: (operator: CurrentOperator) => void;
}

export function ThreadPane({
  selected,
  client,
  operator,
  showProfile,
  onToggleProfile,
  onAfterSend,
  onAssigned,
}: ThreadPaneProps) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [text, setText] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, startSending] = useTransition();
  const [assigning, startAssigning] = useTransition();
  const sinceRef = useRef(new Date().toISOString());

  // Загрузка переписки при смене выбранного клиента.
  useEffect(() => {
    if (!selected) return;
    const { messenger, userId } = selected;
    let cancelled = false;

    setMessages([]);
    setText("");
    setSendError(null);
    setThreadLoading(true);
    orpcClient.messages
      .thread({ messenger, userId })
      .then((res) => {
        if (cancelled) return;
        setMessages(
          res.messages.map((m) => ({
            id: m.id,
            direction: m.direction,
            source: m.source,
            text: m.text,
            operatorName: m.operatorName,
            status: m.status,
            createdAt: m.createdAt,
            updatedAt: m.updatedAt,
          })),
        );
        sinceRef.current = latestUpdatedAt(res.messages);
      })
      .finally(() => {
        if (!cancelled) setThreadLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selected]);

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
      sinceRef.current = latestUpdatedAt(result.messages);
      setMessages((prev) =>
        mergeThread(
          prev,
          result.messages?.map((m) => ({
            id: m.id,
            direction: m.direction,
            source: m.source,
            text: m.text,
            operatorName: m.operatorName,
            status: m.status,
            createdAt: m.createdAt,
            updatedAt: m.updatedAt,
          })) ?? [],
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
        operatorId: operator?.id,
        operatorName: operator?.name,
      });
      if (result.error) {
        setSendError(result.error);
        return;
      }
      setText("");
      setMessages((prev) => [
        ...prev,
        {
          id: `pending-${crypto.randomUUID()}`,
          direction: "out",
          source: "widget",
          text: trimmed,
          operatorName: operator?.name,
          createdAt: new Date().toISOString(),
          pending: true,
        },
      ]);
      onAfterSend();
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
      onAssigned(operator);
    });
  };

  if (!selected) {
    return (
      <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
        <MessageSquareIcon className="size-10" />
        <p className="text-sm">Выберите диалог из списка слева</p>
      </div>
    );
  }

  const name = client?.name ?? selected.userId;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-2.5">
        <ClientAvatar
          name={name}
          avatarUrl={client?.avatarUrl ?? null}
          messenger={selected.messenger}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {messengerLabel(selected.messenger)}
            {client?.username ? ` · @${client.username}` : ""}
            {client?.assignedOperatorName
              ? ` · Ответственный: ${client.assignedOperatorName}`
              : " · Без ответственного"}
          </p>
        </div>
        {operator && client?.assignedOperatorId !== operator.id && (
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
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleProfile}
          title={
            showProfile
              ? "Скрыть карточку клиента"
              : "Показать карточку клиента"
          }
        >
          {showProfile ? (
            <PanelRightCloseIcon className="size-4" />
          ) : (
            <PanelRightOpenIcon className="size-4" />
          )}
        </Button>
      </div>

      <div className="min-h-0 flex-1">
        {threadLoading ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            Загружаем переписку…
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Сообщений пока нет — напишите первым
          </div>
        ) : (
          <MessageList messages={messages} />
        )}
      </div>

      <div className="border-t p-3">
        <MessageComposer
          text={text}
          onTextChange={setText}
          onSend={send}
          placeholder="Ответить клиенту… (Enter — отправить, Shift+Enter — новая строка)"
        />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <QuickReplies
              onInsert={(template) =>
                setText((prev) =>
                  prev.trim() ? `${prev}\n${template}` : template,
                )
              }
            />
            {sendError && (
              <p className="text-sm text-destructive">{sendError}</p>
            )}
          </div>
          <Button onClick={send} disabled={sending || !text.trim()}>
            {sending ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <SendIcon className="size-4" />
            )}
            Отправить
          </Button>
        </div>
      </div>
    </div>
  );
}
