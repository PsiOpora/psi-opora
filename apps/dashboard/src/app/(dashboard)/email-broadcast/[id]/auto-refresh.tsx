"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { emailCampaignDetailKey } from "./query-keys";

/** Пока кампания выполняется в фоне, перезапрашиваем статус раз в 5 секунд. */
export function AutoRefresh({ enabled, id }: { enabled: boolean; id: string }) {
	const queryClient = useQueryClient();

	useEffect(() => {
		if (!enabled) return;
		const timer = setInterval(() => {
			queryClient.invalidateQueries({ queryKey: emailCampaignDetailKey(id) });
		}, 5000);
		return () => clearInterval(timer);
	}, [enabled, id, queryClient]);

	return null;
}
