"use client";

import { CheckIcon, Loader2Icon } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { orpcClient } from "@/lib/orpc/client";

type Messenger = "telegram" | "max";
type Status = "activating" | "done" | "error";

/**
 * Активация канала бота на линии — без полей ввода: токен уже известен
 * серверу (.env), при монтировании сразу вызываем activate (привязка линии +
 * автонастройка вебхука). Кнопка «Повторить» — на случай сбоя.
 */
export function BotConnectorWidgetClient({
  messenger,
  lineId,
}: {
  messenger: Messenger;
  lineId: string;
}) {
  const [status, setStatus] = useState<Status>("activating");
  const [error, setError] = useState<string | null>(null);
  const [webhookError, setWebhookError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const activate = () => {
    if (!lineId) return;
    setStatus("activating");
    setError(null);
    startTransition(async () => {
      try {
        const res = await orpcClient.botConnector.activate({
          messenger,
          lineId,
        });
        if (res.error) {
          setError(res.error);
          setStatus("error");
          return;
        }
        setWebhookError(res.webhookError ?? null);
        setStatus("done");
      } catch (err) {
        setError((err as Error).message);
        setStatus("error");
      }
    });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: активируем один раз при монтировании
  useEffect(() => {
    activate();
  }, []);

  if (!lineId) {
    return (
      <p className="text-xs text-destructive">
        Откройте это окно из настроек канала на линии в Контакт-центре — не
        удалось определить линию.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {status === "activating" && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2Icon className="size-3.5 animate-spin" />
          Активируем линию…
        </p>
      )}

      {status === "done" && (
        <>
          <p className="flex items-center gap-1.5 text-sm text-emerald-600">
            <CheckIcon className="size-4" />
            Линия активирована
          </p>
          {webhookError && (
            <p className="text-xs text-destructive">
              Вебхук бота не настроен: {webhookError}. Линия всё равно активна —
              можно повторить ниже.
            </p>
          )}
        </>
      )}

      {status === "error" && error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {(status === "error" || webhookError) && (
        <Button size="sm" onClick={activate} disabled={busy}>
          {busy && <Loader2Icon className="size-3.5 animate-spin" />}
          Повторить
        </Button>
      )}
    </div>
  );
}
