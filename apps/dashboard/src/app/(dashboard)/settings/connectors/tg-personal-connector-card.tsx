"use client";

import type { TelegramPersonalAccountView } from "@psi-opora/api";
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

const CONNECTOR_ID = "psiopora_tg_personal";
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
 * Регистрация коннектора Открытых линий «Telegram (личный номер)» — сам
 * логин конкретного номера на конкретной линии происходит нативно в
 * Контакт-центре Bitrix24 (администратор добавляет канал на линии и
 * выбирает этот коннектор — откроется /widget/tg-personal-connector).
 */
export function TgPersonalConnectorCard() {
  const { b24, status } = useB24Frame();
  const [registered, setRegistered] = useState<boolean | null>(null);
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

  const checkRegistered = useCallback(async () => {
    if (!b24) return;
    try {
      const res = await b24.callMethod("imconnector.list", {});
      if (!res.isSuccess) return;
      const list = (res.getData() as { result?: string[] } | undefined)?.result;
      setRegistered(!!list?.includes(CONNECTOR_ID));
    } catch {
      // не критично — просто не покажем статус регистрации
    }
  }, [b24]);

  useEffect(() => {
    if (status === "ready") {
      void checkRegistered();
      void refreshAccounts();
    }
  }, [status, checkRegistered, refreshAccounts]);

  const register = () => {
    if (!b24) return;
    startTransition(async () => {
      setError(null);
      const toastId = toast.loading("Регистрируем коннектор…");
      try {
        const res = await b24.callMethod("imconnector.register", {
          ID: CONNECTOR_ID,
          NAME: CONNECTOR_NAME,
          ICON: { DATA_IMAGE: ICON_SVG, COLOR: "#2AABEE" },
          PLACEMENT_HANDLER: handlerUrl(),
          CHAT_GROUP: "N",
        });
        if (!res.isSuccess) {
          throw new Error(res.getErrorMessages().join("; "));
        }
        setRegistered(true);
        toast.success("Коннектор зарегистрирован", { id: toastId });

        if (env.NEXT_PUBLIC_BITRIX_WEBHOOK_APP_URL) {
          const failures = await subscribeConnectorEvents(
            b24,
            `${env.NEXT_PUBLIC_BITRIX_WEBHOOK_APP_URL}/api/bitrix-webhook`,
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

  const disconnectAccount = (lineId: string) => {
    startTransition(async () => {
      const toastId = toast.loading("Отключаем номер…");
      try {
        const res = await orpcClient.telegramPersonal.disconnect({ lineId });
        if (res.error) throw new Error(res.error);
        await refreshAccounts();
        toast.success("Номер отключён", { id: toastId });
      } catch (err) {
        toast.error((err as Error).message, { id: toastId });
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Telegram — личный номер</CardTitle>
        <CardDescription>
          Отдельный канал Открытых линий: реальный номер телефона (не бот) —
          можно писать клиенту первым и работать в групповых чатах. После
          регистрации коннектор появится в списке каналов Контакт-центра —
          подключение конкретного номера к линии происходит там же (Bitrix24
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
            <div className="flex items-center gap-2">
              <Badge variant={registered ? "default" : "secondary"}>
                {registered
                  ? "коннектор зарегистрирован"
                  : "не зарегистрирован"}
              </Badge>
              <Button onClick={register} disabled={busy} size="sm">
                {busy && <Loader2Icon className="size-4 animate-spin" />}
                {registered ? "Переустановить" : "Зарегистрировать канал"}
              </Button>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            {accounts.length > 0 && (
              <div className="flex flex-col gap-2">
                {accounts.map((acc) => (
                  <div
                    key={acc.lineId}
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
                      onClick={() => disconnectAccount(acc.lineId)}
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
