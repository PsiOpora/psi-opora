"use client";

import type { TelegramPersonalAccountView } from "@psi-opora/api";
import { Text } from "@bitrix24/b24jssdk";
import { env } from "@psi-opora/config";
import { Loader2Icon, PlusIcon } from "lucide-react";
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

// Простая монохромная иконка «бумажный самолётик» — Bitrix24 отклоняет
// регистрацию коннектора без иконки (ICON_REQUIRED).
const ICON_SVG =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='white'%3E%3Cpath d='M2 21l21-9L2 3v7l15 2-15 2z'/%3E%3C/svg%3E";

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
      const list = (res.getData() as { result?: Record<string, string> } | undefined)
        ?.result;
      setRegisteredIds(
        Object.keys(list ?? {}).filter((id) => id.startsWith(CONNECTOR_PREFIX)),
      );
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
            ICON: { DATA_IMAGE: ICON_SVG, COLOR: "#2AABEE" },
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
          зарегистрировать здесь, а затем подключить в Контакт-центре
          (Bitrix24 откроет форму входа: телефон → код → пароль, если включена
          2FA).
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
            <div className="flex items-center gap-2">
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
