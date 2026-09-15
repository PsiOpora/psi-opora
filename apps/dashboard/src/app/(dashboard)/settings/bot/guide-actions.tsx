"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
import { orpc } from "@/lib/orpc/client";

export function SendTestGuideButton() {
	const [open, setOpen] = useState(false);
	const [email, setEmail] = useState("");
	const mutation = useMutation(
		orpc.bot.sendTestGuide.mutationOptions({
			onSuccess: () => {
				setOpen(false);
				setEmail("");
				toast.success("Тестовое письмо отправлено");
			},
			onError: (error) => {
				toast.error(error.message || "Не удалось отправить тестовое письмо");
			},
		}),
	);

	const send = () => {
		const recipient = email.trim();
		if (!recipient) {
			toast.error("Укажите email получателя");
			return;
		}
		mutation.mutate({ email: recipient });
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button type="button" variant="outline" size="sm">
					Отправить тест письма
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Отправить тестовое письмо</DialogTitle>
					<DialogDescription>
						Уйдёт ровно то же письмо, что и клиенту: активный гайд вложением,
						текущие тема и текст письма из настроек ниже.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-2">
					<Label htmlFor="test-guide-email">Email получателя</Label>
					<Input
						id="test-guide-email"
						type="email"
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") send();
						}}
						placeholder="name@example.com"
						autoComplete="email"
						disabled={mutation.isPending}
					/>
				</div>
				<DialogFooter>
					<Button
						type="button"
						onClick={send}
						disabled={mutation.isPending || !email.trim()}
					>
						{mutation.isPending ? "Отправляем…" : "Отправить"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export function SetActiveGuideButton({
	id,
	title,
}: {
	id: string;
	title: string;
}) {
	const queryClient = useQueryClient();

	const mutation = useMutation(
		orpc.bot.setActiveGuide.mutationOptions({
			onSuccess: () => {
				toast.success(`«${title}» теперь активный гайд`);
				queryClient.invalidateQueries({ queryKey: orpc.bot.listGuides.key() });
				queryClient.invalidateQueries({ queryKey: orpc.bot.getTexts.key() });
			},
			onError: (error) => {
				toast.error(error.message || "Не удалось выполнить действие");
			},
		}),
	);

	return (
		<Button
			type="button"
			variant="outline"
			size="sm"
			disabled={mutation.isPending}
			onClick={() => mutation.mutate({ id })}
		>
			Сделать активным
		</Button>
	);
}

export function DeleteGuideButton({
	id,
	title,
	isActive,
}: {
	id: string;
	title: string;
	isActive: boolean;
}) {
	const queryClient = useQueryClient();

	const mutation = useMutation(
		orpc.bot.deleteGuide.mutationOptions({
			onSuccess: () => {
				toast.success(`«${title}» удалён`);
				queryClient.invalidateQueries({ queryKey: orpc.bot.listGuides.key() });
				queryClient.invalidateQueries({ queryKey: orpc.bot.getTexts.key() });
			},
			onError: (error) => {
				toast.error(error.message || "Не удалось выполнить действие");
			},
		}),
	);

	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={mutation.isPending}
				>
					Удалить
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Удалить гайд?</AlertDialogTitle>
					<AlertDialogDescription>
						{isActive
							? `«${title}» сейчас активен — после удаления бот перестанет слать вложение до выбора другого гайда.`
							: `Файл «${title}» будет удалён из библиотеки и из хранилища. Это необратимо.`}
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
