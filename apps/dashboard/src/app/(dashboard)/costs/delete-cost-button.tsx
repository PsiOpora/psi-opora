"use client";

import { Trash2Icon } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { orpc } from "@/lib/orpc/client";

export function DeleteCostButton({
	id,
	label,
}: {
	id: string;
	/** Описание записи для текста подтверждения, например "2026-01 · yandex · 5 000 ₽". */
	label: string;
}) {
	const queryClient = useQueryClient();

	const mutation = useMutation(
		orpc.costs.delete.mutationOptions({
			onSuccess: () => {
				toast.success("Расход удалён");
				queryClient.invalidateQueries({ queryKey: orpc.costs.list.key() });
			},
			onError: (error) => {
				toast.error(error.message || "Не удалось удалить расход");
			},
		}),
	);

	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					aria-label="Удалить расход"
					disabled={mutation.isPending}
				>
					<Trash2Icon />
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Удалить расход?</AlertDialogTitle>
					<AlertDialogDescription>
						Запись {label} будет удалена без возможности восстановления.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Отмена</AlertDialogCancel>
					<AlertDialogAction
						onClick={() => mutation.mutate({ id })}
						className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
					>
						Удалить
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
