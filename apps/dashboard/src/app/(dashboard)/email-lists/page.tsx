"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { formatDateTime } from "@/components/email/email-format";
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
import { Card, CardContent } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { orpc } from "@/lib/orpc/client";
import { ListFormDialog } from "./list-form-dialog";
import { SuppressionsCard } from "./suppressions-card";

function DeleteListButton({ id, name }: { id: string; name: string }) {
	const queryClient = useQueryClient();
	const mutation = useMutation(
		orpc.emailLists.remove.mutationOptions({
			onSuccess: () => {
				toast.success(`Список «${name}» удалён`);
				queryClient.invalidateQueries({ queryKey: orpc.emailLists.key() });
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Button variant="outline" size="sm" disabled={mutation.isPending}>
					Удалить
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Удалить список?</AlertDialogTitle>
					<AlertDialogDescription>
						«{name}» и все его контакты будут удалены. Статистика уже
						отправленных по списку рассылок сохранится.
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

function ListsTable() {
	const { data: lists = [], isLoading } = useQuery(
		orpc.emailLists.list.queryOptions(),
	);

	if (isLoading) {
		return <p className="text-sm text-muted-foreground">Загрузка…</p>;
	}
	if (lists.length === 0) {
		return (
			<Card>
				<CardContent className="flex flex-col items-center gap-3 py-10 text-center">
					<p className="font-medium">Списков пока нет</p>
					<p className="max-w-md text-sm text-muted-foreground">
						Создайте список и загрузите в него адреса из CSV-файла (выгрузка из
						Excel, Google Таблиц, другой CRM) — затем по нему можно запустить
						email-рассылку на странице «Email-рассылка».
					</p>
					<ListFormDialog
						trigger={
							<Button>
								<PlusIcon />
								Создать список
							</Button>
						}
					/>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card>
			<CardContent>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Название</TableHead>
							<TableHead className="text-right">Контактов</TableHead>
							<TableHead className="text-right">
								Доступно для рассылки
							</TableHead>
							<TableHead>Обновлён</TableHead>
							<TableHead className="text-right">Действия</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{lists.map((list) => (
							<TableRow key={list.id}>
								<TableCell>
									<Link
										href={`/email-lists/${list.id}`}
										className="font-medium underline underline-offset-2"
									>
										{list.name}
									</Link>
									{list.description && (
										<p className="max-w-96 truncate text-xs text-muted-foreground">
											{list.description}
										</p>
									)}
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{list.contactsCount.toLocaleString("ru-RU")}
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{(list.contactsCount - list.suppressedCount).toLocaleString(
										"ru-RU",
									)}
									{list.suppressedCount > 0 && (
										<span className="ml-1 text-xs text-muted-foreground">
											({list.suppressedCount} в стоп-листе)
										</span>
									)}
								</TableCell>
								<TableCell className="whitespace-nowrap text-muted-foreground">
									{formatDateTime(list.updatedAt)}
								</TableCell>
								<TableCell>
									<div className="flex justify-end gap-2">
										<Button asChild variant="outline" size="sm">
											<Link href={`/email-lists/${list.id}`}>Открыть</Link>
										</Button>
										<DeleteListButton id={list.id} name={list.name} />
									</div>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	);
}

export default function EmailListsPage() {
	return (
		<div className="flex w-full flex-col gap-6">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="text-2xl font-semibold">Списки контактов</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Собственные базы адресов для email-рассылок — импорт из CSV, ручное
						добавление и общий стоп-лист отписавшихся.
					</p>
				</div>
				<ListFormDialog
					trigger={
						<Button>
							<PlusIcon />
							Создать список
						</Button>
					}
				/>
			</div>

			<Tabs defaultValue="lists">
				<TabsList>
					<TabsTrigger value="lists">Списки</TabsTrigger>
					<TabsTrigger value="suppressions">Стоп-лист</TabsTrigger>
				</TabsList>
				<TabsContent value="lists">
					<ListsTable />
				</TabsContent>
				<TabsContent value="suppressions">
					<SuppressionsCard />
				</TabsContent>
			</Tabs>
		</div>
	);
}
