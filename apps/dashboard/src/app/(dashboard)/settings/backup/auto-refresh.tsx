"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Пока бэкап выполняется в фоне, обновляем страницу раз в 3 секунды, чтобы видеть прогресс. */
export function AutoRefresh({ enabled }: { enabled: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [enabled, router]);

  return null;
}
