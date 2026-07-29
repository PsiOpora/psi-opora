"use client";

import { Text } from "@bitrix24/b24jssdk";
import type { BotConnectorView } from "@psi-opora/api";
import { env } from "@psi-opora/config";
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
import { subscribeConnectorEvents } from "@/lib/bitrix/connector-events";
import { orpcClient } from "@/lib/orpc/client";

type Messenger = "telegram" | "max";

// Совпадает с CONNECTOR_IDS в packages/api/src/routers/bot-connector/helpers.ts.
const CONNECTOR_IDS: Record<Messenger, string> = {
  telegram: "psiopora_tg_bot",
  max: "psiopora_max_bot",
};

const ICON_COLORS: Record<Messenger, string> = {
  telegram: "#2AABEE",
  max: "#8B00FF",
};

// Bitrix24 отклоняет регистрацию коннектора без иконки (ICON_REQUIRED).
// Base64 не содержит кавычек, которые ломают генерируемый Bitrix24 url('...').
const ICON_SVGS: Record<Messenger, string> = {
  telegram:
    "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0IiBmaWxsPSJ3aGl0ZSIvPgo8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTIyIDEyQzIyIDE3LjUyMjggMTcuNTIyOCAyMiAxMiAyMkM2LjQ3NzE1IDIyIDIgMTcuNTIyOCAyIDEyQzIgNi40NzcxNSA2LjQ3NzE1IDIgMTIgMkMxNy41MjI4IDIgMjIgNi40NzcxNSAyMiAxMlpNMTIuNTc4MyA5LjM2MjQ0QzExLjYwNTcgOS43NjcgOS42NjE3NyAxMC42MDQzIDYuNzQ2NTcgMTEuODc0NEM2LjI3MzE4IDEyLjA2MjcgNi4wMjUyMSAxMi4yNDY5IDYuMDAyNjMgMTIuNDI2OUM1Ljk2NDQ4IDEyLjczMTMgNi4zNDU1OCAxMi44NTExIDYuODY0NTUgMTMuMDE0M0M2LjkzNTE0IDEzLjAzNjUgNy4wMDgyOSAxMy4wNTk1IDcuMDgzMjcgMTMuMDgzOEM3LjU5Mzg1IDEzLjI0OTggOC4yODA2OCAxMy40NDQgOC42Mzc3MyAxMy40NTE3QzguOTYxNjEgMTMuNDU4NyA5LjMyMzEgMTMuMzI1MiA5LjcyMjE5IDEzLjA1MTFDMTIuNDQ2IDExLjIxMjUgMTMuODUyIDEwLjI4MzIgMTMuOTQwMiAxMC4yNjMxQzE0LjAwMjUgMTAuMjQ5IDE0LjA4ODggMTAuMjMxMiAxNC4xNDczIDEwLjI4MzJDMTQuMjA1OCAxMC4zMzUyIDE0LjIgMTAuNDMzNiAxNC4xOTM4IDEwLjQ2QzE0LjE1NjEgMTAuNjIxIDEyLjY2MDEgMTIuMDExNyAxMS44ODU5IDEyLjczMTVDMTEuNjQ0NiAxMi45NTU5IDExLjQ3MzQgMTMuMTE1IDExLjQzODQgMTMuMTUxNEMxMS4zNiAxMy4yMzI4IDExLjI4MDEgMTMuMzA5OCAxMS4yMDMzIDEzLjM4MzhDMTAuNzI5IDEzLjg0MTEgMTAuMzczMiAxNC4xODQgMTEuMjIzIDE0Ljc0NEMxMS42MzE0IDE1LjAxMzEgMTEuOTU4MSAxNS4yMzU2IDEyLjI4NDEgMTUuNDU3NkMxMi42NDAxIDE1LjcwMDEgMTIuOTk1MiAxNS45NDE5IDEzLjQ1NDcgMTYuMjQzMUMxMy41NzE3IDE2LjMxOTggMTMuNjgzNSAxNi4zOTk1IDEzLjc5MjQgMTYuNDc3MUMxNC4yMDY3IDE2Ljc3MjUgMTQuNTc4OSAxNy4wMzc5IDE1LjAzODggMTYuOTk1NUMxNS4zMDYgMTYuOTcwOSAxNS41ODIgMTYuNzE5NyAxNS43MjIyIDE1Ljk3MDNDMTYuMDUzNSAxNC4xOTkzIDE2LjcwNDcgMTAuMzYyIDE2Ljg1NTIgOC43ODA4MUMxNi44Njg0IDguNjQyMjggMTYuODUxOCA4LjQ2NDk4IDE2LjgzODQgOC4zODcxNUMxNi44MjUxIDguMzA5MzIgMTYuNzk3MyA4LjE5ODQyIDE2LjY5NjEgOC4xMTYzM0MxNi41NzYzIDguMDE5MTEgMTYuMzkxMyA3Ljk5ODYxIDE2LjMwODYgOC4wMDAwN0MxNS45MzI1IDguMDA2NyAxNS4zNTU0IDguMjA3MzUgMTIuNTc4MyA5LjM2MjQ0WiIgZmlsbD0idXJsKCNwYWludDBfbGluZWFyXzQ5MzZfMjcwNSkiLz4KPGRlZnM+CjxsaW5lYXJHcmFkaWVudCBpZD0icGFpbnQwX2xpbmVhcl80OTM2XzI3MDUiIHgxPSIxMiIgeTE9IjIiIHgyPSIxMiIgeTI9IjIxLjg1MTciIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KPHN0b3Agc3RvcC1jb2xvcj0iIzJBQUJFRSIvPgo8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMyMjlFRDkiLz4KPC9saW5lYXJHcmFkaWVudD4KPC9kZWZzPgo8L3N2Zz4K",
  max: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIGZpbGw9J25vbmUnIHZpZXdCb3g9Jy0xMCAtMTAgNjIgNjInPjxwYXRoIGZpbGw9JyNmZmYnIGZpbGwtcnVsZT0nZXZlbm9kZCcgZD0nTTIxLjQ3IDQxLjg4Yy00LjExIDAtNi4wMi0uNi05LjM0LTMtMi4xIDIuNy04Ljc1IDQuODEtOS4wNCAxLjIgMC0yLjcxLS42LTUtMS4yOC03LjVDMSAyOS41LjA4IDI2LjA3LjA4IDIxLjEuMDggOS4yMyA5LjgyLjMgMjEuMzYuM2MxMS41NSAwIDIwLjYgOS4zNyAyMC42IDIwLjkxYTIwLjYgMjAuNiAwIDAgMS0yMC40OSAyMC42N20uMTctMzEuMzJjLTUuNjItLjI5LTEwIDMuNi0xMC45NyA5LjctLjggNS4wNS42MiAxMS4yIDEuODMgMTEuNTIuNTguMTQgMi4wNC0xLjA0IDIuOTUtMS45NWExMC40IDEwLjQgMCAwIDAgNS4wOCAxLjgxIDEwLjcgMTAuNyAwIDAgMCAxMS4xOS05Ljk3IDEwLjcgMTAuNyAwIDAgMC0xMC4wOC0xMS4xWicgY2xpcC1ydWxlPSdldmVub2RkJy8+PC9zdmc+",
};

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
      const res = await b24.actions.v2.call.make({
        method: "imconnector.list",
        params: {},
        requestId: Text.getUuidRfc4122(),
      });
      if (!res.isSuccess) return;
      // result — объект `{connector_id: connector_name}`, а не массив
      // (см. документацию imconnector.list) — Object.hasOwn, не .includes.
      const list = (
        res.getData() as { result?: Record<string, string> } | undefined
      )?.result;
      setRegistered(Object.hasOwn(list ?? {}, connectorId));
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
        const res = await b24.actions.v2.call.make({
          method: "imconnector.register",
          params: {
            ID: connectorId,
            NAME: `Пси-Опора ${label} Бот`,
            ICON: {
              DATA_IMAGE: ICON_SVGS[messenger],
              COLOR: ICON_COLORS[messenger],
              SIZE: "100%",
              POSITION: "center",
            },
            PLACEMENT_HANDLER: handlerUrl(messenger),
          },
          requestId: Text.getUuidRfc4122(),
        });
        if (!res.isSuccess) {
          throw new Error(res.getErrorMessages().join("; "));
        }
        setRegistered(true);
        toast.success("Коннектор зарегистрирован", { id: toastId });

        if (env.NEXT_PUBLIC_BITRIX_WEBHOOK_APP_URL) {
          const failures = await subscribeConnectorEvents(
            b24,
            `${env.NEXT_PUBLIC_BITRIX_WEBHOOK_APP_URL}`,
          );
          if (failures.length > 0) {
            toast.error(
              `Не удалось подписаться на события: ${failures.join("; ")}`,
            );
          }
        } else {
          toast.warning(
            "NEXT_PUBLIC_BITRIX_WEBHOOK_APP_URL не задан — ответы оператора не будут доставляться без ручной настройки исходящего вебхука в Bitrix24",
          );
        }
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
          После регистрации коннектор появится в списке каналов Контакт-центра —
          добавьте его на нужную линию, Bitrix24 откроет наше окно, которое само
          активирует линию и настроит вебхук бота (без ручных шагов).
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
                {registered
                  ? "коннектор зарегистрирован"
                  : "не зарегистрирован"}
              </Badge>
              {config && (
                <>
                  <Badge variant="outline">линия {config.openLineId}</Badge>
                  <Badge
                    variant={
                      config.webhookConfigured ? "default" : "destructive"
                    }
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
