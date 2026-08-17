"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

const FOCUS_REFRESH_DELAY = 30 * 1000; // 30 секунд после возвращения фокуса

interface UseDataRefreshOptions {
  /** Минимальный интервал между обновлениями (мс). По умолчанию 30 сек. */
  minInterval?: number;
  /** Включить автоматическое обновление при фокусе. По умолчанию true. */
  refreshOnFocus?: boolean;
}

interface UseDataRefreshReturn {
  /** Флаг, что сейчас идёт обновление данных. */
  isRefreshing: boolean;
  /** Время до следующего автоматического обновления (сек), null если не активно. */
  nextRefreshIn: number | null;
  /** Принудительно обновить данные сейчас. */
  refresh: () => void;
}

/**
 * Хук для автоматического и ручного обновления данных на dashboard.
 * - Обновляет данные при возвращении фокуса (если прошло достаточно времени)
 * - Предоставляет ручную кнопку обновления для пользователя
 */
export function useDataRefresh(
  options: UseDataRefreshOptions = {},
): UseDataRefreshReturn {
  const { minInterval = FOCUS_REFRESH_DELAY, refreshOnFocus = true } = options;
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [nextRefreshIn, setNextRefreshIn] = useState<number | null>(null);

  const lastRefreshRef = useRef<number>(Date.now());
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(() => {
    if (isRefreshing) return;

    setIsRefreshing(true);
    lastRefreshRef.current = Date.now();
    router.refresh();
    void queryClient
      .invalidateQueries({ queryKey: ["dashboard-bitrix"] })
      .finally(() => setIsRefreshing(false));
  }, [isRefreshing, queryClient, router]);

  // Обновление при фокусе окна
  useEffect(() => {
    if (!refreshOnFocus) return;

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        const timeSinceLastRefresh = Date.now() - lastRefreshRef.current;
        if (timeSinceLastRefresh >= minInterval) {
          refresh();
        }
      }
    }

    function handleFocus() {
      const timeSinceLastRefresh = Date.now() - lastRefreshRef.current;
      if (timeSinceLastRefresh >= minInterval) {
        refresh();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [refresh, refreshOnFocus, minInterval]);

  // Countdown таймер до следующего обновления (для UI)
  useEffect(() => {
    function updateCountdown() {
      const elapsed = Date.now() - lastRefreshRef.current;
      const remaining = minInterval - elapsed;

      if (remaining <= 0) {
        setNextRefreshIn(null);
      } else {
        setNextRefreshIn(Math.ceil(remaining / 1000));
      }
    }

    updateCountdown();
    countdownRef.current = setInterval(updateCountdown, 1000);

    return () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
      }
    };
  }, [minInterval]);

  return { isRefreshing, nextRefreshIn, refresh };
}
