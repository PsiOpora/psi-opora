"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { orpc } from "@/lib/orpc/client";

/** Создание нового списка или переименование существующего (если передан list). */
export function ListFormDialog({
	list,
	trigger,
}: {
	list?: { id: string; name: string; description: string | null };
	trigger: ReactNode;
}) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [name, setName] = useState(list?.name ?? "");
	const [description, setDescription] = useState(list?.description ?? "");

	const onSuccess = () => {
		queryClient.invalidateQueries({ queryKey: orpc.emailLists.key() });
		setOpen(false);
	};
	const create = useMutation(
		orpc.emailLists.create.mutationOptions({
			onSuccess: (created) => {
				onSuccess();
				toast.success(`Список «${created.name}» создан`);
				router.push(`/email-lists/${created.id}`);
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const update = useMutation(
		orpc.emailLists.update.mutationOptions({
			onSuccess: () => {
				onSuccess();
				toast.success("Список сохранён");
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const pending = create.isPending || update.isPending;

	const submit = () => {
		const payload = {
			name: name.trim(),
			description: description.trim() || undefined,
		};
		if (list) update.mutate({ id: list.id, ...payload });
		else create.mutate(payload);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (next) {
					setName(list?.name ?? "");
					setDescription(list?.description ?? "");
				}
			}}
		>
			<DialogTrigger asChild>{trigger}</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{list ? "Редактировать список" : "Новый список"}
					</DialogTitle>
					<DialogDescription>
						Список — это набор адресов для рассылки, не связанный с CRM.
						Контакты добавляются импортом CSV или вручную.
					</DialogDescription>
				</DialogHeader>
				<form
					className="flex flex-col gap-4"
					onSubmit={(e) => {
						e.preventDefault();
						if (name.trim()) submit();
					}}
				>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="list-name">Название</Label>
						<Input
							id="list-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Например: Участники вебинара 12 октября"
							maxLength={200}
							autoFocus
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="list-description">Описание (необязательно)</Label>
						<Textarea
							id="list-description"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							placeholder="Откуда адреса и на что люди давали согласие"
							maxLength={1000}
						/>
					</div>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => setOpen(false)}
						>
							Отмена
						</Button>
						<Button type="submit" disabled={!name.trim() || pending}>
							{pending ? "Сохраняем…" : list ? "Сохранить" : "Создать"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
