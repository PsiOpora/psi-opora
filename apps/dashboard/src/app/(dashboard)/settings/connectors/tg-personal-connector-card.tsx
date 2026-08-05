"use client";

import { Text } from "@bitrix24/b24jssdk";
import type { TelegramPersonalAccountView } from "@psi-opora/api";
import { Loader2Icon, PlusIcon, RefreshCwIcon } from "lucide-react";
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

// Совпадает с дефолтом TG_USERBOT_CONNECTOR_ID (packages/config/src/env.ts) —
// клиентский код не видит серверный env, поэтому префикс здесь захардкожен,
// как и раньше. Каждый номер регистрируется под своим CONNECTOR_PREFIX_${slug}
// (см. generateConnectorId в routers/telegram-personal/helpers.ts), поэтому
// на одной линии может быть активно сразу несколько таких коннекторов.
const CONNECTOR_PREFIX = "psiopora_tg_personal";
const CONNECTOR_NAME = "Telegram (личный номер)";
const BITRIX_WEBHOOK_APP_URL = process.env.NEXT_PUBLIC_BITRIX_WEBHOOK_APP_URL;

// Telegram-иконка — Bitrix24 отклоняет регистрацию коннектора без неё
// (ICON_REQUIRED). DATA_IMAGE принимает data URI без CSS-обёртки url(...).
const ICON_SVG =
  "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0IiBmaWxsPSJ3aGl0ZSIvPgo8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTIyIDEyQzIyIDE3LjUyMjggMTcuNTIyOCAyMiAxMiAyMkM2LjQ3NzE1IDIyIDIgMTcuNTIyOCAyIDEyQzIgNi40NzcxNSA2LjQ3NzE1IDIgMTIgMkMxNy41MjI4IDIgMjIgNi40NzcxNSAyMiAxMlpNMTIuNTc4MyA5LjM2MjQ0QzExLjYwNTcgOS43NjcgOS42NjE3NyAxMC42MDQzIDYuNzQ2NTcgMTEuODc0NEM2LjI3MzE4IDEyLjA2MjcgNi4wMjUyMSAxMi4yNDY5IDYuMDAyNjMgMTIuNDI2OUM1Ljk2NDQ4IDEyLjczMTMgNi4zNDU1OCAxMi44NTExIDYuODY0NTUgMTMuMDE0M0M2LjkzNTE0IDEzLjAzNjUgNy4wMDgyOSAxMy4wNTk1IDcuMDgzMjcgMTMuMDgzOEM3LjU5Mzg1IDEzLjI0OTggOC4yODA2OCAxMy40NDQgOC42Mzc3MyAxMy40NTE3QzguOTYxNjEgMTMuNDU4NyA5LjMyMzEgMTMuMzI1MiA5LjcyMjE5IDEzLjA1MTFDMTIuNDQ2IDExLjIxMjUgMTMuODUyIDEwLjI4MzIgMTMuOTQwMiAxMC4yNjMxQzE0LjAwMjUgMTAuMjQ5IDE0LjA4ODggMTAuMjMxMiAxNC4xNDczIDEwLjI4MzJDMTQuMjA1OCAxMC4zMzUyIDE0LjIgMTAuNDMzNiAxNC4xOTM4IDEwLjQ2QzE0LjE1NjEgMTAuNjIxIDEyLjY2MDEgMTIuMDExNyAxMS44ODU5IDEyLjczMTVDMTEuNjQ0NiAxMi45NTU5IDExLjQ3MzQgMTMuMTE1IDExLjQzODQgMTMuMTUxNEMxMS4zNiAxMy4yMzI4IDExLjI4MDEgMTMuMzA5OCAxMS4yMDMzIDEzLjM4MzhDMTAuNzI5IDEzLjg0MTEgMTAuMzczMiAxNC4xODQgMTEuMjIzIDE0Ljc0NEMxMS42MzE0IDE1LjAxMzEgMTEuOTU4MSAxNS4yMzU2IDEyLjI4NDEgMTUuNDU3NkMxMi42NDAxIDE1LjcwMDEgMTIuOTk1MiAxNS45NDE5IDEzLjQ1NDcgMTYuMjQzMUMxMy41NzE3IDE2LjMxOTggMTMuNjgzNSAxNi4zOTk1IDEzLjc5MjQgMTYuNDc3MUMxNC4yMDY3IDE2Ljc3MjUgMTQuNTc4OSAxNy4wMzc5IDE1LjAzODggMTYuOTk1NUMxNS4zMDYgMTYuOTcwOSAxNS41ODIgMTYuNzE5NyAxNS43MjIyIDE1Ljk3MDNDMTYuMDUzNSAxNC4xOTkzIDE2LjcwNDcgMTAuMzYyIDE2Ljg1NTIgOC43ODA4MUMxNi44Njg0IDguNjQyMjggMTYuODUxOCA4LjQ2NDk4IDE2LjgzODQgOC4zODcxNUMxNi44MjUxIDguMzA5MzIgMTYuNzk3MyA4LjE5ODQyIDE2LjY5NjEgOC4xMTYzM0MxNi41NzYzIDguMDE5MTEgMTYuMzkxMyA3Ljk5ODYxIDE2LjMwODYgOC4wMDAwN0MxNS45MzI1IDguMDA2NyAxNS4zNTU0IDguMjA3MzUgMTIuNTc4MyA5LjM2MjQ0WiIgZmlsbD0idXJsKCNwYWludDBfbGluZWFyXzQ5MzZfMjcwNSkiLz4KPGRlZnM+CjxsaW5lYXJHcmFkaWVudCBpZD0icGFpbnQwX2xpbmVhcl80OTM2XzI3MDUiIHgxPSIxMiIgeTE9IjIiIHgyPSIxMiIgeTI9IjIxLjg1MTciIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KPHN0b3Agc3RvcC1jb2xvcj0iIzJBQUJFRSIvPgo8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMyMjlFRDkiLz4KPC9saW5lYXJHcmFkaWVudD4KPC9kZWZzPgo8L3N2Zz4K";

function handlerUrl(): string {
  return `${window.location.origin}/api/bitrix/tg-personal-widget`;
}

const STATUS_LABELS: Record<string, string> = {
  connected: "подключён",
  error: "ошибка",
};

/**
 * Управление коннекторами Открытых линий «Telegram (личный номер)» — каждый
 * подключаемый номер регистрируется как отдельный коннектор Bitrix24
 * (imconnector.register), что позволяет активировать несколько номеров на
 * одной линии одновременно (imconnector.activate — это слот на пару
 * CONNECTOR+LINE, а не на LINE целиком). Сам логин конкретного номера на
 * конкретной линии происходит нативно в Контакт-центре Bitrix24 —
 * администратор добавляет один из зарегистрированных здесь коннекторов как
 * канал на линии (откроется /widget/tg-personal-connector).
 */
export function TgPersonalConnectorCard() {
  const { b24, status } = useB24Frame();
  const [registeredIds, setRegisteredIds] = useState<string[]>([]);
  const [registeredNames, setRegisteredNames] = useState<
    Record<string, string>
  >({});
  const [accounts, setAccounts] = useState<TelegramPersonalAccountView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const refreshAccounts = useCallback(async () => {
    try {
      const { accounts: rows } = await orpcClient.telegramPersonal.list();
      setAccounts(rows);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const refreshRegistered = useCallback(async () => {
    if (!b24) return;
    try {
      const res = await b24.actions.v2.call.make({
        method: "imconnector.list",
        params: {},
        requestId: Text.getUuidRfc4122(),
      });
      if (!res.isSuccess) return;
      // result — объект `{connector_id: connector_name}`, а не массив
      // (см. документацию imconnector.list).
      const list = (
        res.getData() as { result?: Record<string, string> } | undefined
      )?.result;
      const ownConnectors = Object.fromEntries(
        Object.entries(list ?? {}).filter(([id]) =>
          id.startsWith(CONNECTOR_PREFIX),
        ),
      );
      setRegisteredIds(Object.keys(ownConnectors));
      setRegisteredNames(ownConnectors);
    } catch {
      // не критично — просто не покажем незанятые слоты
    }
  }, [b24]);

  useEffect(() => {
    if (status === "ready") {
      void refreshRegistered();
      void refreshAccounts();
    }
  }, [status, refreshRegistered, refreshAccounts]);

  const addSlot = () => {
    if (!b24) return;
    startTransition(async () => {
      setError(null);
      const toastId = toast.loading("Регистрируем номер…");
      try {
        const slot = await orpcClient.telegramPersonal.registerSlot();
        if (slot.error || !slot.connectorId) {
          throw new Error(slot.error ?? "Не удалось сгенерировать коннектор");
        }

        const res = await b24.actions.v2.call.make({
          method: "imconnector.register",
          params: {
            ID: slot.connectorId,
            NAME: `${CONNECTOR_NAME} №${registeredIds.length + 1}`,
            ICON: {
              DATA_IMAGE: ICON_SVG,
              COLOR: "#2AABEE",
              SIZE: "100%",
              POSITION: "center",
            },
            PLACEMENT_HANDLER: handlerUrl(),
            CHAT_GROUP: "N",
          },
          requestId: Text.getUuidRfc4122(),
        });
        if (!res.isSuccess) {
          throw new Error(res.getErrorMessages().join("; "));
        }
        await refreshRegistered();
        toast.success(
          "Номер зарегистрирован — откройте линию в Контакт-центре и добавьте этот канал",
          { id: toastId, duration: 8000 },
        );

        if (BITRIX_WEBHOOK_APP_URL) {
          const failures = await subscribeConnectorEvents(
            b24,
            BITRIX_WEBHOOK_APP_URL,
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

  const updateRegistered = () => {
    if (!b24 || registeredIds.length === 0) return;
    startTransition(async () => {
      setError(null);
      const toastId = toast.loading("Обновляем карточки Telegram…");
      try {
        for (const [index, connectorId] of registeredIds.entries()) {
          const res = await b24.actions.v2.call.make({
            method: "imconnector.register",
            params: {
              ID: connectorId,
              NAME:
                registeredNames[connectorId] ??
                `${CONNECTOR_NAME} №${index + 1}`,
              ICON: {
                DATA_IMAGE: ICON_SVG,
                COLOR: "#2AABEE",
                SIZE: "100%",
                POSITION: "center",
              },
              PLACEMENT_HANDLER: handlerUrl(),
              CHAT_GROUP: "N",
            },
            requestId: Text.getUuidRfc4122(),
          });
          if (!res.isSuccess) {
            throw new Error(res.getErrorMessages().join("; "));
          }
        }
        await refreshRegistered();
        toast.success("Карточки Telegram обновлены", { id: toastId });
      } catch (err) {
        const message = (err as Error).message;
        setError(message);
        toast.error(message, { id: toastId });
      }
    });
  };

  const disconnectAccount = (lineId: string, connectorId: string) => {
    startTransition(async () => {
      const toastId = toast.loading("Отключаем номер…");
      try {
        const res = await orpcClient.telegramPersonal.disconnect({
          lineId,
          connectorId,
        });
        if (res.error) throw new Error(res.error);
        await Promise.all([refreshAccounts(), refreshRegistered()]);
        toast.success("Номер отключён", { id: toastId });
      } catch (err) {
        toast.error((err as Error).message, { id: toastId });
      }
    });
  };

  const pendingSlots = registeredIds.filter(
    (id) => !accounts.some((acc) => acc.connectorId === id),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Telegram — личный номер</CardTitle>
        <CardDescription>
          Отдельный канал Открытых линий: реальный номер телефона (не бот) —
          можно писать клиенту первым и работать в групповых чатах. На одну
          линию можно добавить сразу несколько номеров — каждый нужно сперва
          зарегистрировать здесь, а затем подключить в Контакт-центре (Bitrix24
          откроет форму входа: телефон → код → пароль, если включена 2FA).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {status === "standalone" && (
          <p className="text-sm text-muted-foreground">
            Регистрация коннектора доступна только внутри Битрикс24.
          </p>
        )}

        {status === "ready" && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                зарегистрировано номеров: {registeredIds.length}
              </Badge>
              <Button onClick={addSlot} disabled={busy} size="sm">
                {busy ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <PlusIcon className="size-4" />
                )}
                Добавить номер
              </Button>
              {registeredIds.length > 0 && (
                <Button
                  onClick={updateRegistered}
                  disabled={busy}
                  size="sm"
                  variant="outline"
                >
                  <RefreshCwIcon className="size-4" />
                  Обновить карточки
                </Button>
              )}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            {pendingSlots.length > 0 && (
              <div className="flex flex-col gap-1">
                {pendingSlots.map((id) => (
                  <p key={id} className="text-xs text-muted-foreground">
                    Зарегистрирован, но ещё не подключён — откройте линию в
                    Контакт-центре и добавьте канал «{CONNECTOR_NAME}».
                  </p>
                ))}
              </div>
            )}

            {accounts.length > 0 && (
              <div className="flex flex-col gap-2">
                {accounts.map((acc) => (
                  <div
                    key={acc.connectorId}
                    className="flex items-center justify-between gap-4 rounded-md border px-3 py-2 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span>{acc.phone}</span>
                      <span className="text-xs text-muted-foreground">
                        линия {acc.lineId}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {STATUS_LABELS[acc.status] ?? acc.status}
                      </Badge>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        disconnectAccount(acc.lineId, acc.connectorId)
                      }
                    >
                      Отключить
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
