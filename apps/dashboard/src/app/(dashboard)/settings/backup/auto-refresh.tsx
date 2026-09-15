"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { orpc } from "@/lib/orpc/client";

/** Пока бэкап выполняется в фоне, перезапрашиваем статус раз в 3 секунды, чтобы видеть прогресс. */
export function AutoRefresh({ enabled }: { enabled: boolean }) {
	const queryClient = useQueryClient();

	useEffect(() => {
		if (!enabled) return;
		const timer = setInterval(() => {
			queryClient.invalidateQueries({ queryKey: orpc.backup.listRuns.key() });
		}, 3000);
		return () => clearInterval(timer);
	}, [enabled, queryClient]);

	return null;
}
