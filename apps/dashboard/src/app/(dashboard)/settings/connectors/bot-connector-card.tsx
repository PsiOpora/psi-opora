"use client";

import type { BotConnectorView } from "@psi-opora/api";
import { Loader2Icon } from "lucide-react";
import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { useB24Frame } from "@/components/bitrix/frame-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { orpcClient } from "@/lib/orpc/client";

type Messenger = "telegram" | "max";

// Совпадает с CONNECTOR_IDS в packages/api/src/routers/bot-connector/helpers.ts.
const CONNECTOR_IDS: Record<Messenger, string> = {
  telegram: "psiopora_tg_bot",
  max: "psiopora_max_bot",
};

// Простая монохромная иконка «бумажный самолётик» — Bitrix24 отклоняет
// регистрацию коннектора без иконки (ICON_REQUIRED).
const ICON_SVG =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white'%3E%3Cpath d='M2 21l21-9L2 3v7l15 2-15 2z'/%3E%3C/svg%3E";

function handlerUrl(messenger: Messenger): string {
  return `${window.location.origin}/api/bitrix/bot-connector-widget/${messenger}`;
}

/**
 * Регистрация коннектора Открытой линии для официального бота (Bot API) —
 * привязка к конкретной линии происходит нативно в Контакт-центре Bitrix24
 * (администратор добавляет канал на линии — откроется наше окно активации,
 * которое само привяжет линию и настроит вебхук бота, см.
 * /widget/bot-connector). Токен бота вводится там же, если ещё не сохранён
 * в БД (см. bot-connector-widget-client.tsx) — здесь только бейдж статуса.
 */
export function BotConnectorCard({
  messenger,
  label,
}: {
  messenger: Messenger;
  label: string;
}) {
  const { b24, status } = useB24Frame();
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [config, setConfig] = useState<BotConnectorView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const connectorId = CONNECTOR_IDS[messenger];

  const refreshStatus = useCallback(async () => {
    try {
      const result = await orpcClient.botConnector.status();
      setConfig(result[messenger]);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [messenger]);

  const checkRegistered = useCallback(async () => {
    if (!b24) return;
    try {
      const res = await b24.callMethod("imconnector.list", {});
      if (!res.isSuccess) return;
      const list = (res.getData() as { result?: string[] } | undefined)
        ?.result;
      setRegistered(!!list?.includes(connectorId));
    } catch {
      // не критично — просто не покажем статус регистрации
    }
  }, [b24, connectorId]);

  useEffect(() => {
    if (status === "ready") {
      void checkRegistered();
      void refreshStatus();
    }
  }, [status, checkRegistered, refreshStatus]);

  const register = () => {
    if (!b24) return;
    startTransition(async () => {
      setError(null);
      const toastId = toast.loading("Регистрируем коннектор…");
      try {
        const res = await b24.callMethod("imconnector.register", {
          ID: connectorId,
          NAME: `Пси-Опора ${label} Бот`,
          ICON: { DATA_IMAGE: ICON_SVG },
          PLACEMENT_HANDLER: handlerUrl(messenger),
        });
        if (!res.isSuccess) {
          throw new Error(res.getErrorMessages().join("; "));
        }
        setRegistered(true);
        toast.success("Коннектор зарегистрирован", { id: toastId });
      } catch (err) {
        const message = (err as Error).message;
        setError(message);
        toast.error(message, { id: toastId });
      }
    });
  };

  const disconnect = () => {
    startTransition(async () => {
      const toastId = toast.loading("Отключаем канал…");
      try {
        const res = await orpcClient.botConnector.deactivate({ messenger });
        if (res.error) throw new Error(res.error);
        await refreshStatus();
        toast.success("Канал отключён", { id: toastId });
      } catch (err) {
        toast.error((err as Error).message, { id: toastId });
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{label} — официальный бот</CardTitle>
        <CardDescription>
          После регистрации коннектор появится в списке каналов Контакт-центра
          — добавьте его на нужную линию, Bitrix24 откроет наше окно, которое
          само активирует линию и настроит вебхук бота (без ручных шагов).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {status === "standalone" && (
          <p className="text-sm text-muted-foreground">
            Регистрация доступна только внутри Битрикс24.
          </p>
        )}

        {status === "ready" && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={registered ? "default" : "secondary"}>
                {registered ? "коннектор зарегистрирован" : "не зарегистрирован"}
              </Badge>
              {config && (
                <>
                  <Badge variant="outline">линия {config.openLineId}</Badge>
                  <Badge
                    variant={config.webhookConfigured ? "default" : "destructive"}
                  >
                    {config.webhookConfigured
                      ? "вебхук настроен"
                      : "вебхук не настроен"}
                  </Badge>
                  <Badge variant={config.hasToken ? "default" : "destructive"}>
                    {config.hasToken ? "токен задан" : "токен не задан"}
                  </Badge>
                </>
              )}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex gap-2">
              <Button onClick={register} disabled={busy} size="sm">
                {busy && <Loader2Icon className="size-4 animate-spin" />}
                {registered ? "Переустановить" : "Зарегистрировать канал"}
              </Button>
              {config && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={disconnect}
                >
                  Отключить
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
