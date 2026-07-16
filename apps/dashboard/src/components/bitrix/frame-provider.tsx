"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiVersion, initializeB24Frame } from "@bitrix24/b24jssdk";
import { AlertCircleIcon, Loader2Icon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type Status = "connecting" | "ready" | "standalone" | "error";

/**
 * Устанавливает сессию с порталом Битрикс24, когда приложение открыто во
 * фрейме (см. https://apidocs.bitrix24.ru/api-reference/oauth/simple-way.html).
 * Полученные access/refresh токены сохраняются на сервере (см.
 * /api/bitrix/session), после чего router.refresh() перезапускает серверные
 * компоненты дашборда уже с доступом к CRM.
 */
export function BitrixFrameProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("connecting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (window.parent === window) {
      // Открыто напрямую (локальная разработка) — работаем через вебхук из .env.
      setStatus("standalone");
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const b24 = await initializeB24Frame();
        const authData = b24.auth.getAuthData();
        if (!authData)
          throw new Error("Битрикс24 не передал данные авторизации");

        const clientEndpoint =
          b24.getTargetOriginWithPath().get(ApiVersion.v2) ??
          `https://${authData.domain}/rest/`;

        const res = await fetch("/api/bitrix/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            memberId: authData.member_id,
            domain: authData.domain,
            clientEndpoint,
            accessToken: authData.access_token,
            refreshToken: authData.refresh_token,
            expiresAt: authData.expires,
            scope: typeof authData.scope === "string" ? authData.scope : "",
          }),
        });
        if (!res.ok) throw new Error("Не удалось сохранить сессию Битрикс24");

        if (b24.isFirstRun) {
          await b24.installFinish();
        }

        if (cancelled) return;
        setStatus("ready");
        router.refresh();
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (status === "connecting") {
    return (
      <div className="flex min-h-svh items-center justify-center gap-2 text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" />
        Подключаемся к Битрикс24…
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex min-h-svh items-center justify-center p-6">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircleIcon />
          <AlertTitle>Не удалось подключиться к Битрикс24</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return <>{children}</>;
}
