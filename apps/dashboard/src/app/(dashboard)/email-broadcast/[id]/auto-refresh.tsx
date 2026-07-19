"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Пока кампания выполняется в фоне, обновляем страницу раз в 5 секунд. */
export function AutoRefresh({ enabled }: { enabled: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [enabled, router]);

  return null;
}
