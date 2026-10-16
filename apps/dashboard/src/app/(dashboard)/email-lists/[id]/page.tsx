"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DownloadIcon, PencilIcon, SendIcon, UserPlusIcon } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
	formatDateTime,
	SUPPRESSION_REASON_LABELS,
} from "@/components/email/email-format";
import { Pager } from "@/components/email/pager";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { downloadCsv } from "@/lib/csv-import";
import { orpc, orpcClient } from "@/lib/orpc/client";
import { ListFormDialog } from "../list-form-dialog";
import { ImportDialog } from "./import-dialog";

const PAGE_SIZE = 50;
type Filter = "all" | "active" | "suppressed";

function AddContactDialog({ listId }: { listId: string }) {
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [email, setEmail] = useState("");
	const [name, setName] = useState("");
	const mutation = useMutation(
		orpc.emailLists.importContacts.mutationOptions({
			onSuccess: (result) => {
				if (result.invalid.length > 0) {
					toast.error("Некорректный email");
					return;
				}
				toast.success(
					result.inserted > 0
						? "Контакт добавлен"
						: "Контакт уже был в списке — имя обновлено",
				);
				queryClient.invalidateQueries({ queryKey: orpc.emailLists.key() });
				setEmail("");
				setName("");
				setOpen(false);
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button variant="outline">
					<UserPlusIcon />
					Добавить вручную
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Новый контакт</DialogTitle>
					<DialogDescription>
						Добавляйте только адреса людей, согласившихся получать рассылку.
					</DialogDescription>
				</DialogHeader>
				<form
					className="flex flex-col gap-4"
					onSubmit={(e) => {
						e.preventDefault();
						mutation.mutate({
							listId,
							source: "manual",
							contacts: [{ email, name: name.trim() || undefined }],
						});
					}}
				>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="contact-email">Email</Label>
						<Input
							id="contact-email"
							type="email"
							required
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							autoFocus
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="contact-name">Имя (необязательно)</Label>
						<Input
							id="contact-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Подставляется в письмо вместо {{name}}"
						/>
					</div>
					<DialogFooter>
						<Button
							type="submit"
							disabled={!email.trim() || mutation.isPending}
						>
							Добавить
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

export default function EmailListPage() {
	const { id } = useParams<{ id: string }>();
	const router = useRouter();
	const queryClient = useQueryClient();
	const [search, setSearch] = useState("");
	const [filter, setFilter] = useState<Filter>("all");
	const [page, setPage] = useState(0);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [exporting, setExporting] = useState(false);
	const debouncedSearch = useDebouncedValue(search, 300);

	const {
		data: list,
		isLoading,
		isError,
	} = useQuery(orpc.emailLists.get.queryOptions({ input: { id } }));
	const { data: contacts, isFetching } = useQuery(
		orpc.emailLists.contacts.queryOptions({
			input: {
				listId: id,
				search: debouncedSearch || undefined,
				filter,
				page,
				pageSize: PAGE_SIZE,
			},
			placeholderData: (prev) => prev,
		}),
	);

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: orpc.emailLists.key() });

	const removeContacts = useMutation(
		orpc.emailLists.removeContacts.mutationOptions({
			onSuccess: (result) => {
				toast.success(`Удалено контактов: ${result.removed}`);
				setSelected(new Set());
				invalidate();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const removeList = useMutation(
		orpc.emailLists.remove.mutationOptions({
			onSuccess: () => {
				toast.success("Список удалён");
				invalidate();
				router.push("/email-lists");
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const exportList = async () => {
		if (!list) return;
		setExporting(true);
		try {
			const rows = await orpcClient.emailLists.exportContacts({ id });
			downloadCsv(
				`${list.name.replace(/[^\p{L}\p{N}_-]+/gu, "_")}.csv`,
				["Email", "Имя", "Добавлен", "Стоп-лист"],
				rows.map((r) => [
					r.email,
					r.name ?? "",
					formatDateTime(r.createdAt),
					r.suppressionReason
						? (SUPPRESSION_REASON_LABELS[r.suppressionReason] ??
							r.suppressionReason)
						: "",
				]),
			);
		} catch (err) {
			toast.error(`Не удалось выгрузить список: ${(err as Error).message}`);
		} finally {
			setExporting(false);
		}
	};

	if (isLoading) {
		return <p className="text-sm text-muted-foreground">Загрузка…</p>;
	}
	if (isError || !list) {
		return <p className="text-sm text-destructive">Список не найден.</p>;
	}

	const rows = contacts?.rows ?? [];
	const pageIds = rows.map((r) => r.id);
	const allOnPageSelected =
		pageIds.length > 0 && pageIds.every((rowId) => selected.has(rowId));
	const activeCount = list.contactsCount - list.suppressedCount;

	return (
		<div className="flex w-full flex-col gap-6">
			<div className="flex flex-col gap-3">
				<Link
					href="/email-lists"
					className="text-sm text-muted-foreground underline underline-offset-2"
				>
					← Ко всем спискам
				</Link>
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div>
						<h1 className="flex items-center gap-2 text-2xl font-semibold">
							{list.name}
							<ListFormDialog
								list={list}
								trigger={
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label="Переименовать"
									>
										<PencilIcon />
									</Button>
								}
							/>
						</h1>
						{list.description && (
							<p className="mt-1 text-sm text-muted-foreground">
								{list.description}
							</p>
						)}
						<p className="mt-1 text-sm text-muted-foreground">
							Контактов: {list.contactsCount.toLocaleString("ru-RU")} · доступно
							для рассылки: {activeCount.toLocaleString("ru-RU")}
							{list.suppressedCount > 0 &&
								` · в стоп-листе: ${list.suppressedCount.toLocaleString("ru-RU")}`}
						</p>
					</div>
					<div className="flex flex-wrap gap-2">
						<ImportDialog listId={list.id} listName={list.name} />
						<AddContactDialog listId={list.id} />
						<Button
							variant="outline"
							onClick={exportList}
							disabled={exporting || list.contactsCount === 0}
						>
							<DownloadIcon />
							Экспорт CSV
						</Button>
						<Button asChild variant="outline" disabled={activeCount === 0}>
							<Link href={`/email-broadcast?listId=${list.id}`}>
								<SendIcon />
								Создать рассылку
							</Link>
						</Button>
					</div>
				</div>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Контакты</CardTitle>
					<CardDescription>
						Контакты из стоп-листа остаются в списке, но рассылка им не уйдёт.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
						<div className="flex flex-col gap-2 md:flex-row">
							<Input
								value={search}
								onChange={(e) => {
									setSearch(e.target.value);
									setPage(0);
								}}
								placeholder="Поиск по email или имени"
								className="md:w-72"
							/>
							<Select
								value={filter}
								onValueChange={(v) => {
									setFilter(v as Filter);
									setPage(0);
								}}
							>
								<SelectTrigger className="md:w-52">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">Все контакты</SelectItem>
									<SelectItem value="active">Доступные для рассылки</SelectItem>
									<SelectItem value="suppressed">В стоп-листе</SelectItem>
								</SelectContent>
							</Select>
						</div>
						{selected.size > 0 && (
							<AlertDialog>
								<AlertDialogTrigger asChild>
									<Button variant="outline" disabled={removeContacts.isPending}>
										Удалить выбранные ({selected.size})
									</Button>
								</AlertDialogTrigger>
								<AlertDialogContent>
									<AlertDialogHeader>
										<AlertDialogTitle>
											Удалить {selected.size} контактов из списка?
										</AlertDialogTitle>
										<AlertDialogDescription>
											Контакты исчезнут только из этого списка. Чтобы человек не
											получал рассылки вообще, добавьте адрес в стоп-лист.
										</AlertDialogDescription>
									</AlertDialogHeader>
									<AlertDialogFooter>
										<AlertDialogCancel>Отмена</AlertDialogCancel>
										<AlertDialogAction
											onClick={() =>
												removeContacts.mutate({
													listId: id,
													ids: [...selected],
												})
											}
										>
											Удалить
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
						)}
					</div>

					{rows.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							{list.contactsCount === 0
								? "Список пуст — загрузите контакты кнопкой «Импорт контактов»."
								: isFetching
									? "Загрузка…"
									: "Ничего не найдено."}
						</p>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="w-8">
										<Checkbox
											checked={allOnPageSelected}
											onCheckedChange={(checked) =>
												setSelected((prev) => {
													const next = new Set(prev);
													for (const rowId of pageIds) {
														if (checked === true) next.add(rowId);
														else next.delete(rowId);
													}
													return next;
												})
											}
											aria-label="Выбрать все на странице"
										/>
									</TableHead>
									<TableHead>Email</TableHead>
									<TableHead>Имя</TableHead>
									<TableHead>Статус</TableHead>
									<TableHead>Источник</TableHead>
									<TableHead>Добавлен</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{rows.map((row) => (
									<TableRow key={row.id}>
										<TableCell>
											<Checkbox
												checked={selected.has(row.id)}
												onCheckedChange={() =>
													setSelected((prev) => {
														const next = new Set(prev);
														if (next.has(row.id)) next.delete(row.id);
														else next.add(row.id);
														return next;
													})
												}
												aria-label={`Выбрать ${row.email}`}
											/>
										</TableCell>
										<TableCell className="font-medium">{row.email}</TableCell>
										<TableCell>{row.name ?? "—"}</TableCell>
										<TableCell>
											{row.suppressionReason ? (
												<Badge
													variant="outline"
													className="text-muted-foreground"
												>
													Стоп-лист:{" "}
													{SUPPRESSION_REASON_LABELS[
														row.suppressionReason
													]?.toLowerCase() ?? row.suppressionReason}
												</Badge>
											) : (
												<Badge variant="secondary">Активен</Badge>
											)}
										</TableCell>
										<TableCell className="text-muted-foreground">
											{row.source === "csv" ? "Импорт" : "Вручную"}
										</TableCell>
										<TableCell className="whitespace-nowrap text-muted-foreground">
											{formatDateTime(row.createdAt)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
					<Pager
						page={page}
						pageSize={PAGE_SIZE}
						total={contacts?.total ?? 0}
						onPageChange={setPage}
					/>
				</CardContent>
			</Card>

			<div>
				<AlertDialog>
					<AlertDialogTrigger asChild>
						<Button variant="ghost" className="text-destructive">
							Удалить список
						</Button>
					</AlertDialogTrigger>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Удалить список «{list.name}»?</AlertDialogTitle>
							<AlertDialogDescription>
								Все {list.contactsCount.toLocaleString("ru-RU")} контактов
								списка будут удалены. Статистика уже отправленных рассылок
								сохранится.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Отмена</AlertDialogCancel>
							<AlertDialogAction
								onClick={() => removeList.mutate({ id })}
								className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							>
								Удалить
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</div>
		</div>
	);
}
