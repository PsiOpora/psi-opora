"use client";

import { Loader2Icon } from "lucide-react";
import { useCallback, useEffect, useState, useTransition } from "react";
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

const PLACEMENTS = [
  { code: "CRM_DEAL_DETAIL_TAB", label: "Карточка сделки" },
  { code: "CRM_CONTACT_DETAIL_TAB", label: "Карточка контакта" },
] as const;

const TAB_TITLE = "Мессенджер";

interface PlacementRow {
  placement: string;
  handler: string;
}

function handlerUrl(): string {
  return `${window.location.origin}/api/bitrix/widget`;
}

/**
 * Регистрация вкладки «Мессенджер» в карточках CRM Битрикс24 (placement.bind).
 * Работает только внутри фрейма портала: bind/unbind выполняются от имени
 * приложения, вебхуком их вызвать нельзя.
 */
export function CrmWidgetsCard() {
  const { b24, status } = useB24Frame();
  const [bound, setBound] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    if (!b24) return;
    try {
      const res = await b24.callMethod("placement.get", {});
      const rows = ((res.getData() as { result?: PlacementRow[] } | undefined)
        ?.result ?? []) as PlacementRow[];
      const url = handlerUrl();
      setBound(
        rows.filter((row) => row.handler === url)h (err) {
      setError((err as Error).message);
    }
  }, [b24]);

  useEffect(() => {
    if (status === "ready") void refresh();
  }, [status, refresh]);

  const bindAll = () => {
    if (!b24) return;
    startTransition(async () => {
      setError(null);
      try {
        for (const { code } of PLACEMENTS) {
          await b24.callMethod("placement.bind", {
            PLACEMENT: code,
            HANDLER: handlerUrl(),
            TITLE: TAB_TITLE,
            LANG_ALL: {
              ru: { TITLE: TAB_TITLE },
              en: { TITLE: "Messenger" },
            },
          });
        }
        await refresh();
      } catch (err) {
        const message = (err as Error).message;
        setError(
          /scope|insufficient/i.test(message)
            ? `${message}. Добавьте приложению право «Встраивание приложений» (placement) в настройках локального приложения на портале.`
            : message,
        );
      }
    });
  };

  const unbindAll = () => {
    if (!b24) return;
    startTransition(async () => {
      setError(null);
      try {
        for (const { code } of PLACEMENTS) {
          await b24.callMethod("placement.unbind", {
            PLACEMENT: code,
            HANDLER: handlerUrl(),
          });
        }
        await refresh();
      } catch (err) {
        setError((err as Error).message);
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Вкладка «Мессенджер» в CRM</CardTitle>
        <CardDescription>
          Добавляет в карточки сделки и контакта Битрикс24 вкладку, из которой
          менеджер может написать клиенту через бота Telegram или MAX — канал
          определяется по полям контакта.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {status === "standalone" && (
          <p className="text-sm text-muted-foreground">
            Управление вкладками доступно, только когда дашборд открыт внутри
            Битрикс24 (регистрация выполняется от имени приложения).
          </p>
        )}

        {status === "ready" && (
          <>
            <div className="flex flex-wrap gap-2">
              {PLACEMENTS.map(({ code, label }) => (
                <Badge
                  key={code}
                  variant={bound?.includes(code) ? "default" : "secondary"}
                >
                  {label}: {bound?.includes(code) ? "подключена" : "нет"}
                </Badge>
              ))}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex gap-2">
              <Button onClick={bindAll} disabled={busy || !b24} size="sm">
                {busy && <Loader2Icon className="size-4 animate-spin" />}
                {bound?.length ? "Переподключить" : "Подключить вкладки"}
              </Button>
              {bound !== null && bound.length > 0 && (
                <Button
                  onClick={unbindAll}
                  disabled={busy}
                  size="sm"
                  variant="outline"
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
