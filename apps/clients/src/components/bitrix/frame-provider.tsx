"use client";

import {
  ApiVersion,
  type B24Frame,
  initializeB24Frame,
} from "@bitrix24/b24jssdk";
import { AlertCircleIcon, Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type Status = "connecting" | "ready" | "standalone" | "error";

interface B24FrameState {
  /** Подключение к порталу; null — standalone-режим или ещё подключаемся. */
  b24: B24Frame | null;
  status: Status;
}

const B24FrameContext = createContext<B24FrameState>({
  b24: null,
  status: "connecting",
});

/** Доступ к B24Frame из клиентских компонентов (виджеты, placement.bind). */
export function useB24Frame(): B24FrameState {
  return useContext(B24FrameContext);
}

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
  const [b24, setB24] = useState<B24Frame | null>(null);
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
        const frame = await initializeB24Frame();
        const authData = frame.auth.getAuthData();
        if (!authData)
          throw new Error("Битрикс24 не передал данные авторизации");

        const clientEndpoint =
          frame.getTargetOriginWithPath().get(ApiVersion.v2) ??
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

        if (frame.isFirstRun) {
          await frame.installFinish();
        }

        if (cancelled) return;
        setB24(frame);
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

  const contextValue = useMemo<B24FrameState>(
    () => ({ b24, status }),
    [b24, status],
  );

  let content: React.ReactNode;
  if (status === "connecting") {
    content = (
      <div className="flex min-h-svh items-center justify-center gap-2 text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" />
        Подключаемся к Битрикс24…
      </div>
    );
  } else if (status === "error") {
    content = (
      <div className="flex min-h-svh items-center justify-center p-6">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircleIcon />
          <AlertTitle>Не удалось подключиться к Битрикс24</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  } else {
    content = children;
  }

  return (
    <B24FrameContext.Provider value={contextValue}>
      {content}
    </B24FrameContext.Provider>
  );
}
