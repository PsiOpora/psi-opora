"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { orpc, orpcClient } from "@/lib/orpc/client";

export function RunBackupButton() {
	const queryClient = useQueryClient();
	const [isPending, startTransition] = useTransition();

	const onClick = () => {
		startTransition(async () => {
			const toastId = toast.loading("Запускаем бэкап CRM…");
			try {
				const result = await orpcClient.backup.runNow();
				if (result.ok) {
					toast.success(
						"Бэкап запущен. Прогресс отображается в таблице ниже.",
						{ id: toastId },
					);
				} else {
					toast.error(result.error ?? "Не удалось запустить бэкап", {
						id: toastId,
					});
				}
			} catch (err) {
				toast.error(
					err instanceof Error ? err.message : "Не удалось запустить бэкап",
					{ id: toastId },
				);
			}
			queryClient.invalidateQueries({ queryKey: orpc.backup.listRuns.key() });
		});
	};

	return (
		<Button
			type="button"
			variant="secondary"
			disabled={isPending}
			onClick={onClick}
		>
			{isPending ? "Запускаем…" : "Запустить бэкап сейчас"}
		</Button>
	);
}
